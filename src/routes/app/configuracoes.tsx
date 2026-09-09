import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IssSettingsPanel } from "@/components/iss-rate";
import { ImageField } from "@/components/image-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { NativeCheckbox, Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, PageSkeleton } from "@/components/shared";
import { ROLE_LABELS, ROLES } from "@/lib/permissions";
import {
  getSettingsFn,
  inviteMemberFn,
  listAuditFn,
  saveCompanyFn,
  saveStoreFn,
  updateMemberFn,
} from "@/lib/server/session";
import { nfceStatusFn } from "@/lib/server/nfce";
import { formatDateTime } from "@/lib/format";
import { parseCnpj, maskCnpj } from "@/lib/document";
import { clampIss, ISS_DEFAULT } from "@/lib/tax";
import { isTaxRegime, TAX_REGIME_LABELS, type TaxRegime } from "@/lib/nfce";

const CONFIG_TABS = ["empresa", "lojas", "equipe", "print", "impostos", "audit"] as const;
type ConfigTab = (typeof CONFIG_TABS)[number];

function isConfigTab(v: string | null | undefined): v is ConfigTab {
  return !!v && (CONFIG_TABS as readonly string[]).includes(v);
}

export const Route = createFileRoute("/app/configuracoes")({ component: ConfigPage });

