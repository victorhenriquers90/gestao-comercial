import { useCallback, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

/**
 * Tablet de balcao: quer tela cheia de verdade (sem barra de endereco nem
 * nav do Android), nao so sem a barra do app. `requestFullscreen` exige
 * gesto do usuario -- nao da pra chamar sozinho no mount.
 */
export function useFullscreen(): { isFullscreen: boolean; enter: () => void } {
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => document.fullscreenElement != null,
    () => false,
  );
  const enter = useCallback(() => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen().catch(() => {
      // Navegador recusou (sem suporte, ou fora de gesto do usuario) --
      // a tela continua usavel do mesmo jeito, so sem esconder o SO.
    });
  }, []);
  return { isFullscreen, enter };
}
