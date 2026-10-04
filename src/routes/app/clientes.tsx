import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, EmptyState, PageHeader, Pager, PageSkeleton, QueryError, Td, Th } from "@/components/shared";
import { CustomerPanel } from "@/components/customer-panel";
import { useDebounced } from "@/hooks/use-debounced";
import { useSearchId, useSearchParam } from "@/hooks/use-search-id";
import { CRM_STAGE_LABELS, CRM_STAGES, isCrmStage, type CrmStage } from "@/lib/constants";
import { formatBRL, formatDoc } from "@/lib/format";
import { parseBrDocument, maskCnpj, maskCpf } from "@/lib/document";
import { listCustomersFn, saveCustomerFn } from "@/lib/server/party";

export const Route = createFileRoute("/app/clientes")({ component: ClientesPage });

const PAGE_SIZE = 100;

function ClientesPage() {
  const qc = useQueryClient();
  const searchId = useSearchId();
  // O quadro do CRM aponta pra ca (?etapa=) quando uma coluna tem mais cartoes do que cabe nela.
  const etapaDaUrl = useSearchParam("etapa");
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState<CrmStage | "">(etapaDaUrl && isCrmStage(etapaDaUrl) ? etapaDaUrl : "");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  // Risco menor que em compras/devolucoes (o documento e unico por empresa,
  // migration 0020, entao a duplicata esbarra na restricao) -- mas documento
  // em branco e permitido, e ai o duplo clique cria dois cadastros iguais.
  const [salvando, setSalvando] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState({ kind: "pf", name: "", document: "", phone: "", email: "", city: "", creditLimit: 0, notes: "" });

  // keepPreviousData: sem ele cada letra digitada derrubava a pagina inteira
  // para o esqueleto e o campo de busca perdia o foco.
  const termo = useDebounced(q.trim(), 250);
  const list = useQuery({
    queryKey: ["customers", "list", termo, etapa, page],
    queryFn: () =>
      listCustomersFn({
        data: { q: termo || undefined, stage: etapa || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const paginaVazia = !list.isPlaceholderData && list.data != null && items.length === 0 && page > 0;

  useEffect(() => {
    if (searchId) setDetailId(searchId);
  }, [searchId]);

  useEffect(() => {
    if (etapaDaUrl && isCrmStage(etapaDaUrl)) {
      setEtapa(etapaDaUrl);
      setPage(0);
    }
  }, [etapaDaUrl]);

  useEffect(() => {
    // Clientes apagados/filtrados com a pagina N aberta: volta pro comeco em vez de mostrar "vazio".
    if (paginaVazia) setPage(0);
  }, [paginaVazia]);

  if (list.isPending) return <PageSkeleton />;
  if (list.error) return <QueryError error={list.error} fallback="Erro ao carregar clientes." />;

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Pessoa física, jurídica e histórico comercial."
        actions={<Button onClick={() => setOpen(true)}>Novo cliente</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder="Nome, documento ou telefone"
          aria-label="Buscar cliente por nome, documento ou telefone"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <Select
          className="w-auto min-w-44"
          aria-label="Filtrar por etapa do CRM"
          value={etapa}
          onChange={(e) => {
            setEtapa(e.target.value as CrmStage | "");
            setPage(0);
          }}
        >
          <option value="">Todas as etapas</option>
          {CRM_STAGES.map((s) => (
            <option key={s} value={s}>
              {CRM_STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      {!items.length ? (
        // Busca/filtro sem resultado nao e "nenhum cliente cadastrado".
        termo || etapa ? (
          <EmptyState
            title={
              termo
                ? `Nenhum cliente encontrado para “${termo}”${etapa ? ` na etapa ${CRM_STAGE_LABELS[etapa]}` : ""}.`
                : `Nenhum cliente na etapa ${etapa ? CRM_STAGE_LABELS[etapa] : ""}.`
            }
            description="Confira a grafia, busque pelo documento ou telefone, ou mude a etapa."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setEtapa("");
                  setPage(0);
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState title="Você ainda não possui clientes cadastrados." description="Cadastre o primeiro cliente para vender a prazo e usar o CRM." action={<Button onClick={() => setOpen(true)}>Cadastrar primeiro cliente</Button>} />
        )
      ) : (
        <div className={list.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={list.isPlaceholderData}>
        <DataTable
          headers={
            <tr>
              <Th>Nome</Th>
              <Th>Documento</Th>
              <Th>Telefone</Th>
              <Th>CRM</Th>
              <Th className="col-num">Total comprado</Th>
              <Th className="col-num">Em aberto</Th>
            </tr>
          }
        >
          {items.map((c) => (
            <tr
              key={c.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              onClick={() => setDetailId(c.id)}
            >
              <Td className="font-medium">{c.name}</Td>
              <Td>{formatDoc(c.document)}</Td>
              <Td>{c.phone ?? "—"}</Td>
              <Td>
                <Badge variant={statusBadgeVariant(c.crm_stage)}>
                  {CRM_STAGE_LABELS[c.crm_stage as CrmStage] ?? c.crm_stage}
                </Badge>
              </Td>
              <Td className="tabular col-num">{formatBRL(c.total_bought)}</Td>
              <Td className="tabular col-num">{formatBRL(c.open_balance)}</Td>
            </tr>
          ))}
        </DataTable>
        <Pager page={page} pageSize={PAGE_SIZE} shown={items.length} total={total} onPage={setPage} />
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-block">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="pf">Pessoa física</option>
              <option value="pj">Pessoa jurídica</option>
            </Select>
            <Field label="Nome / Razão social">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={form.kind === "pj" ? "CNPJ" : "CPF"}>
              <Input
                value={form.document}
                inputMode="numeric"
                placeholder={form.kind === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    document: form.kind === "pj" ? maskCnpj(e.target.value) : maskCpf(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Cidade">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Limite de crédito">
              <Input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })} />
            </Field>
            <Textarea placeholder="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <Button
              disabled={salvando}
              onClick={async () => {
                if (salvando) return;
                setSalvando(true);
                try {
                  parseBrDocument(form.document, form.kind === "pj" ? "cnpj" : "cpf");
                  await saveCustomerFn({
                    data: {
                      kind: form.kind,
                      name: form.name,
                      document: form.document,
                      phone: form.phone,
                      whatsapp: form.phone,
                      email: form.email,
                      city: form.city,
                      creditLimit: form.creditLimit,
                      notes: form.notes,
                    },
                  });
                  toast.success("Cliente salvo.");
                  setOpen(false);
                  void qc.invalidateQueries({ queryKey: ["customers"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha");
                } finally {
                  setSalvando(false);
                }
              }}
            >
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CustomerPanel
        customerId={detailId}
        open={detailId != null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />
    </div>
  );
}