function ConfigPage() {
  const qc = useQueryClient();
  const loc = useLocation();
  const navigate = useNavigate();
  const rawTab =
    typeof (loc.search as { tab?: unknown }).tab === "string"
      ? (loc.search as { tab?: string }).tab
      : new URLSearchParams(loc.searchStr.replace(/^\?/, "")).get("tab");
  const tab: ConfigTab = isConfigTab(rawTab) ? rawTab : "empresa";
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettingsFn() });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => listAuditFn({ data: {} }) });
  const nfceStatus = useQuery({ queryKey: ["nfce-status"], queryFn: () => nfceStatusFn() });
  const [form, setForm] = useState({
    name: "",
    tradeName: "",
    document: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    logoUrl: "",
    printHeader: "",
    printFooter: "",
    receiptMessage: "",
    allowNegativeStock: false,
    issRate: String(ISS_DEFAULT),
    issWithhold: true,
    ie: "",
    taxRegime: "simples" as TaxRegime,
    nfceEnabled: false,
  });
  const [invite, setInvite] = useState({ email: "", role: "vendedor" });
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    const c = settings.data?.company as Record<string, unknown> | undefined;
    const s = settings.data?.settings as Record<string, unknown> | null | undefined;
    if (!c) return;
    setForm({
      name: String(c.name ?? ""),
      tradeName: String(c.trade_name ?? ""),
      document: String(c.document ?? ""),
      email: String(c.email ?? ""),
      phone: String(c.phone ?? ""),
      address: String(c.address ?? ""),
      city: String(c.city ?? ""),
      state: String(c.state ?? ""),
      zip: String(c.zip ?? ""),
      logoUrl: String(c.logo_url ?? ""),
      printHeader: String(s?.print_header ?? ""),
      printFooter: String(s?.print_footer ?? ""),
      receiptMessage: String(s?.receipt_message ?? ""),
      allowNegativeStock: Boolean(s?.allow_negative_stock),
      issRate: s?.iss_rate == null ? String(ISS_DEFAULT) : String(s.iss_rate),
      issWithhold: s?.iss_withhold !== false,
      ie: String(c.ie ?? ""),
      taxRegime: isTaxRegime(c.tax_regime) ? c.tax_regime : "simples",
      nfceEnabled: Boolean(s?.nfce_enabled),
    });
  }, [settings.data]);

  function companyPayload() {
    return {
      name: form.name,
      tradeName: form.tradeName,
      document: form.document,
      email: form.email,
      phone: form.phone,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
      logoUrl: form.logoUrl || null,
      printHeader: form.printHeader,
      printFooter: form.printFooter,
      receiptMessage: form.receiptMessage,
      allowNegativeStock: form.allowNegativeStock,
      issRate: clampIss(form.issRate),
      issWithhold: form.issWithhold,
      ie: form.ie,
      taxRegime: form.taxRegime,
      nfceEnabled: form.nfceEnabled,
    };
  }

  function setTab(next: string) {
    const v = isConfigTab(next) ? next : "empresa";
    void navigate({
      to: "/app/configuracoes",
      search: (v === "empresa" ? {} : { tab: v }) as never,
      replace: true,
    });
  }

  if (settings.isPending) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Configurações" description="Empresa, lojas, equipe, ISS, impressão e auditoria." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="lojas">Lojas</TabsTrigger>
          <TabsTrigger value="equipe">Usuários</TabsTrigger>
          <TabsTrigger value="print">Impressão</TabsTrigger>
          <TabsTrigger value="impostos">Impostos</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="empresa">
          <Card className="max-w-xl space-y-block p-5">
            <ImageField
              value={form.logoUrl}
              onChange={(logoUrl) => setForm({ ...form, logoUrl })}
              label="Logo da loja"
              aspect="1:1"
              maxPx={320}
              kind="logo"
              suggest={form.tradeName || form.name}
              hint="Quadrado. Envie um arquivo ou gere a marca com IA."
            />
            <Field label="Razão / nome">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Nome fantasia">
              <Input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
            </Field>
            <Field label="CNPJ">
              <Input
                value={form.document}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                onChange={(e) => setForm({ ...form, document: maskCnpj(e.target.value) })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-block">
              <Field label="Inscrição Estadual">
                <Input value={form.ie} onChange={(e) => setForm({ ...form, ie: e.target.value })} />
              </Field>
              <Field label="Regime tributário">
                <Select
                  value={form.taxRegime}
                  onChange={(e) => setForm({ ...form, taxRegime: e.target.value as TaxRegime })}
                >
                  {Object.entries(TAX_REGIME_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-block">
              <Field label="E-mail">
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Telefone">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <Field label="Endereço">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-block">
              <Field label="Cidade">
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label="UF">
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </Field>
              <Field label="CEP">
                <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={form.allowNegativeStock}
                onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })}
              />
              Permitir estoque negativo
            </label>
            <Button
              onClick={async () => {
                try {
                  parseCnpj(form.document);
                  await saveCompanyFn({ data: companyPayload() });
                  toast.success("Empresa atualizada.");
                  void qc.invalidateQueries({ queryKey: ["settings"] });
                  void qc.invalidateQueries({ queryKey: ["tenant"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha");
                }
              }}
            >
              Salvar
            </Button>
          </Card>
        </TabsContent>
        <TabsContent value="lojas">
          <Card className="max-w-xl space-y-block p-5">
            {(settings.data?.stores as Record<string, unknown>[] | undefined)?.map((s) => (
              <div key={String(s.id)} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{String(s.name)}</span>
                <span className="text-muted-foreground">{String(s.city ?? "")}</span>
              </div>
            ))}
            <Field label="Nova loja">
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
            </Field>
            <Button
              onClick={async () => {
                if (!storeName.trim()) return;
                await saveStoreFn({ data: { name: storeName } });
                setStoreName("");
                toast.success("Loja criada.");
                void qc.invalidateQueries({ queryKey: ["settings"] });
                void qc.invalidateQueries({ queryKey: ["tenant"] });
              }}
            >
              Adicionar loja
            </Button>
          </Card>
        </TabsContent>
        <TabsContent value="equipe">
          <Card className="max-w-xl space-y-block p-5">
            {(settings.data?.members ?? []).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{m.name || m.email || m.user_id}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Select
                  value={m.role}
                  className="w-40"
                  onChange={(e) => {
                    void updateMemberFn({ data: { id: m.id, role: e.target.value } })
                      .then(() => {
                        toast.success("Papel atualizado.");
                        void qc.invalidateQueries({ queryKey: ["settings"] });
                      })
                      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Falha"));
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
            <Field label="Convidar por e-mail">
              <Input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
            <Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button
              onClick={async () => {
                await inviteMemberFn({ data: invite });
                toast.success("Convite enviado. A pessoa entra ao autenticar com este e-mail.");
                void qc.invalidateQueries({ queryKey: ["settings"] });
              }}
            >
              Convidar
            </Button>
          </Card>
        </TabsContent>
        <TabsContent value="print">
          <Card className="max-w-xl space-y-block p-5">
            <Field label="Cabeçalho do comprovante">
              <Input value={form.printHeader} onChange={(e) => setForm({ ...form, printHeader: e.target.value })} />
            </Field>
            <Field label="Rodapé">
              <Input value={form.printFooter} onChange={(e) => setForm({ ...form, printFooter: e.target.value })} />
            </Field>
            <Field label="Mensagem da nota">
              <Textarea value={form.receiptMessage} onChange={(e) => setForm({ ...form, receiptMessage: e.target.value })} />
            </Field>
            <Button
              onClick={async () => {
                await saveCompanyFn({ data: companyPayload() });
                toast.success("Modelo de impressão salvo.");
              }}
            >
              Salvar impressão
            </Button>
          </Card>
        </TabsContent>
        <TabsContent value="impostos">
          <IssSettingsPanel
            issRate={form.issRate}
            issWithhold={form.issWithhold}
            onIssRate={(v) => setForm({ ...form, issRate: v })}
            onIssWithhold={(v) => setForm({ ...form, issWithhold: v })}
            onSave={async () => {
              await saveCompanyFn({ data: companyPayload() });
              toast.success("Alíquota de ISS salva.");
              void qc.invalidateQueries({ queryKey: ["settings"] });
              void qc.invalidateQueries({ queryKey: ["sellers"] });
              void qc.invalidateQueries({ queryKey: ["dashboard"] });
              void qc.invalidateQueries({ queryKey: ["retention-guide"] });
              void qc.invalidateQueries({ queryKey: ["tenant"] });
            }}
          />
          <Card className="mt-4 max-w-xl space-y-block p-5">
            <p className="ed-label">Nota fiscal (NFC-e)</p>
            <p className="text-sm text-muted-foreground">
              Emissão via Focus NFe.{" "}
              {nfceStatus.data?.available ? (
                <>
                  Configurada, ambiente{" "}
                  <strong>{nfceStatus.data.env === "producao" ? "produção" : "homologação"}</strong>.
                </>
              ) : (
                "Nenhuma credencial configurada no servidor (FOCUS_NFE_TOKEN) — a emissão fica indisponível até isso ser feito."
              )}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={form.nfceEnabled}
                onChange={(e) => setForm({ ...form, nfceEnabled: e.target.checked })}
              />
              Mostrar emissão de NFC-e nas vendas
            </label>
            <p className="text-xs text-muted-foreground">
              Cada produto precisa de NCM cadastrado pra emitir — configure em Produtos.
            </p>
            <Button
              onClick={async () => {
                await saveCompanyFn({ data: companyPayload() });
                toast.success("Configuração de nota fiscal salva.");
                void qc.invalidateQueries({ queryKey: ["settings"] });
              }}
            >
              Salvar
            </Button>
          </Card>
        </TabsContent>
        <TabsContent value="audit">
          <Card className="p-5">
            <div className="space-y-2 text-sm">
              {(audit.data as Record<string, unknown>[] | undefined)?.map((a) => (
                <div key={String(a.id)} className="flex justify-between gap-3 border-b border-border py-2 last:border-0">
                  <span>
                    {String(a.action)} · {String(a.entity)} {String(a.entity_id ?? "")}
                  </span>
                  <span className="text-muted-foreground">{formatDateTime(String(a.created_at))}</span>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
