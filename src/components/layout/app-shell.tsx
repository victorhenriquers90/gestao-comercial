import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Menu,
  Moon,
  Search,
  Store,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSelection } from "@/hooks/use-selection";
import { useTheme } from "@/hooks/use-theme";
import { UserButton } from "@/lib/auth/gates";
import { runAction } from "@/lib/run-action";
import { ensureCsrfCookie } from "@/lib/auth/client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { APP_NAME } from "@/lib/constants";
import { NAV_GROUPS, NAV_ITEMS } from "@/lib/nav";
import { can, ROLE_LABELS, type Role } from "@/lib/permissions";
import { globalSearchFn, listNotificationsFn, markNotificationReadFn } from "@/lib/server/session";
import type { Tenant } from "@/lib/server/context";
import { cn } from "@/lib/utils";

export function AppShell({
  tenant,
  children,
}: {
  tenant: Tenant;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPdv = pathname.startsWith("/app/pdv");
  const items = NAV_ITEMS.filter((i) => can(tenant.role as Role, i.perm));
  const current = items.find((i) =>
    i.href === "/app" ? pathname === "/app" : pathname.startsWith(i.href),
  );

  useEffect(() => {
    ensureCsrfCookie();
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background">
        <aside
          className={cn(
            "no-print fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebar-foreground md:flex",
            collapsed ? "w-16" : "w-64",
            isPdv && "md:hidden",
          )}
        >
          <SidebarBody tenant={tenant} items={items} collapsed={collapsed} pathname={pathname} />
          <button
            type="button"
            className="flex h-12 items-center gap-2 border-t border-sidebar-foreground/10 px-3 text-xs text-sidebar-muted hover:text-sidebar-foreground"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? (
              <ChevronsRight className="mx-auto size-4" />
            ) : (
              <>
                <ChevronsLeft className="size-4" />
                Recolher
              </>
            )}
          </button>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0">
            <SidebarBody
              tenant={tenant}
              items={items}
              collapsed={false}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <div className={cn("app-frame", isPdv ? "" : "md:pl-64", !isPdv && collapsed && "md:pl-16")}>
          <header className="app-header topbar no-print sticky top-0 z-20 h-16 border-b border-border bg-background/85 px-6 backdrop-blur-md">
            <div className="topbar-start">
              <Button
                variant="ghost"
                size="icon"
                className={cn(!isPdv && "md:hidden")}
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
              >
                <Menu className="size-4" />
              </Button>
              <BrandMark className={cn("size-7", !isPdv && "md:hidden")} />
              {current ? (
                <p className="ed-label truncate">{current.label}</p>
              ) : null}
            </div>
            <GlobalSearch />
            <div className="topbar-end">
              <StorePicker tenant={tenant} />
              <NotifBell />
              <ThemeToggle />
              <UserMenu tenant={tenant} />
            </div>
          </header>
          <div
            key={pathname}
            className={cn("app-main content-pane page-pad page-enter", isPdv && "p-0")}
          >
            {children}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarBody({
  tenant,
  items,
  collapsed,
  pathname,
  onNavigate,
}: {
  tenant: Tenant;
  items: typeof NAV_ITEMS;
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const grouped = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.hrefs.map((href) => items.find((i) => i.href === href)).filter(Boolean) as typeof NAV_ITEMS,
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className={cn("flex items-center gap-2.5 px-3 py-4", collapsed && "justify-center px-2")}>
        <BrandMark tone="inverse" className="size-8 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">{APP_NAME}</p>
            <p className="truncate text-xs text-sidebar-muted">{tenant.companyName}</p>
          </div>
        ) : null}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {grouped.map((group) => (
          <div key={group.label}>
            {!collapsed ? (
              <p className="ed-label mb-1.5 px-2.5">{group.label}</p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
                const Icon = item.icon;
                const link = (
                  <Link
                    key={item.href}
                    to={item.href}
                    aria-label={item.label}
                    onClick={onNavigate}
                    className={cn(
                      "relative flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150",
                      "focus-visible:ring-2 focus-visible:ring-sidebar-foreground/60 focus-visible:outline-none",
                      "before:absolute before:top-1/2 before:left-0 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-sidebar-foreground before:transition-opacity before:duration-150",
                      active
                        ? "bg-sidebar-accent text-sidebar-foreground before:opacity-100"
                        : "text-sidebar-muted before:opacity-0 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      item.accent && !active && "text-sidebar-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
                if (!collapsed) return link;
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}

function StorePicker({ tenant }: { tenant: Tenant }) {
  const storeId = useSelection((s) => s.storeId);
  const setStoreId = useSelection((s) => s.setStoreId);
  const current =
    storeId && tenant.stores.some((s) => s.id === storeId) ? storeId : tenant.defaultStoreId;

  useEffect(() => {
    if (storeId == null && tenant.defaultStoreId) setStoreId(tenant.defaultStoreId);
  }, [storeId, tenant.defaultStoreId, setStoreId]);

  return (
    <label className="store-picker relative flex w-48 items-center">
      <Store className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <Select
        className="h-10 w-full min-w-0 bg-muted pl-8 text-sm"
        value={current ?? ""}
        onChange={(e) => setStoreId(Number(e.target.value))}
        aria-label="Loja"
      >
        {tenant.stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Alternar tema">
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function UserMenu({ tenant }: { tenant: Tenant }) {
  const user = useCurrentUser();
  const name = user?.displayName ?? tenant.userName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-medium text-primary">
            {initials(name)}
          </span>
          <span className="user-meta max-w-40 text-left text-xs">
            <span className="block truncate font-medium text-foreground">{name}</span>
            <span className="text-muted-foreground">{ROLE_LABELS[tenant.role]}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{tenant.companyName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <UserButton />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotifBell() {
  const [open, setOpen] = useState(false);
  // O tipo vem da propria funcao de servidor: redeclarar a forma aqui foi o
  // que deixou `dismissible` de fora quando o servidor passou a mandar.
  const [items, setItems] = useState<Awaited<ReturnType<typeof listNotificationsFn>>>([]);

  function load() {
    listNotificationsFn()
      .then(setItems)
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notificações" className="relative">
          <Bell className="size-4" />
          {items.length ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
          {/*
            "Limpar" so aparece quando ha aviso DISPENSAVEL.

            Os derivados (estoque baixo, cobranca, tarefas) sao estado, nao
            evento: somem quando o problema acaba, e nao ha o que marcar
            como lido. Antes o botao aparecia sempre que houvesse qualquer
            item -- a pessoa clicava, nada mudava, e a conclusao razoavel
            era que o sistema estava quebrado.
          */}
          {items.some((n) => n.dismissible) ? (
            <button
              type="button"
              className="text-xs font-medium text-primary"
              onClick={async () => {
                await runAction(() => markNotificationReadFn({ data: {} }), {
                  erro: "Não foi possível limpar as notificações.",
                });
                load();
              }}
            >
              Limpar
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">Tudo em dia.</p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem key={n.id} asChild>
              <Link
                to={n.href}
                className="flex flex-col items-start gap-0.5"
                onClick={() => {
                  const id = Number(n.id);
                  if (Number.isFinite(id) && id > 0) {
                    // `.then` sem `.catch` era rejeicao nao tratada no
                    // console; marcar como lida falhando nao deve atrapalhar
                    // a navegacao, entao aqui o erro so e engolido de
                    // proposito -- e o unico lugar em que isso e aceitavel.
                    void markNotificationReadFn({ data: { id } })
                      .then(load)
                      .catch(() => undefined);
                  }
                  setOpen(false);
                }}
              >
                <span className="text-sm font-medium">{n.title}</span>
                <span className="text-xs text-muted-foreground">{n.body}</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<{ type: string; id: number; title: string; subtitle: string; href: string }[]>(
    [],
  );

  // O atalho aceita Ctrl E Cmd (ver onKey abaixo), mas a DICA precisa mostrar
  // a tecla que existe no teclado de quem esta olhando -- os terminais de loja
  // sao Windows, e "⌘" nem existe la. Comeca em "Ctrl K" (igual no SSR e no
  // primeiro render do cliente, senao da hydration mismatch) e so vira "⌘K"
  // depois de montar, se for mesmo um Mac.
  const [shortcutHint, setShortcutHint] = useState("Ctrl K");
  useEffect(() => {
    if (/mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)) {
      setShortcutHint("⌘K");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (q.trim().length < 2) {
        setHits([]);
        return;
      }
      globalSearchFn({ data: { q } })
        .then(setHits)
        .catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const box = useMemo(
    () => (
      <div className="topbar-search relative min-w-0 w-full max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="global-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder="Buscar produto, cliente ou venda…"
          className="h-10 bg-muted pl-9 pr-14"
        />
        <Kbd className="topbar-kbd absolute top-1/2 right-2 -translate-y-1/2">{shortcutHint}</Kbd>
        {open && hits.length > 0 ? (
          <Card className="absolute top-11 z-40 w-full overflow-hidden p-1 shadow-pop">
            {hits.map((h) => (
              <button
                key={`${h.type}-${h.id}`}
                type="button"
                className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const [path, qs] = h.href.split("?");
                  const id = new URLSearchParams(qs ?? "").get("id");
                  void navigate({
                    to: path,
                    search: id ? { id: Number(id) } : {},
                  } as never);
                  setOpen(false);
                }}
              >
                <span className="text-sm">{h.title}</span>
                <span className="text-xs text-muted-foreground">
                  {h.type} · {h.subtitle}
                </span>
              </button>
            ))}
          </Card>
        ) : null}
      </div>
    ),
    [hits, navigate, open, q, shortcutHint],
  );

  return box;
}
