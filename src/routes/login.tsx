import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useState, type FormEvent, useEffect } from "react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient, authEnabled, ensureCsrfCookie } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({ component: LoginPage });

const fieldClass =
  "h-12 rounded-lg border-transparent bg-muted px-4 text-base transition-colors focus-visible:border-input focus-visible:bg-card";

// Better Auth's client returns an error `code` (e.g. "INVALID_EMAIL_OR_PASSWORD")
// alongside its own English `message` — key off `code` so this never depends on
// matching that English string.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha inválidos.",
  INVALID_EMAIL: "E-mail inválido.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail antes de entrar.",
  PASSWORD_TOO_SHORT: "A senha deve ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha é longa demais.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com este e-mail.",
  FAILED_TO_CREATE_USER: "Não foi possível criar a conta.",
};

function authErrorMessage(code: string | undefined, fallback: string): string {
  return (code && AUTH_ERROR_MESSAGES[code]) || fallback;
}

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureCsrfCookie();
  }, []);

  if (isPending) {
    return (
      <main className="login-page relative flex min-h-dvh flex-col items-center justify-center gap-3 px-6">
        <div className="login-photo" aria-hidden>
          <img
            src="/login-store.jpg"
            alt=""
            className="login-scene"
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <div className="relative z-[1] flex flex-col items-center gap-3">
          <BrandMark className="size-10" tone="inverse" />
          <p className="text-sm text-primary-foreground/85">Abrindo a loja…</p>
        </div>
      </main>
    );
  }
  if (user) {
    navigate({ to: "/app" });
    return null;
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    ensureCsrfCookie();
    try {
      if (mode === "up") {
        const res = await authClient.signUp.email({
          name: name.trim() || email.split("@")[0]!,
          email: email.trim(),
          password,
          callbackURL: "/app",
        });
        if (res.error) throw new Error(authErrorMessage(res.error.code, "Não foi possível criar a conta."));
      } else {
        const res = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: "/app",
        });
        if (res.error) throw new Error(authErrorMessage(res.error.code, "Não foi possível entrar. Tente novamente."));
      }
      navigate({ to: "/app" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticação.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode((m) => (m === "in" ? "up" : "in"));
    setError(null);
  }

  const signingUp = mode === "up";

  return (
    <main className="login-page relative min-h-dvh">
      <div className="login-photo" aria-hidden>
        <img
          src="/login-store.jpg"
          alt=""
          className="login-scene"
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <section className="login-panel">
        <div className="login-card motion-reduce:animate-none animate-in fade-in-0 zoom-in-95 duration-300 rounded-[1.5rem] p-7 lg:p-9">
            <div className="mb-7 flex items-center gap-3">
              <BrandMark className="size-10" />
              <p className="ed-label">{APP_NAME}</p>
            </div>

            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {signingUp ? "Criar a loja" : "Abrir a loja"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {signingUp
                ? "Uma empresa, um painel. Depois você convida a equipe."
                : "Acesse o PDV, a folha e o caixa da operação."}
            </p>

            {authEnabled ? (
              <>
                <form className="mt-7 grid gap-4" onSubmit={onEmail}>
              {signingUp ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="name" className="ed-label">
                    Nome
                  </Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="name"
                      className={cn(fieldClass, "pl-11")}
                      value={name}
                      autoComplete="name"
                      placeholder="Como aparece na loja"
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="ed-label">
                  E-mail
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className={cn(fieldClass, "pl-11")}
                    autoComplete="email"
                    placeholder="voce@loja.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password" className="ed-label">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className={cn(fieldClass, "pr-12 pl-11")}
                    autoComplete={signingUp ? "new-password" : "current-password"}
                    placeholder={signingUp ? "Mínimo 8 caracteres" : "Sua senha"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              {error ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="mt-1 w-full rounded-lg" disabled={busy}>
                {busy ? "Aguarde…" : signingUp ? "Criar conta" : "Entrar"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {signingUp ? "Já tem acesso?" : "Não tem conta?"}{" "}
              <button
                type="button"
                className="inline-flex h-11 items-center font-medium text-primary"
                onClick={switchMode}
              >
                {signingUp ? "Entrar" : "Criar agora"}
              </button>
            </p>
              </>
            ) : (
              <p className="mt-7 text-sm text-muted-foreground">Acesso desativado neste ambiente.</p>
            )}
          </div>
        </section>
    </main>
  );
}
