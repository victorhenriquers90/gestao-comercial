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
  card_settlement: "baixa de cartões",
  cash_register: "caixa",
  commission: "comissão",
  stock_count: "contagem de estoque",
  settings: "taxas de cartão",
};

const ACTION: Record<string, string> = {
  create: "criou",
  update: "alterou",
  invite: "convidou",
  renew: "renovou",
  revoke: "revogou",
  cancel: "cancelou",
  "cancel-failed": "tentou cancelar sem sucesso",
  discount: "aplicou desconto em",
  receive: "recebeu",
  pay: "pagou",
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
};

type FieldKind = "text" | "money" | "bool" | "role" | "percent" | "doc" | "regime";

const FIELDS: Record<string, { label: string; kind: FieldKind }> = {
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
    default:
      return String(v);
  }
}

export function auditChanges(row: AuditRow): string[] {
  const before = asRecord(row.before_data);
  const after = asRecord(row.after_data);
  if (!before || !after) return [];
  const out: string[] = [];
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!(key in before) || !(key in after)) continue;
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
  const nome = after?.name ?? before?.name ?? after?.label;
  const alvo = typeof nome === "string" && nome ? ` “${nome}”` : row.entity_id != null ? ` #${row.entity_id}` : "";
  return `${who} ${verb} ${what}${alvo}`;
}
