import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/client";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getTenantFn } from "@/lib/server/session";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const tenant = useQuery({
    queryKey: ["tenant"],
    queryFn: () => getTenantFn(),
    enabled: Boolean(user),
  });

  if (isPending || (user && tenant.isPending)) {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="hidden w-64 bg-sidebar p-4 md:block">
          <Skeleton className="h-8 w-36 bg-sidebar-accent" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full bg-sidebar-accent" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-10 w-64" />
          <div className="mt-6 kpi-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;
  if (tenant.error || !tenant.data) {
    // Conta sem empresa (cadastro fechado, convite ainda nao aceito) cai
    // aqui: sem o Sair, a pessoa ficava presa numa tela sem saida.
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm space-y-4">
          <p className="text-sm text-destructive">
            {tenant.error instanceof Error ? tenant.error.message : "Não foi possível carregar a empresa."}
          </p>
          <Button variant="outline" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AppShell tenant={tenant.data}>
      <Outlet />
    </AppShell>
  );
}
