/**
 * Emissão de NFC-e via Focus NFe (https://focusnfe.com.br/doc). Token e
 * ambiente ficam em variável de ambiente (nunca no banco), mesmo padrão já
 * usado pra XAI_API_KEY em imagine.ts — este deploy emite por UM CNPJ (o da
 * loja), não por tenant, então não há por que guardar credencial por linha.
 *
 * homologação é o padrão; produção só entra com FOCUS_NFE_ENV=producao
 * setado explicitamente. A montagem do payload (regras fiscais) mora em
 * `@/lib/nfce`, testável sem rede; este arquivo só faz I/O (banco + HTTP).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { num, nullableStr, str } from "@/lib/utils";
import {
  buildNfcePayload,
  buildNfceRef,
  isTaxRegime,
  validateNfceReadiness,
  type BuildNfceInput,
  type NfceEnv,
} from "@/lib/nfce";
import {
  canEmitForReal,
  homologationWarning,
  nfceBlockers,
  type ReadinessInput,
} from "@/lib/nfce-readiness";
import { ncmValidSql } from "@/lib/ncm";
import type { PaymentMethod } from "@/lib/constants";
import { audit, requireTenant } from "./context";
import { type Row } from "@/lib/json";

const FOCUS_BASE_URL: Record<NfceEnv, string> = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

function focusEnv(): NfceEnv {
  return process.env.FOCUS_NFE_ENV === "producao" ? "producao" : "homologacao";
}

function focusToken(): string | undefined {
  return process.env.FOCUS_NFE_TOKEN || undefined;
}

async function focusRequest(
  path: string,
  method: "POST" | "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const token = focusToken();
  if (!token) throw new Error("Emissão de nota fiscal não configurada (FOCUS_NFE_TOKEN ausente).");
  const res = await fetch(`${FOCUS_BASE_URL[focusEnv()]}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: parsed as Record<string, unknown> };
}

/** Flag pro front saber se mostra a ação de emitir — nenhum dado de tenant aqui. */
export const nfceStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ available: Boolean(focusToken()), env: focusEnv() }));

/**
 * Pré-checagem fiscal: a loja consegue emitir hoje?
 *
 * A validação que existia roda POR VENDA, no clique de emitir. O lojista
 * descobria que falta NCM com o cliente no balcão, um produto por vez --
 * e só via o bloqueio seguinte depois de resolver esse. Aqui a lista sai
 * inteira, antes da primeira venda.
 *
 * Gate em `users.read` e não em `settings.write`: é a mesma permissão que
 * abre a tela de Configurações pro gerente (ver nav.ts). Ele é quem corre
 * atrás do contador pelos NCMs; salvar continua exigindo settings.write.
 */
export const nfceReadinessFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "users.read");

    const [company] = await sql<Row>`
      select c.document, c.ie, c.tax_regime, s.nfce_enabled
        from companies c
        left join company_settings s on s.company_id = c.id
       where c.id = ${tenant.companyId}
    `;
    // Mesma regra do painel de NCM (ncmValidSql, colado em hasNcm):
    // "btrim(ncm) <> ''" contava "abc" como classificado, e esta tela
    // dizia "nenhuma pendência" enquanto o painel dizia "1 pendente".
    const [produtos] = await sql.query<{ total: number; sem_ncm: number }>(
      `select count(*)::int as total,
              count(*) filter (where not ${ncmValidSql()})::int as sem_ncm
         from products
        where company_id = $1 and deleted_at is null`,
      [tenant.companyId],
    );
    // Só os primeiros: a lista existe pra dar o caminho, não pra virar
    // um segundo cadastro de produtos dentro de Configurações.
    const exemplos = await sql.query<{ id: number; name: string }>(
      `select id, name from products
        where company_id = $1 and deleted_at is null and not ${ncmValidSql()}
        order by name limit 8`,
      [tenant.companyId],
    );
    const [vendas] = await sql<{ finalizadas: number; com_nota: number }>`
      select count(*)::int as finalizadas,
             count(*) filter (where nfce_env = 'producao' and nfce_status = 'autorizado')::int as com_nota
        from sales
       where company_id = ${tenant.companyId} and deleted_at is null and status = 'finalizada'
    `;

    const input: ReadinessInput = {
      tokenPresent: Boolean(focusToken()),
      env: focusEnv(),
      enabled: company?.nfce_enabled === true,
      hasCnpj: Boolean(nullableStr(company?.document)),
      hasIe: Boolean(nullableStr(company?.ie)),
      produtosTotal: num(produtos?.total),
      produtosSemNcm: num(produtos?.sem_ncm),
    };

    return {
      ...input,
      blockers: nfceBlockers(input),
      aviso: homologationWarning(input),
      prontoParaValer: canEmitForReal(input),
      exemplosSemNcm: exemplos.map((p) => ({ id: num(p.id), name: str(p.name) })),
      vendasFinalizadas: num(vendas?.finalizadas),
      vendasComNota: num(vendas?.com_nota),
    };
  });

