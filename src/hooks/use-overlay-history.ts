import { useCallback, useEffect, useId } from "react";
import {
  overlayStack,
  pushOverlayHistory,
  releaseOverlayHistory,
} from "@/lib/overlay-history";

/**
 * Puts a controlled overlay on the session history so the OS back gesture
 * (Android predictive back, iOS edge swipe, browser Back) closes it first.
 */
export function useOverlayHistory(
  open: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
): (open: boolean) => void {
  const id = useId();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) pushOverlayHistory(id, () => onOpenChange?.(false));
      else releaseOverlayHistory(id);
      onOpenChange?.(next);
    },
    [id, onOpenChange],
  );

  useEffect(() => {
    if (open === undefined) return;
    if (open) pushOverlayHistory(id, () => onOpenChange?.(false));
    else if (overlayStack.has(id)) overlayStack.abandon(id);
  }, [open, id, onOpenChange]);

  useEffect(() => {
    return () => {
      overlayStack.abandon(id);
    };
  }, [id]);

  return handleOpenChange;
}
