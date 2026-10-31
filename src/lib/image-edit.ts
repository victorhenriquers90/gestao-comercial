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

// Teto de tamanho do data: URL exportado. Fotos normais (celular, câmera) sempre
// batem essa meta já no primeiro degrau de qualidade -- só imagens patologicamente
// incompressíveis (ruído puro) chegam a reduzir qualidade/maxPx. Ver sanitizeImageUrl
// em sanitize.ts, cujo maxLen é calibrado contra essa garantia.
const COMPRESS_TARGET_CHARS = 150_000;
const QUALITY_LADDER = [0.84, 0.7, 0.55, 0.4] as const;
const MAXPX_SHRINK_RATIO = 0.6;
const MIN_MAXPX = 160;
const MAX_ATTEMPTS = 16;

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
  const { source, viewW, viewH, panX, panY, scale, quality = 0.84 } = opts;
  const sx = Math.max(0, -panX / scale);
  const sy = Math.max(0, -panY / scale);
  const sw = Math.min(opts.srcW - sx, viewW / scale);
  const sh = Math.min(opts.srcH - sy, viewH / scale);

  function encodeAt(maxPx: number, q: number): string {
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
    return canvas.toDataURL("image/jpeg", q);
  }

  // Passo único de hoje (maxPx/quality=0.84) na pratica ja fica pequeno, mas sem
  // nenhuma garantia para o caso patologico. Este laco tenta primeiro a qualidade
  // pedida e, só se o resultado passar da meta, reduz qualidade e depois maxPx --
  // nunca devolve "" (ver o incidente documentado em sanitize.ts sobre foto que
  // desaparecia em silêncio: o pior resultado possível ainda é melhor que nenhum).
  const ladder: number[] = QUALITY_LADDER.filter((q) => q <= quality);
  if (ladder.length === 0) ladder.push(quality);

  let currentMaxPx = opts.maxPx;
  let best = "";
  let attempts = 0;
  while (true) {
    for (const q of ladder) {
      attempts++;
      const dataUrl = encodeAt(currentMaxPx, q);
      if (!best || dataUrl.length < best.length) best = dataUrl;
      if (dataUrl.length <= COMPRESS_TARGET_CHARS || attempts >= MAX_ATTEMPTS) return best;
    }
    if (currentMaxPx <= MIN_MAXPX) return best;
    currentMaxPx = Math.max(MIN_MAXPX, Math.round(currentMaxPx * MAXPX_SHRINK_RATIO));
  }
}

export function coverScale(srcW: number, srcH: number, viewW: number, viewH: number): number {
  return Math.max(viewW / srcW, viewH / srcH);
}
