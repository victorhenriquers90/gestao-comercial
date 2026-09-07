export const ROLES = [
  "admin",
  "gerente",
  "vendedor",
  "caixa",
  "estoque",
  "financeiro",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  caixa: "Caixa",
  estoque: "Estoque",
  financeiro: "Financeiro",
};

export const DEFAULT_DISCOUNT_LIMIT: Record<Role, number> = {
  admin: 100,
  gerente: 25,
  vendedor: 5,
  caixa: 2,
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
