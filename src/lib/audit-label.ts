import {
  COMMISSION_KIND_LABELS,
  PAYMENT_LABELS,
  PROMO_KIND_LABELS,
  PURCHASE_STATUS_LABELS,
  RECEIPT_METHOD_LABELS,
  TARGET_BONUS_LABELS,
  TIER_BASIS_LABELS,
  type PaymentMethod,
  type ReceiptMethod,
  type TargetBonusKind,
} from "./constants.ts";
import { formatBRL, formatDoc } from "./format.ts";
import { ROLE_LABELS, type Role } from "./permissions.ts";
import { TAX_REGIME_LABELS, type TaxRegime } from "./tax.ts";

export type AuditRow = {
  user_name?: string | null;
  action: string;
  entity: string;
  entity_id?: string | number | null;
  before_data?: unknown;
  after_data?: unknown;
};

const ENTITY: Record<string, string> = {
  company: "empresa",
  store: "loja",
  product: "produto",
  membership: "usuário",
  invite: "convite",
  sale: "venda",
  return: "devolução",
  customer: "cliente",
  supplier: "fornecedor",
  seller: "vendedor",
  inventory: "estoque",
  purchase: "compra",
  nfce: "NFC-e",
  accounts_payable: "conta a pagar",
  accounts_receivable: "conta a receber",
  expense: "despesa",
  card_settlement: "baixa de cartões",
  cash_register: "caixa",
  commission: "comissão",
  stock_count: "contagem de estoque",
  settings: "taxas de cartão",
  promotion: "promoção",
  commission_rule: "regra de comissão",
  target: "meta",
};

const ACTION: Record<string, string> = {
  create: "criou",
  update: "alterou",
  delete: "excluiu",
  invite: "convidou",
  renew: "renovou",
  revoke: "revogou",
  cancel: "cancelou",
  "cancel-failed": "tentou cancelar sem sucesso",
  discount: "aplicou desconto em",
  receive: "recebeu",
  pay: "pagou",
  "reverse-receive": "estornou recebimento de",
  "reverse-pay": "estornou pagamento de",
  emit: "emitiu",
  open: "abriu",
  close: "fechou",
  apply: "aplicou",
  "stock.adjust": "ajustou",
  "set-ncm": "definiu o NCM de",
  "settle-batch": "fez",
  "reveal-expected": "viu o valor esperado de",
  "explain-difference": "justificou a diferença de",
  "card_rates.save": "salvou",
  sangria: "lançou sangria no",
  suprimento: "lançou suprimento no",
};

type FieldKind =
  | "text"
  | "money"
  | "bool"
  | "role"
  | "percent"
  | "doc"
  | "regime"
  | "date"
  | "method"
  | "ref"
  | "yesno"
  | "promoKind"
  | "commissionKind"
  | "tierBasis"
  | "bonusKind"
  | "tiers"
  | "purchaseStatus";

type FieldDef = { label: string; kind: FieldKind };

const FIELDS: Record<string, FieldDef> = {
  name: { label: "nome", kind: "text" },
  tradeName: { label: "nome fantasia", kind: "text" },
  document: { label: "documento", kind: "doc" },
  email: { label: "e-mail", kind: "text" },
  price: { label: "preço", kind: "money" },
  cost: { label: "custo", kind: "money" },
  promoPrice: { label: "preço promocional", kind: "money" },
  role: { label: "papel", kind: "role" },
  limit: { label: "limite de desconto", kind: "percent" },
  creditLimit: { label: "limite de crédito", kind: "money" },
  commissionPct: { label: "comissão", kind: "percent" },
  monthlySalary: { label: "salário", kind: "money" },
  dependents: { label: "dependentes", kind: "text" },
  issRate: { label: "ISS", kind: "percent" },
  taxRegime: { label: "regime", kind: "regime" },
  store: { label: "loja", kind: "text" },
  code: { label: "código", kind: "text" },
  phone: { label: "telefone", kind: "text" },
  representative: { label: "representante", kind: "text" },
  address: { label: "endereço", kind: "text" },
  city: { label: "cidade", kind: "text" },
  state: { label: "UF", kind: "text" },
  zip: { label: "CEP", kind: "text" },
  isActive: { label: "situação", kind: "bool" },
  description: { label: "descrição", kind: "text" },
  amount: { label: "valor", kind: "money" },
  dueDate: { label: "vencimento", kind: "date" },
  category: { label: "categoria", kind: "text" },
  supplierId: { label: "fornecedor", kind: "ref" },
  customerId: { label: "cliente", kind: "ref" },
  storeId: { label: "loja", kind: "ref" },
};

