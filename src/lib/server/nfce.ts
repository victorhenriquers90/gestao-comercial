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
import { assertCan, can, type Role } from "@/lib/permissions";
import { num, nullableStr, str } from "@/lib/utils";
import {
  buildNfcePayload,
  buildNfceRef,
  isTaxRegime,
  nfceNeedsSefazCancel,
  validateNfceCancelJustificativa,
  validateNfceReadiness,
  type BuildNfceInput,
} from "@/lib/nfce";
import type { PaymentMethod } from "@/lib/constants";
import { audit, requireTenant, type Tenant } from "./context";
import { type Row } from "@/lib/json";

type FocusEnv = "homologacao" | "producao";

const FOCUS_BASE_URL: Record<FocusEnv, string> = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

function focusEnv(): FocusEnv {
  return process.env.FOCUS_NFE_ENV === "producao" ? "producao" : "homologacao";
}

function focusToken(): string | undefined {
  return process.env.FOCUS_NFE_TOKEN || undefined;
}

function assertCanEmitNfce(role: Role) {
  if (!can(role, "sales.write") && !can(role, "pdv.sell")) {
    throw new Error("Sem permissão para emitir nota fiscal.");
  }
}

async function focusRequest(
  path: string,
  method: "POST" | "GET" | "DELETE",
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

async function loadEmitInput(
  sql: Awaited<ReturnType<typeof requireTenant>>["sql"],
  companyId: number,
  saleId: number,
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
    ref: buildNfceRef(companyId, saleId),
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
    assertCanEmitNfce(tenant.role);

    const loaded = await loadEmitInput(sql, tenant.companyId, data.saleId);
    if ("error" in loaded) throw new Error(loaded.error);
    const { input } = loaded;

    const errors = validateNfceReadiness(input);
    if (errors.length) return { ok: false as const, errors };

    const payload = buildNfcePayload(input);
    const res = await focusRequest(`/v2/nfce?ref=${encodeURIComponent(input.ref)}`, "POST", payload);

    if (res.status === 200 || res.status === 202) {
      const status = nullableStr(res.body.status) ?? "processando_autorizacao";
      await sql`
        update sales set nfce_ref = ${input.ref}, nfce_status = ${status}, nfce_error = null
        where id = ${data.saleId} and company_id = ${tenant.companyId}
      `;
      await audit(sql, tenant, "emit", "nfce", data.saleId, null, { ref: input.ref, status });
      return { ok: true as const, status };
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
    assertCanEmitNfce(tenant.role);
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

export async function cancelNfceOnFocus(
  sql: Awaited<ReturnType<typeof requireTenant>>["sql"],
  tenant: Tenant,
  saleId: number,
  justificativa: string,
): Promise<{ ok: true; status: string } | { ok: false; errors: string[] }> {
  const reasonError = validateNfceCancelJustificativa(justificativa);
  if (reasonError) return { ok: false, errors: [reasonError] };

  const [sale] = await sql<{ nfce_ref: string | null; nfce_status: string | null }>`
    select nfce_ref, nfce_status from sales
     where id = ${saleId} and company_id = ${tenant.companyId}
  `;
  if (!sale) throw new Error("Venda não encontrada.");
  if (!sale.nfce_ref || !nfceNeedsSefazCancel(sale.nfce_status)) {
    return { ok: true, status: sale.nfce_status ?? "" };
  }

  const justificativaTrim = justificativa.trim();
  const res = await focusRequest(`/v2/nfce/${encodeURIComponent(sale.nfce_ref)}`, "DELETE", {
    justificativa: justificativaTrim,
  });
  const status = nullableStr(res.body.status);
  if (res.status === 200 && (status === "cancelado" || !status)) {
    await sql`
      update sales set nfce_status = 'cancelado', nfce_error = null
       where id = ${saleId} and company_id = ${tenant.companyId}
    `;
    await audit(sql, tenant, "cancel", "nfce", saleId, { status: sale.nfce_status }, { ref: sale.nfce_ref });
    return { ok: true, status: "cancelado" };
  }

  const message =
    nullableStr(res.body.mensagem_sefaz) ??
    nullableStr(res.body.mensagem) ??
    nullableStr(res.body.erro) ??
    `Falha ao cancelar a nota (HTTP ${res.status}).`;
  await sql`
    update sales set nfce_status = 'erro_cancelamento', nfce_error = ${message}
     where id = ${saleId} and company_id = ${tenant.companyId}
  `;
  return { ok: false, errors: [message] };
}

export const cancelNfceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { saleId: number; justificativa: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, "pdv.cancel");
    return cancelNfceOnFocus(sql, tenant, data.saleId, data.justificativa);
  });

