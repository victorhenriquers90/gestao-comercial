import { toast } from "sonner";

/**
 * Executa uma acao no servidor mostrando o erro quando ela falha.
 *
 * Existe porque o padrao `onClick={async () => { await algumaCoisaFn(...);
 * toast.success(...) }}` falha em SILENCIO: quando o servidor recusa, a
 * promise rejeita, o toast de sucesso nunca roda e nenhuma mensagem
 * aparece. A tela fica exatamente igual, como se o clique nao tivesse
 * pegado -- entao a pessoa clica de novo, e em formulario isso vira
 * registro duplicado.
 *
 * Ficou pior depois que varias funcoes ganharam `assertCan`: um papel sem
 * permissao passou a receber recusa de verdade, e sem isto aqui a tela nao
 * diz nada. Marcar uma tarefa do CRM simplesmente nao acontecia.
 *
 * Devolve `true` so quando deu certo, pra quem chama fazer o passo seguinte
 * (fechar dialogo, limpar campo, recarregar) apenas nesse caso.
 */
export async function runAction(
  acao: () => Promise<unknown>,
  opts?: { sucesso?: string; erro?: string },
): Promise<boolean> {
  try {
    await acao();
    if (opts?.sucesso) toast.success(opts.sucesso);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : (opts?.erro ?? "Não foi possível concluir."));
    return false;
  }
}