/*
  Cadastros de regra comercial (promocao, regra de comissao, meta): o registro
  inteiro e o que importa tanto na criacao quanto na edicao, na ordem em que se
  le a regra -- por isso lista propria em vez de misturar com FIELDS, onde
  "kind", "percent" e "amount" significam outra coisa em cada entidade.
*/
const ENTITY_FIELDS: Record<string, Record<string, FieldDef>> = {
  promotion: {
    name: { label: "nome", kind: "text" },
    kind: { label: "tipo", kind: "promoKind" },
    percent: { label: "percentual", kind: "percent" },
    amount: { label: "desconto", kind: "money" },
    promoPrice: { label: "preço promocional", kind: "money" },
    buyQty: { label: "leve", kind: "text" },
    payQty: { label: "pague", kind: "text" },
    minQty: { label: "quantidade mínima", kind: "text" },
    productId: { label: "produto", kind: "ref" },
    categoryId: { label: "categoria", kind: "ref" },
    startsAt: { label: "início", kind: "date" },
    endsAt: { label: "fim", kind: "date" },
    isActive: { label: "situação", kind: "bool" },
  },
  commission_rule: {
    name: { label: "nome", kind: "text" },
    kind: { label: "tipo", kind: "commissionKind" },
    percent: { label: "percentual", kind: "percent" },
    tierBasis: { label: "base da faixa", kind: "tierBasis" },
    tiers: { label: "faixas", kind: "tiers" },
    sellerId: { label: "vendedor", kind: "ref" },
    categoryId: { label: "categoria", kind: "ref" },
    productId: { label: "produto", kind: "ref" },
    paymentMethod: { label: "pagamento", kind: "method" },
    minAmount: { label: "venda mínima", kind: "money" },
    skipPromo: { label: "ignora itens em promoção", kind: "yesno" },
    onlyPromo: { label: "só itens em promoção", kind: "yesno" },
    priority: { label: "prioridade", kind: "text" },
    isActive: { label: "situação", kind: "bool" },
  },
  target: {
    name: { label: "nome", kind: "text" },
    amount: { label: "meta", kind: "money" },
    periodStart: { label: "início", kind: "date" },
    periodEnd: { label: "fim", kind: "date" },
    storeId: { label: "loja", kind: "ref" },
    sellerId: { label: "vendedor", kind: "ref" },
    categoryId: { label: "categoria", kind: "ref" },
    bonusKind: { label: "bônus", kind: "bonusKind" },
    bonusValue: { label: "valor do bônus", kind: "text" },
  },
  purchase: {
    supplierId: { label: "fornecedor", kind: "ref" },
    storeId: { label: "loja", kind: "ref" },
    status: { label: "situação", kind: "purchaseStatus" },
    itemCount: { label: "itens", kind: "text" },
    freight: { label: "frete", kind: "money" },
    tax: { label: "imposto", kind: "money" },
    discount: { label: "desconto", kind: "money" },
    total: { label: "total", kind: "money" },
  },
};

/** Alguns campos mudam de unidade conforme o tipo do registro: valor por peça não é percentual. */
function resolveDef(entity: string, key: string, def: FieldDef, rec: Record<string, unknown>): FieldDef {
  if (entity === "commission_rule" && key === "percent" && rec.kind === "fixed_unit") {
    return { label: "valor por peça", kind: "money" };
  }
  if (entity === "target" && key === "bonusValue") {
    if (rec.bonusKind === "extra_percent") return { label: "valor do bônus", kind: "percent" };
    if (rec.bonusKind === "extra_fixed") return { label: "valor do bônus", kind: "money" };
  }
  return def;
}

/** Na criação, o que está em branco ou desligado só faz ruído. */
function omitOnCreate(def: FieldDef, value: unknown, rec: Record<string, unknown>, key: string): boolean {
  if (value == null || value === "") return true;
  if (def.kind === "yesno" && value === false) return true;
  if (def.kind === "tiers" && Array.isArray(value) && value.length === 0) return true;
  if (def.kind === "tierBasis" && value === "none") return true;
  if ((key === "minAmount" || key === "priority") && Number(value) === 0) return true;
  if ((key === "freight" || key === "tax" || key === "discount") && Number(value) === 0) return true;
  if (key === "bonusKind" && value === "none") return true;
  if (key === "bonusValue" && rec.bonusKind === "none") return true;
  return false;
}

