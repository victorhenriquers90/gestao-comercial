import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useState, type FormEvent, useEffect } from "react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient, authEnabled, ensureCsrfCookie } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APP_NAME } from "@/lib/constants";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { acceptInviteFn, openInviteFn } from "@/lib/server/session";
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
  SIGNUP_CLOSED: "Cadastro só por convite. Peça ao administrador um link de convite.",
};

type ConviteInfo = { companyName: string; role: string; label: string };

function authErrorMessage(code: string | undefined, fallback: string): string {
  return (code && AUTH_ERROR_MESSAGES[code]) || fallback;
}

/**
 * Cadastro so acessivel via "/login?cadastro" (sem link visivel na tela
 * normal) -- quem instala o sistema usa esse endereco uma vez pra criar a
 * primeira conta/empresa; no dia a dia da loja o login nao deve convidar
 * ninguem a criar uma empresa nova por engano.
 */
function useSearchParam(name: string): string | null {
  const loc = useLocation();
  return new URLSearchParams(loc.searchStr.replace(/^\?/, "")).get(name);
}

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const wantsSignup = useSearchParam("cadastro") !== null;
  const conviteToken = useSearchParam("convite");
  const [mode, setMode] = useState<"in" | "up">(wantsSignup || conviteToken ? "up" : "in");
  const [convite, setConvite] = useState<ConviteInfo | null>(null);
  const [conviteErro, setConviteErro] = useState<string | null>(null);
  const [aceitando, setAceitando] = useState(false);

  // Sem conta: valida o link e deixa o token num cookie httpOnly, que o
  // cadastro e o primeiro acesso a /app leem no servidor.
  useEffect(() => {
    if (!conviteToken || isPending || user) return;
    let vivo = true;
    openInviteFn({ data: { token: conviteToken } })
      .then((info) => vivo && setConvite(info))
      .catch((err: unknown) =>
        vivo && setConviteErro(err instanceof Error ? err.message : "Convite inválido ou expirado."),
      );
    return () => {
      vivo = false;
    };
  }, [conviteToken, isPending, user]);

  // Ja logado: aceita direto e segue pro sistema.
  useEffect(() => {
    if (!conviteToken || isPending || !user || aceitando) return;
    setAceitando(true);
    acceptInviteFn({ data: { token: conviteToken } })
      .then(() => navigate({ to: "/app" }))
      .catch((err: unknown) =>
        setConviteErro(err instanceof Error ? err.message : "Não foi possível aceitar o convite."),
      );
  }, [conviteToken, isPending, user, aceitando, navigate]);
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
          <div className="relative grid size-16 place-items-center">
            <Spinner className="absolute inset-0 size-16" tone="inverse" />
            <BrandMark className="size-8" tone="inverse" />
          </div>
          <p className="text-sm text-primary-foreground/85">Abrindo a loja…</p>
        </div>
      </main>
    );
  }
  if (user && conviteToken) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm space-y-4">
          {conviteErro ? (
            <>
              <p className="text-sm text-destructive">{conviteErro}</p>
              <Button onClick={() => navigate({ to: "/app" })}>Ir para o sistema</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Aceitando o convite…</p>
          )}
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
    // O aceite vem daqui, logo depois de autenticar; o efeito de "ja
    // logado" nao pode disparar junto (o segundo aceite leria "invalido").
    if (conviteToken) setAceitando(true);
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
      if (conviteToken) await acceptInviteFn({ data: { token: conviteToken } });
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
        <div className="login-card animate-in fade-in-0 zoom-in-95 duration-300 rounded-2xl p-6 lg:p-8">
            <div className="mb-7 flex items-center gap-3">
              <BrandMark className="size-10" />
              <p className="ed-label">{APP_NAME}</p>
            </div>

            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {signingUp ? "Criar a loja" : "Abrir a loja"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {convite
                ? `Você foi convidado para ${convite.companyName} como ${ROLE_LABELS[convite.role as Role] ?? convite.role}. ${signingUp ? "Crie sua conta para entrar." : "Entre com sua conta para aceitar."}`
                : signingUp
                  ? "Uma empresa, um painel. Depois você convida a equipe."
                  : "Acesse o PDV, a folha e o caixa da operação."}
            </p>
            {conviteErro && !user ? (
              <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {conviteErro}
              </p>
            ) : null}

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

            {signingUp ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                {convite ? "Já tem conta?" : "Já tem uma loja cadastrada?"}{" "}
                <button
                  type="button"
                  className="inline-flex h-11 items-center font-medium text-primary"
                  onClick={switchMode}
                >
                  Entrar
                </button>
              </p>
            ) : convite ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Ainda não tem conta?{" "}
                <button
                  type="button"
                  className="inline-flex h-11 items-center font-medium text-primary"
                  onClick={switchMode}
                >
                  Criar conta
                </button>
              </p>
            ) : null}
              </>
            ) : (
              <p className="mt-7 text-sm text-muted-foreground">Acesso desativado neste ambiente.</p>
            )}
          </div>
        </section>
    </main>
  );
}
