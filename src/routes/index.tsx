import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6">
        <BrandMark className="size-10" />
        <p className="text-sm text-muted-foreground">Abrindo a loja…</p>
      </div>
    );
  }
  if (user) return <Navigate to="/app" />;
  return <Navigate to="/login" />;
}