async function loadEmitInput(
  sql: Awaited<ReturnType<typeof requireTenant>>["sql"],
  companyId: number,
  saleId: number,
  env: NfceEnv,
): Promise<{ input: BuildNfceInput } | { error: string }> {
  const [sale] = await sql<Row>`
    select s.*, cu.document as customer_document, cu.name as customer_name
      from sales s
      left join customers cu on cu.id = s.customer_id
     where s.id = ${saleId} and s.company_id = ${companyId} and s.deleted_at is null
  `;
  if (!sale) return { error: "Venda não encontrada." };
  if (String(sale.status) !== "finalizada") return { error: "Só é possível emitir nota de uma venda finalizada." };

  const [company] = await sql<Row>`select * from companies where id = ${companyId}`;
  if (!company) return { error: "Empresa não encontrada." };

  const items = await sql<Row>`
    select si.description, si.quantity, si.unit_price, si.discount, si.total,
           p.ncm, p.cfop, p.unit
      from sale_items si
      join products p on p.id = si.product_id
     where si.sale_id = ${saleId} and si.company_id = ${companyId}
     order by si.id
  `;
  const payments = await sql<{ method: string; amount: string | number }>`
    select method, amount from payments where sale_id = ${saleId} and company_id = ${companyId}
  `;

  const regime = isTaxRegime(company.tax_regime) ? company.tax_regime : "simples";
  const document = nullableStr(sale.customer_document) ?? nullableStr(sale.document);

  const input: BuildNfceInput = {
    ref: buildNfceRef(companyId, saleId, env),
    env,
    saleNumber: num(sale.number),
    soldAt: new Date(String(sale.sold_at)).toISOString(),
    emitter: {
      cnpj: str(company.document),
      name: str(company.trade_name) || str(company.name),
      ie: nullableStr(company.ie),
      regime,
    },
    buyer: { document, name: document ? nullableStr(sale.customer_name) : null },
    items: items.map((i) => ({
      description: str(i.description),
      ncm: nullableStr(i.ncm),
      cfop: str(i.cfop) || "5102",
      unit: str(i.unit) || "UN",
      quantity: num(i.quantity),
      unitPrice: num(i.unit_price),
      discount: num(i.discount),
      total: num(i.total),
    })),
    payments: payments.map((p) => ({ method: p.method as PaymentMethod, amount: num(p.amount) })),
  };
  return { input };
}

