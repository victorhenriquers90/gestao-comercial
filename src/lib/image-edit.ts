export type AspectId = "1:1" | "4:5" | "3:2" | "16:9" | "livre";

export const ASPECTS: { id: AspectId; label: string; value: number | null }[] = [
  { id: "1:1", label: "Quadrado", value: 1 },
  { id: "4:5", label: "Retrato", value: 4 / 5 },
  { id: "3:2", label: "Foto", value: 3 / 2 },
  { id: "16:9", label: "Panorama", value: 16 / 9 },
  { id: "livre", label: "Livre", value: null },
];

export function aspectRatio(id: AspectId): number | null {
  return ASPECTS.find((a) => a.id === id)?.value ?? null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Escolha um arquivo de imagem."));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error("A imagem passa de 8 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = src;
  });
}

export function rotateSource(img: HTMLImageElement, deg: number): HTMLCanvasElement {
  const r = ((deg % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}

export function exportCrop(opts: {
  source: CanvasImageSource;
  srcW: number;
  srcH: number;
  viewW: number;
  viewH: number;
  panX: number;
  panY: number;
  scale: number;
  maxPx: number;
  quality?: number;
}): string {
  const { source, viewW, viewH, panX, panY, scale, maxPx, quality = 0.84 } = opts;
  const sx = Math.max(0, -panX / scale);
  const sy = Math.max(0, -panY / scale);
  const sw = Math.min(opts.srcW - sx, viewW / scale);
  const sh = Math.min(opts.srcH - sy, viewH / scale);
  const outScale = Math.min(1, maxPx / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * outScale));
  const h = Math.max(1, Math.round(sh * outScale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function coverScale(srcW: number, srcH: number, viewW: number, viewH: number): number {
  return Math.max(viewW / srcW, viewH / srcH);
}
