import { useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import { inviteMemberFn, renewInviteFn, revokeInviteFn } from "@/lib/server/session";

type Convite = {
  id: number;
  label: string;
  role: string;
  expires_at: string | null;
  vencido: boolean;
};

type LinkGerado = { para: string; papel: string; url: string; dias: number };

const papelLabel = (r: string) => ROLE_LABELS[r as Role] ?? r;

/*
  Convite por link. O link (com token) e o que da acesso -- nao o e-mail.
  Ele aparece uma vez, na hora de gerar; no banco fica so o hash, entao
  perdeu o link, gera outro (o antigo para de valer).
*/
export function InvitePanel({ convites }: { convites: Convite[] }) {
  const qc = useQueryClient();
  const [para, setPara] = useState("");
  const [papel, setPapel] = useState<string>("vendedor");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [link, setLink] = useState<LinkGerado | null>(null);

  const montarLink = (token: string) => `${window.location.origin}/login?convite=${token}`;

  async function acao(chave: string, fn: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(chave);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setOcupado(null);
    }
  }

  const gerar = () =>
    acao("novo", async () => {
      const res = await inviteMemberFn({ data: { label: para, role: papel } });
      setLink({ para: para.trim(), papel, url: montarLink(res.token), dias: res.expiresInDays });
      setPara("");
    });

  const renovar = (c: Convite) =>
    acao(`renovar-${c.id}`, async () => {
      const res = await renewInviteFn({ data: { id: c.id } });
      setLink({ para: c.label, papel: c.role, url: montarLink(res.token), dias: res.expiresInDays });
    });

  const cancelar = (c: Convite) =>
    acao(`cancelar-${c.id}`, async () => {
      await revokeInviteFn({ data: { id: c.id } });
      toast.success("Convite cancelado.");
    });

  const copiar = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      // Sem permissao de area de transferencia (http fora do localhost):
      // o campo fica selecionavel pra copiar na mao.
      toast.error("Não deu pra copiar automaticamente. Selecione o link e copie.");
    }
  };

  const mensagem = (l: LinkGerado) =>
    `Convite para entrar no sistema da loja como ${papelLabel(l.papel)}: ${l.url}`;

  return (
    <div className="space-y-block">
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Convidar pessoa</p>
        <Field label="Para quem (só pra identificar)">
          <Input value={para} placeholder="Nome ou e-mail" onChange={(e) => setPara(e.target.value)} />
        </Field>
        <Field label="Papel">
          <Select value={papel} onChange={(e) => setPapel(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Button disabled={ocupado !== null} onClick={() => void gerar()}>
          <Link2 />
          Gerar link de convite
        </Button>
      </div>

      {link ? (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" role="status">
          <p className="text-sm">
            Link {link.para ? `para ${link.para} ` : ""}como <strong>{papelLabel(link.papel)}</strong>. Vale{" "}
            {link.dias} dias e serve para uma pessoa só. Envie só para quem vai usar: quem tiver o
            link entra na empresa.
          </p>
          <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link de convite" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copiar(link.url)}>
              <Copy />
              Copiar link
            </Button>
            <Button variant="outline" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(mensagem(link))}`} target="_blank" rel="noreferrer">
                <MessageCircle />
                Enviar no WhatsApp
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {convites.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Convites pendentes</p>
          {convites.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{c.label || "Sem identificação"}</p>
                <p className="text-xs text-muted-foreground">
                  {papelLabel(c.role)} ·{" "}
                  {c.vencido
                    ? "link vencido: gere outro"
                    : c.expires_at
                      ? `vale até ${formatDateTime(c.expires_at)}`
                      : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => void renovar(c)}>
                  Novo link
                </Button>
                <Button size="sm" variant="ghost" disabled={ocupado !== null} onClick={() => void cancelar(c)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
