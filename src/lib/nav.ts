import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  MonitorSmartphone,
  ShoppingBag,
  Package,
  Warehouse,
  Truck,
  Users,
  Kanban,
  Factory,
  Wallet,
  Landmark,
  BadgePercent,
  Target,
  BarChart3,
  Settings,
  RotateCcw,
  Megaphone,
} from "lucide-react";
import type { Perm } from "./permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  perm: Perm;
  accent?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.read" },
  { href: "/app/pdv", label: "PDV", icon: MonitorSmartphone, perm: "pdv.sell", accent: true },
  { href: "/app/vendas", label: "Vendas", icon: ShoppingBag, perm: "sales.read" },
  { href: "/app/produtos", label: "Produtos", icon: Package, perm: "products.read" },
  { href: "/app/estoque", label: "Estoque", icon: Warehouse, perm: "stock.read" },
  { href: "/app/compras", label: "Compras", icon: Truck, perm: "purchases.read" },
  { href: "/app/clientes", label: "Clientes", icon: Users, perm: "customers.read" },
  { href: "/app/crm", label: "CRM", icon: Kanban, perm: "crm.write" },
  { href: "/app/fornecedores", label: "Fornecedores", icon: Factory, perm: "suppliers.read" },
  { href: "/app/financeiro", label: "Financeiro", icon: Wallet, perm: "finance.read" },
  { href: "/app/caixa", label: "Caixa", icon: Landmark, perm: "cash.read" },
  { href: "/app/vendedores", label: "Vendedores", icon: BadgePercent, perm: "sellers.read" },
  { href: "/app/metas", label: "Metas", icon: Target, perm: "targets.read" },
  { href: "/app/promocoes", label: "Promoções", icon: Megaphone, perm: "promotions.write" },
  { href: "/app/devolucoes", label: "Devoluções", icon: RotateCcw, perm: "returns.write" },
  { href: "/app/relatorios", label: "Relatórios", icon: BarChart3, perm: "reports.read" },
  { href: "/app/configuracoes", label: "Configurações", icon: Settings, perm: "settings.write" },
];

export const NAV_GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Operação", hrefs: ["/app", "/app/pdv"] },
  { label: "Comercial", hrefs: ["/app/vendas", "/app/clientes", "/app/crm", "/app/promocoes", "/app/devolucoes"] },
  { label: "Catálogo", hrefs: ["/app/produtos", "/app/estoque", "/app/compras", "/app/fornecedores"] },
  { label: "Equipe", hrefs: ["/app/vendedores", "/app/metas"] },
  { label: "Financeiro", hrefs: ["/app/financeiro", "/app/caixa", "/app/relatorios"] },
  { label: "Sistema", hrefs: ["/app/configuracoes"] },
];
