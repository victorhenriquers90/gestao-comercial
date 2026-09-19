import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand";
import { Spinner } from "@/components/ui/spinner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6">
        {/* O anel gira EM VOLTA da marca em vez de ficar ao lado: mantem a
            identidade no centro da tela e o movimento acontece na moldura. */}
        <div className="relative grid size-16 place-items-center">
          <Spinner className="absolute inset-0 size-16" />
          <BrandMark className="size-8" />
        </div>
        <p className="text-sm text-muted-foreground">Abrindo a loja…</p>
      </div>
    );
  }
  if (user) return <Navigate to="/app" />;
  return <Navigate to="/login" />;
}
