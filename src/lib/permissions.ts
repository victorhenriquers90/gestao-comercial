export const ROLES = [
  "admin",
  "gerente",
  "vendedor",
  "caixa",
  "pdv",
  "estoque",
  "financeiro",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  caixa: "Caixa",
  pdv: "Operador de PDV",
  estoque: "Estoque",
  financeiro: "Financeiro",
};

export const DEFAULT_DISCOUNT_LIMIT: Record<Role, number> = {
  admin: 100,
  gerente: 25,
  vendedor: 5,
  caixa: 2,
  pdv: 2,
  estoque: 0,
  financeiro: 0,
};

export type Perm =
  | "dashboard.read"
  | "pdv.sell"
  | "pdv.discount"
  | "pdv.price_override"
  | "pdv.cancel"
  | "sales.read"
  | "sales.write"
  | "products.read"
  | "products.write"
  | "stock.read"
  | "stock.adjust"
  | "purchases.read"
  | "purchases.write"
  | "purchases.receive"
  | "customers.read"
  | "customers.write"
  | "crm.write"
  | "suppliers.read"
  | "suppliers.write"
  | "finance.read"
  | "finance.write"
  | "cash.read"
  | "cash.write"
  | "sellers.read"
  | "sellers.write"
  | "targets.read"
  | "targets.write"
  | "reports.read"
  | "promotions.write"
  | "returns.write"
  | "settings.write"
  /**
   * Ver a equipe (nomes, e-mails, papeis e limite de desconto de cada um) --
   * separada de users.write porque gerenciar e ver sao coisas diferentes: o
   * gerente precisa enxergar o time que toca, mas nao promove ninguem nem
   * mexe em papel. Antes so existia users.write, entao getSettingsFn
   * entregava a lista inteira a qualquer papel autenticado, incluindo o
   * operador de PDV.
   */
  | "users.read"
  | "users.write"
  | "audit.read";

const ALL: Perm[] = [
  "dashboard.read",
  "pdv.sell",
  "pdv.discount",
  "pdv.price_override",
  "pdv.cancel",
  "sales.read",
  "sales.write",
  "products.read",
  "products.write",
  "stock.read",
  "stock.adjust",
  "purchases.read",
  "purchases.write",
  "purchases.receive",
  "customers.read",
  "customers.write",
  "crm.write",
  "suppliers.read",
  "suppliers.write",
  "finance.read",
  "finance.write",
  "cash.read",
  "cash.write",
  "sellers.read",
  "sellers.write",
  "targets.read",
  "targets.write",
  "reports.read",
  "promotions.write",
  "returns.write",
  "settings.write",
  "users.read",
  "users.write",
  "audit.read",
];

const ROLE_PERMS: Record<Role, Perm[]> = {
  admin: ALL,
  gerente: ALL.filter((p) => p !== "users.write" && p !== "settings.write"),
  vendedor: [
    "dashboard.read",
    "pdv.sell",
    "pdv.discount",
    "sales.read",
    "products.read",
    "customers.read",
    "customers.write",
    "crm.write",
    "targets.read",
    "sellers.read",
    // Leitura do status do caixa (não abre/fecha) — o PDV consulta isso pra
    // qualquer papel que venda, mesmo sem permissão de mexer no caixa.
    "cash.read",
  ],
  caixa: [
    "dashboard.read",
    "pdv.sell",
    "pdv.discount",
    "sales.read",
    "products.read",
    "customers.read",
    "cash.read",
    "cash.write",
  ],
  // Só o PDV: sem dashboard/vendas/produtos, nem no menu nem nas consultas
  // do servidor. O seletor de vendedor do PDV usa listActiveSellerNamesFn
  // (só id+nome, sem perm própria) em vez de sellers.read — esse dá acesso
  // à página Vendedores inteira, com salário/comissão/documento de cada um.
  pdv: ["pdv.sell", "pdv.discount", "customers.read", "cash.read", "cash.write"],
  estoque: [
    "dashboard.read",
    "products.read",
    "products.write",
    "stock.read",
    "stock.adjust",
    "purchases.read",
    "purchases.write",
    "purchases.receive",
    "suppliers.read",
    "suppliers.write",
  ],
  financeiro: [
    "dashboard.read",
    "sales.read",
    "finance.read",
    "finance.write",
    "cash.read",
    "cash.write",
    "reports.read",
    "suppliers.read",
    "customers.read",
  ],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, perm: Perm): boolean {
  return ROLE_PERMS[role].includes(perm);
}

export function assertCan(role: Role, perm: Perm): void {
  if (!can(role, perm)) {
    throw new Error("Sem permissão para esta ação.");
  }
}