export const emitNfceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { saleId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "sales.write");

    const env = focusEnv();

    /*
      Uma nota de TESTE não pode barrar a nota que vale.

      Homologação existe pra testar, então esses testes vão acontecer --
      e gravam status 'autorizado', chave, número e DANFE, iguais aos de
      uma nota real. Sem esta checagem, toda venda usada pra testar
      ficaria para sempre sem documento fiscal, parecendo que tem.

      Reemitir no MESMO ambiente continua barrado: ali a nota ou já
      existe, ou está em processamento, e insistir geraria duplicidade
      de verdade.
    */
    const [atual] = await sql<{ nfce_status: string | null; nfce_env: string | null }>`
      select nfce_status, nfce_env from sales
       where id = ${data.saleId} and company_id = ${tenant.companyId}
    `;
    const emitida = atual?.nfce_status != null && atual.nfce_status !== "erro";
    if (emitida && atual!.nfce_env === env) {
      throw new Error(
        env === "homologacao"
          ? "Esta venda já tem nota de teste. Para emitir a real, o servidor precisa estar em produção."
          : "Esta venda já tem nota fiscal emitida.",
      );
    }

    const loaded = await loadEmitInput(sql, tenant.companyId, data.saleId, env);
    if ("error" in loaded) throw new Error(loaded.error);
    const { input } = loaded;

    const errors = validateNfceReadiness(input);
    if (errors.length) return { ok: false as const, errors };

    const payload = buildNfcePayload(input);
    const res = await focusRequest(`/v2/nfce?ref=${encodeURIComponent(input.ref)}`, "POST", payload);

    if (res.status === 200 || res.status === 202) {
      const status = nullableStr(res.body.status) ?? "processando_autorizacao";
      /*
        Chave, número, série e links são zerados junto: são da nota
        anterior. Uma emissão de produção por cima de um teste herdaria a
        chave do teste até alguém apertar 'Atualizar status' -- e nesse
        meio-tempo a tela mostraria uma chave falsa com cara de fiscal.
      */
      await sql`
        update sales set nfce_ref = ${input.ref}, nfce_status = ${status}, nfce_env = ${env},
          nfce_error = null, nfce_chave = null, nfce_numero = null, nfce_serie = null,
          nfce_danfe_url = null, nfce_xml_url = null
        where id = ${data.saleId} and company_id = ${tenant.companyId}
      `;
      await audit(sql, tenant, "emit", "nfce", data.saleId, null, {
        ref: input.ref,
        status,
        env,
        substituiuTeste: emitida,
      });
      return { ok: true as const, status, env };
    }

    const message =
      nullableStr(res.body.mensagem) ?? nullableStr(res.body.erro) ?? `Falha ao emitir (HTTP ${res.status}).`;
    await sql`
      update sales set nfce_status = 'erro', nfce_error = ${message}
      where id = ${data.saleId} and company_id = ${tenant.companyId}
    `;
    return { ok: false as const, errors: [message] };
  });

export const refreshNfceStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { saleId: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    const [sale] = await sql<{ nfce_ref: string | null }>`
      select nfce_ref from sales where id = ${data.saleId} and company_id = ${tenant.companyId}
    `;
    if (!sale?.nfce_ref) throw new Error("Esta venda ainda não teve nota fiscal emitida.");

    const res = await focusRequest(`/v2/nfce/${encodeURIComponent(sale.nfce_ref)}`, "GET");
    const status = nullableStr(res.body.status) ?? "erro";
    const chave = nullableStr(res.body.chave_nfe);
    const numero = nullableStr(res.body.numero);
    const serie = nullableStr(res.body.serie);
    const danfeUrl = nullableStr(res.body.caminho_danfe);
    const xmlUrl = nullableStr(res.body.caminho_xml_nota_fiscal);
    const error = status.startsWith("erro")
      ? (nullableStr(res.body.mensagem_sefaz) ?? nullableStr(res.body.mensagem))
      : null;

    await sql`
      update sales set
        nfce_status = ${status},
        nfce_chave = ${chave},
        nfce_numero = ${numero},
        nfce_serie = ${serie},
        nfce_danfe_url = ${danfeUrl},
        nfce_xml_url = ${xmlUrl},
        nfce_error = ${error}
      where id = ${data.saleId} and company_id = ${tenant.companyId}
    `;
    return { status, chave, numero, serie, danfeUrl, xmlUrl, error };
  });
