import { ImagePlus, RotateCw, Sparkles, Trash2, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import {
  ASPECTS,
  aspectRatio,
  coverScale,
  exportCrop,
  loadImage,
  readFileAsDataUrl,
  rotateSource,
  type AspectId,
} from "@/lib/image-edit";
import {
  aiImageStatusFn,
  expandCatalogPromptFn,
  generateCatalogImageFn,
  IMAGE_ENGINES,
  IMAGE_LOOKS,
  IMAGE_STYLES,
  PROMPT_CHIPS,
  PROMPT_FRAMEWORKS,
  SHOT_EXAMPLES,
  type ImageEngineId,
  type ImageFrameworkId,
  type ImageKind,
  type ImageLookId,
  type ImageStyleId,
  type PromptShot,
} from "@/lib/server/imagine";
import { cn } from "@/lib/utils";

const SHOT_KEY = "gc-catalog-shots";

function loadShots(): PromptShot[] {
  try {
    const raw = localStorage.getItem(SHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PromptShot[];
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

function saveShot(note: string, brief: string) {
  const next: PromptShot[] = [{ note: note.slice(0, 180), brief: brief.slice(0, 280) }, ...loadShots().filter((s) => s.brief !== brief)].slice(0, 3);
  localStorage.setItem(SHOT_KEY, JSON.stringify(next));
}

export function ImageField({
  value,
  onChange,
  label = "Foto",
  aspect = "1:1",
  maxPx = 720,
  hint,
  suggest,
  kind = "product",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  aspect?: AspectId;
  maxPx?: number;
  hint?: string;
  suggest?: string;
  kind?: ImageKind;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 text-left hover:border-primary hover:bg-muted"
      >
        <span className="tile-photo size-16 shrink-0">
          {value ? (
            <img src={value} alt="" />
          ) : (
            <span className="tile-photo-fallback">
              <ImagePlus className="size-4" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {value ? "Alterar recorte" : "Foto ou gerar com IA"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {hint ?? "Envie um arquivo ou descreva o item. O recorte prioriza a parte de cima — rostos não saem do quadro."}
          </span>
        </span>
      </button>
      {value ? (
        <button
          type="button"
          className="mt-1.5 inline-flex h-9 items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onChange("")}
        >
          <Trash2 className="size-3.5" />
          Remover foto
        </button>
      ) : null}
      <ImageEditorDialog
        open={open}
        onOpenChange={setOpen}
        value={value}
        aspect={aspect}
        maxPx={maxPx}
        suggest={suggest}
        kind={kind}
        onApply={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </div>
  );
}

function ImageEditorDialog({
  open,
  onOpenChange,
  value,
  onApply,
  aspect: initialAspect,
  maxPx,
  suggest,
  kind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  onApply: (next: string) => void;
  aspect: AspectId;
  maxPx: number;
  suggest?: string;
  kind: ImageKind;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [src, setSrc] = useState(value);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rot, setRot] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [aspect, setAspect] = useState<AspectId>(initialAspect);
  const [view, setView] = useState({ w: 420, h: 420 });
  const [prompt, setPrompt] = useState(suggest ?? "");
  const [style, setStyle] = useState<ImageStyleId>("catalogo");
  const [engine, setEngine] = useState<ImageEngineId>("equilibrio");
  const [look, setLook] = useState<ImageLookId>("realista");
  const [framework, setFramework] = useState<ImageFrameworkId>("shot");
  const [pair, setPair] = useState<{ id: ImageLookId; dataUrl: string }[] | null>(null);
  const [lockSeed, setLockSeed] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [shots, setShots] = useState<PromptShot[]>([]);
  const [useShots, setUseShots] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSrc(value);
    setRot(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAspect(initialAspect);
    setPrompt(suggest ?? "");
    setStyle("catalogo");
    setEngine("equilibrio");
    setLook("realista");
    setFramework("shot");
    setPair(null);
    setShots(loadShots());
    setLockSeed(false);
    setSeed(null);
    void aiImageStatusFn().then((s) => setAiOn(s.available)).catch(() => setAiOn(false));
  }, [open, value, initialAspect, suggest]);

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    let cancelled = false;
    void loadImage(src)
      .then((el) => {
        if (!cancelled) setImg(el);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha na imagem"));
    return () => {
      cancelled = true;
    };
  }, [src]);

  const measure = useCallback(() => {
    const el = viewRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const ratio = aspectRatio(aspect) ?? 1;
    const h = Math.min(360, Math.round(w / ratio));
    setView({ w, h });
  }, [aspect]);

  useEffect(() => {
    measure();
  }, [measure, open, img]);

  const rotated = img ? rotateSource(img, rot) : null;
  const srcW = rotated?.width ?? 1;
  const srcH = rotated?.height ?? 1;
  const base = coverScale(srcW, srcH, view.w, view.h);
  const scale = base * zoom;
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const originX = (view.w - drawW) / 2 + pan.x;
  const originY = (view.h - drawH) / 2 + pan.y;

  function clampPan(next: { x: number; y: number }, nextZoom = zoom) {
    const s = base * nextZoom;
    const w = srcW * s;
    const h = srcH * s;
    const maxX = Math.max(0, (w - view.w) / 2);
    const maxY = Math.max(0, (h - view.h) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setPan(clampPan({ x: drag.current.panX + dx, y: drag.current.panY + dy }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const url = await readFileAsDataUrl(file);
      setSrc(url);
      setRot(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao ler a foto");
    }
  }

  async function generate(fromCurrent: boolean, which: ImageLookId = look) {
    const text = prompt.trim() || suggest?.trim();
    if (!text) {
      toast.error(kind === "logo" ? "Descreva a marca." : "Descreva o produto.");
      return;
    }
    setBusy(true);
    try {
      const res = await generateCatalogImageFn({
        data: {
          prompt: text,
          kind,
          style: kind === "logo" ? undefined : style,
          engine,
          look: which,
          framework,
          shots: activeShots(),
          seed: lockSeed && seed != null ? seed : undefined,
          imageDataUrl: fromCurrent && src ? src : undefined,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLook(which);
      setSrc(res.dataUrl);
      setSeed(res.seed);
      setRot(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      const note = suggest?.trim() || text.slice(0, 80);
      saveShot(note, text);
      setShots(loadShots());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na geração");
    } finally {
      setBusy(false);
    }
  }

  async function compareLooks() {
    const text = prompt.trim() || suggest?.trim();
    if (!text) {
      toast.error("Descreva o produto para comparar os visuais.");
      return;
    }
    setBusy(true);
    const other: ImageLookId = look === "editorial" ? "realista" : "editorial";
    const ids: ImageLookId[] = [look, other];
    const out: { id: ImageLookId; dataUrl: string }[] = [];
    try {
      for (const id of ids) {
        const L = IMAGE_LOOKS.find((x) => x.id === id)!;
        const res = await generateCatalogImageFn({
          data: {
            prompt: text,
            kind,
            style: kind === "logo" ? undefined : style,
            engine: "rapido",
            look: id,
            framework,
            shots: activeShots(),
          },
        });
        if (!res.ok) {
          toast.error(`${L.label}: ${res.error}`);
          continue;
        }
        out.push({ id, dataUrl: res.dataUrl });
      }
      if (!out.length) return;
      setPair(out);
      const first = out[0]!;
      setLook(first.id);
      setSrc(first.dataUrl);
      setRot(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na comparação");
    } finally {
      setBusy(false);
    }
  }

  async function enrichPrompt() {
    const text = prompt.trim() || suggest?.trim();
    if (!text) {
      toast.error("Escreva a peça antes de enriquecer o texto.");
      return;
    }
    setEnriching(true);
    try {
      const res = await expandCatalogPromptFn({
        data: {
          prompt: text,
          kind,
          look,
          style: kind === "logo" ? undefined : style,
          framework,
          shots: activeShots(),
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPrompt(res.text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enriquecer");
    } finally {
      setEnriching(false);
    }
  }

  function activeShots(): PromptShot[] | undefined {
    if (!useShots) return undefined;
    if (shots.length) return shots;
    return SHOT_EXAMPLES.map((s) => ({ note: s.note, brief: s.brief }));
  }

  function appendChip(fragment: string) {
    setPrompt((cur) => {
      const base = cur.trim() || suggest?.trim() || "";
      if (base.toLowerCase().includes(fragment.toLowerCase())) return base;
      return base ? `${base}, ${fragment}` : fragment;
    });
  }

  function apply() {
    if (!rotated) {
      onApply("");
      return;
    }
    const data = exportCrop({
      source: rotated,
      srcW,
      srcH,
      viewW: view.w,
      viewH: view.h,
      panX: originX,
      panY: originY,
      scale,
      maxPx,
    });
    onApply(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-w-xl">
        <DialogHeader>
          <DialogTitle>{src ? "Recortar foto" : "Foto do item"}</DialogTitle>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {!src ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
              className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
            >
              <ImagePlus className="size-5" />
              Solte a foto ou clique para escolher
            </button>
            {aiOn ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-3.5 text-primary" />
                  Gerar com IA
                </p>
                <Textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    kind === "logo"
                      ? "Ex.: Vesti Shopping, cabide e folha"
                      : "Ex.: camiseta verde musgo, malha lisa, gola redonda"
                  }
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {PROMPT_FRAMEWORKS.find((f) => f.id === framework)?.hint}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PROMPT_FRAMEWORKS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      title={f.hint}
                      onClick={() => setFramework(f.id)}
                      className={cn(
                        "h-8 rounded-md px-2.5 text-xs",
                        framework === f.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {kind === "product" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {SHOT_EXAMPLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        title={s.brief}
                        onClick={() => setPrompt(s.note)}
                        className="h-8 rounded-md bg-muted px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Ex. {s.label}
                      </button>
                    ))}
                    <label className="ml-auto flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={useShots}
                        onChange={(e) => setUseShots(e.target.checked)}
                        className="size-3.5 accent-primary"
                      />
                      {shots.length ? `Usar ${shots.length} da loja` : "Usar exemplos"}
                    </label>
                  </div>
                ) : null}
                {kind === "product" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {PROMPT_CHIPS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => appendChip(c.text)}
                        className="h-8 rounded-md bg-muted px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        + {c.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void enrichPrompt()}
                    disabled={enriching || busy}
                  >
                    {enriching ? "Reescrevendo…" : "Enriquecer texto"}
                  </Button>
                </div>
                {kind === "product" ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {IMAGE_LOOKS.map((L) => (
                        <button
                          key={L.id}
                          type="button"
                          title={L.hint}
                          onClick={() => setLook(L.id)}
                          className={cn(
                            "h-8 rounded-md px-2.5 text-xs",
                            look === L.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {L.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {IMAGE_LOOKS.find((L) => L.id === look)?.hint}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {IMAGE_STYLES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStyle(s.id)}
                          className={cn(
                            "h-8 rounded-md px-2.5 text-xs",
                            style === s.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {IMAGE_ENGINES.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      title={e.hint}
                      onClick={() => setEngine(e.id)}
                      className={cn(
                        "h-8 rounded-md px-2.5 text-xs",
                        engine === e.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {IMAGE_ENGINES.find((e) => e.id === engine)?.hint}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" onClick={() => void generate(false)} disabled={busy}>
                    {busy ? "Difundindo…" : "Gerar foto"}
                  </Button>
                  {kind === "product" ? (
                    <Button type="button" variant="outline" onClick={() => void compareLooks()} disabled={busy}>
                      {look === "editorial" ? "Vs. foto real" : "Vs. editorial"}
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <div
              ref={viewRef}
              className="relative cursor-grab overflow-hidden rounded-xl bg-sidebar touch-none active:cursor-grabbing"
              style={{ height: view.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {rotated ? (
                <canvas
                  width={rotated.width}
                  height={rotated.height}
                  className="pointer-events-none absolute max-w-none"
                  style={{
                    width: drawW,
                    height: drawH,
                    left: originX,
                    top: originY,
                  }}
                  ref={(node) => {
                    if (!node) return;
                    const ctx = node.getContext("2d");
                    if (!ctx) return;
                    ctx.clearRect(0, 0, node.width, node.height);
                    ctx.drawImage(rotated, 0, 0);
                  }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-primary/40" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Arraste para enquadrar. O recorte prioriza a parte de cima — cabelo e rosto ficam dentro.
            </p>
            {pair && pair.length > 1 ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {pair.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setLook(p.id);
                      setSrc(p.dataUrl);
                      setRot(0);
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className={cn(
                      "overflow-hidden rounded-lg border text-left",
                      look === p.id ? "border-primary ring-2 ring-primary/30" : "border-border",
                    )}
                  >
                    <img src={p.dataUrl} alt="" className="aspect-square w-full object-cover object-top" />
                    <span className="block px-2 py-1 text-xs">
                      {IMAGE_LOOKS.find((L) => L.id === p.id)?.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAspect(a.id);
                    setPan({ x: 0, y: 0 });
                    setZoom(1);
                  }}
                  className={cn(
                    "h-8 rounded-md px-2.5 text-xs",
                    aspect === a.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {aiOn ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {IMAGE_ENGINES.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    title={e.hint}
                    onClick={() => setEngine(e.id)}
                    className={cn(
                      "h-8 rounded-md px-2.5 text-xs",
                      engine === e.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {e.label}
                  </button>
                ))}
                {seed != null ? (
                  <label className="ml-auto flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={lockSeed}
                      onChange={(e) => setLockSeed(e.target.checked)}
                      className="size-3.5 accent-primary"
                    />
                    Manter semente {seed}
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-3">
              <ZoomIn className="size-4 text-muted-foreground" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => {
                  const z = Number(e.target.value);
                  setZoom(z);
                  setPan((p) => clampPan(p, z));
                }}
                className="h-10 flex-1 accent-primary"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setRot((r) => r + 90)} aria-label="Girar">
                <RotateCw className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Trocar
              </Button>
              {aiOn ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => void generate(false)} disabled={busy}>
                    <Sparkles className="size-3.5" />
                    {busy ? "Difundindo…" : "Outra versão"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void generate(true)} disabled={busy}>
                    {busy ? "Refinando…" : "Refinar esta"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={apply} disabled={!src}>
            Usar recorte
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
