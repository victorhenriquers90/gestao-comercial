import { useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NFCE_STATUS_LABELS } from "@/lib/constants";
import { nfceNeedsSefazCancel, validateNfceCancelJustificativa } from "@/lib/nfce";
import { cancelNfceFn, emitNfceFn, refreshNfceStatusFn } from "@/lib/server/nfce";

export type NfcePanelState = {
  status?: string | null;
  error?: string | null;
  danfeUrl?: string | null;
};

export function NfcePanel({
  saleId,
  status,
  error,
  danfeUrl,
  tokenAvailable,
  allowCancel = false,
  onChanged,
}: {
  saleId: number;
  status?: string | null;
  error?: string | null;
  danfeUrl?: string | null;
  tokenAvailable: boolean;
  allowCancel?: boolean;
  onChanged?: (next: NfcePanelState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const label = status ? (NFCE_STATUS_LABELS[status] ?? status) : null;
  const showCancel = allowCancel && nfceNeedsSefazCancel(status);

  async function emit() {
    setBusy(true);
    try {
      const res = await emitNfceFn({ data: { saleId } });
      if (res.ok) {
        toast.success("Nota fiscal enviada — processando na SEFAZ.");
        onChanged?.({ status: res.status, error: null, danfeUrl: danfeUrl ?? null });
      } else {
        res.errors.forEach((e) => toast.error(e));
        onChanged?.({ status: "erro", error: res.errors[0] ?? "Falha ao emitir.", danfeUrl: null });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao emitir.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const res = await refreshNfceStatusFn({ data: { saleId } });
      if (res.error) toast.error(res.error);
      onChanged?.({ status: res.status, error: res.error, danfeUrl: res.danfeUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar status.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const reasonError = validateNfceCancelJustificativa(justificativa);
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    setBusy(true);
    try {
      const res = await cancelNfceFn({ data: { saleId, justificativa } });
      if (res.ok) {
        toast.success("NFC-e cancelada na SEFAZ.");
        onChanged?.({ status: res.status, error: null, danfeUrl: null });
        setJustificativa("");
      } else {
        res.errors.forEach((e) => toast.error(e));
        onChanged?.({ status: "erro_cancelamento", error: res.errors[0] ?? "Falha ao cancelar.", danfeUrl });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar a nota.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Nota fiscal (NFC-e)</p>
        {label ? <Badge variant={statusBadgeVariant(String(status))}>{label}</Badge> : null}
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {!status || status === "erro" || status === "erro_autorizacao" ? (
          <Button size="sm" disabled={busy || !tokenAvailable} onClick={() => void emit()}>
            {busy ? "Emitindo…" : "Emitir NFC-e"}
          </Button>
        ) : null}
        {status === "processando_autorizacao" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Consultando…" : "Atualizar status"}
          </Button>
        ) : null}
        {danfeUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={danfeUrl} target="_blank" rel="noreferrer">
              Ver DANFE
            </a>
          </Button>
        ) : null}
      </div>
      {showCancel ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            className="min-w-48 flex-1"
            placeholder="Justificativa (mín. 15 caracteres)"
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={busy || !tokenAvailable} onClick={() => void cancel()}>
            {busy ? "Cancelando…" : "Cancelar NFC-e"}
          </Button>
        </div>
      ) : null}
      {!tokenAvailable ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Emissão não configurada no servidor (FOCUS_NFE_TOKEN).
        </p>
      ) : null}
    </div>
  );
}