// Eventos sem "antes" (lançamento, baixa, sangria): o que o evento carrega, na ordem em que se lê.
const EVENT_FIELDS: Record<string, FieldDef> = {
  amount: { label: "valor", kind: "money" },
  dueDate: { label: "vencimento", kind: "date" },
  category: { label: "categoria", kind: "text" },
  method: { label: "forma", kind: "method" },
  status: { label: "situação", kind: "text" },
  cashReversal: { label: "devolvido ao caixa", kind: "money" },
  cashRemoved: { label: "retirado do caixa", kind: "money" },
  reason: { label: "motivo", kind: "text" },
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function show(kind: FieldKind, v: unknown): string {
  if (v == null || v === "") return "vazio";
  switch (kind) {
    case "money":
      return formatBRL(Number(v));
    case "bool":
      return v === false ? "inativo" : "ativo";
    case "role":
      return ROLE_LABELS[v as Role] ?? String(v);
    case "percent":
      return `${Number(v)}%`;
    case "doc":
      return formatDoc(String(v));
    case "regime":
      return TAX_REGIME_LABELS[v as TaxRegime] ?? String(v);
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
    }
    case "method":
      return RECEIPT_METHOD_LABELS[v as ReceiptMethod] ?? PAYMENT_LABELS[v as PaymentMethod] ?? String(v);
    case "ref":
      return `nº ${String(v)}`;
    case "yesno":
      return v === true || v === "true" ? "sim" : "não";
    case "promoKind":
      return PROMO_KIND_LABELS[String(v)] ?? String(v);
    case "commissionKind":
      return COMMISSION_KIND_LABELS[String(v)] ?? String(v);
    case "tierBasis":
      return TIER_BASIS_LABELS[String(v)] ?? String(v);
    case "bonusKind":
      return TARGET_BONUS_LABELS[v as TargetBonusKind] ?? String(v);
    case "purchaseStatus":
      return PURCHASE_STATUS_LABELS[String(v)] ?? String(v);
    case "tiers": {
      if (!Array.isArray(v) || v.length === 0) return "nenhuma";
      return v
        .map((t) => {
          const row = (t ?? {}) as { min?: unknown; percent?: unknown };
          return `${formatBRL(Number(row.min))}+ → ${Number(row.percent)}%`;
        })
        .join(" · ");
    }
    default:
      return String(v);
  }
}

export function auditChanges(row: AuditRow): string[] {
  const before = asRecord(row.before_data);
  const after = asRecord(row.after_data);
  if (!after) return [];
  const out: string[] = [];
  const own = ENTITY_FIELDS[row.entity];
  if (!before) {
    if (row.before_data != null) return [];
    if (own) {
      for (const [key, base] of Object.entries(own)) {
        if (!(key in after) || omitOnCreate(base, after[key], after, key)) continue;
        const def = resolveDef(row.entity, key, base, after);
        out.push(`${def.label}: ${show(def.kind, after[key])}`);
      }
      return out;
    }
    for (const [key, def] of Object.entries(EVENT_FIELDS)) {
      if (after[key] == null || after[key] === "") continue;
      out.push(`${def.label}: ${show(def.kind, after[key])}`);
    }
    return out;
  }
  for (const [key, base] of Object.entries(own ?? FIELDS)) {
    if (!(key in before) || !(key in after)) continue;
    const def = resolveDef(row.entity, key, base, after);
    const a = show(def.kind, before[key]);
    const b = show(def.kind, after[key]);
    if (a !== b) out.push(`${def.label}: ${a} → ${b}`);
  }
  return out;
}

export function auditTitle(row: AuditRow): string {
  const who = row.user_name?.trim() || "Alguém";
  const verb = ACTION[row.action] ?? row.action;
  const what = ENTITY[row.entity] ?? row.entity;
  const after = asRecord(row.after_data);
  const before = asRecord(row.before_data);
  const nome = after?.name ?? before?.name ?? after?.label ?? after?.description ?? before?.description;
  const alvo = typeof nome === "string" && nome ? ` “${nome}”` : row.entity_id != null ? ` #${row.entity_id}` : "";
  return `${who} ${verb} ${what}${alvo}`;
}
