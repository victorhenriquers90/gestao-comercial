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
    toast.error(mensagemDeErro(e, opts?.erro));
    return false;
  }
}

/**
 * `e.message` e confiavel quando vem do SERVIDOR (ja em pt-BR, pensado
 * pro operador -- "Este titulo ja esta quitado."). Mas `fetch` que nunca
 * completa (wifi caiu, DNS, CORS, meio de um deploy) tambem rejeita com
 * um `Error` -- so que `TypeError`, com texto em ingles pro
 * desenvolvedor ("Failed to fetch", "NetworkError when attempting to
 * fetch resource."). Mostrar isso pro operador de balcao quebra a regra
 * do proprio HANDOFF ("toasts e erros para o operador, nao para o
 * desenvolvedor") bem na hora que mais importa: a rede caiu, nao da pra
 * saber se o clique pegou ou nao.
 */
export function mensagemDeErro(e: unknown, fallback?: string): string {
  const padrao = fallback ?? "Não foi possível concluir.";
  if (e instanceof TypeError) return padrao;
  return e instanceof Error ? e.message : padrao;
}
