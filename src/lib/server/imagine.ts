import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertCan } from "@/lib/permissions";
import { requireTenant } from "./context";

export const IMAGE_STYLES = [
  { id: "catalogo", label: "Catálogo" },
  { id: "branco", label: "Fundo branco" },
  { id: "vitrine", label: "Balcão da loja" },
  { id: "look", label: "Look / vitrine" },
] as const;

export const IMAGE_LOOKS = [
  {
    id: "realista",
    label: "Foto real",
    hint: "Textura, irregularidade, lente de câmera — linha fotográfica (tipo Stable Diffusion).",
  },
  {
    id: "estudio",
    label: "Estúdio",
    hint: "Peça limpa, fundo perfeito, cara de anúncio — linha comercial (tipo DALL·E).",
  },
  {
    id: "editorial",
    label: "Editorial",
    hint: "Luz de revista, cor cinematográfica, composição de capa — linha Midjourney v6.",
  },
] as const;

export const IMAGE_ENGINES = [
  { id: "rapido", label: "Rápido", hint: "Rascunho para achar o enquadramento", model: "grok-imagine-image" },
  { id: "equilibrio", label: "Equilíbrio", hint: "O motor do catálogo no dia a dia", model: "grok-imagine-image-2.0" },
  { id: "detalhe", label: "Detalhe", hint: "Tecido, costura e brilho mais nítidos", model: "grok-imagine-image-quality" },
] as const;

export const PROMPT_FRAMEWORKS = [
  {
    id: "shot",
    label: "Plano de foto",
    hint: "Peça, pose, fundo, luz, quadro — o briefing da geração.",
    expand:
      "Reescreva anotações de loja brasileira em um briefing de foto de catálogo, em português, um parágrafo, no máximo 55 palavras. Ordem: peça, material e cor, pose ou ângulo, fundo, luz. Só o que deve aparecer. Se houver pessoa, o rosto e o cabelo inteiros entram no quadro. Sem marca de câmera, sem nome de artista, sem lista do que não pode.",
  },
  {
    id: "costar",
    label: "Briefing",
    hint: "Contexto, objetivo, estilo, tom, público — CO-STAR para vitrine.",
    expand:
      "Reescreva a nota da loja no quadro CO-STAR, em português, no máximo 70 palavras no total, cinco linhas rotuladas: Contexto / Objetivo / Estilo / Tom / Público. Contexto é a loja e a peça. Objetivo é uma foto de catálogo que venda. Estilo e tom seguem o visual pedido. Público é quem compra no balcão. Sem lista do que não pode. Se houver pessoa, o rosto inteiro entra no quadro.",
  },
  {
    id: "risen",
    label: "Passo a passo",
    hint: "Papel, instrução, passos, resultado — RISEN para peça difícil.",
    expand:
      "Reescreva no quadro RISEN, em português, no máximo 70 palavras: Papel (fotógrafo de catálogo) / Instrução / 3 passos curtos / Resultado. O resultado é uma foto com a peça inteira no quadro. Sem lista do que não pode.",
  },
] as const;

export const PROMPT_CHIPS = [
  { id: "malha", label: "Malha", text: "malha de algodão, nervura visível, caimento natural" },
  { id: "couro", label: "Couro", text: "couro com poros e brilho suave" },
  { id: "close", label: "Close", text: "enquadramento próximo, a peça preenche o quadro, topo visível" },
  { id: "tres", label: "3/4", text: "ângulo 3/4, câmera um pouco acima" },
  { id: "janela", label: "Luz de janela", text: "luz lateral de janela, sombra suave no lado oposto" },
  { id: "soft", label: "Luz de estúdio", text: "luz de estúdio uniforme, sem sombra dura" },
  { id: "cabide", label: "Cabide", text: "pendurada em cabide de madeira claro" },
  { id: "mesa", label: "Sobre o balcão", text: "apoiada no balcão de madeira, loja ao fundo desfocada" },
] as const;

export const SHOT_EXAMPLES = [
  {
    id: "camisa",
    label: "Camisa",
    note: "camisa social azul clara, algodão",
    brief:
      "Camisa social azul clara de algodão, colarinho aberto, ângulo 3/4 um pouco acima, fundo cinza claro de catálogo, luz de estúdio uniforme, peça inteira no quadro.",
  },
  {
    id: "bolsa",
    label: "Bolsa",
    note: "bolsa de couro marrom",
    brief:
      "Bolsa de couro marrom com poros visíveis, apoiada no balcão de madeira, close 3/4, luz de janela lateral, sombra suave, topo da alça no quadro.",
  },
  {
    id: "look",
    label: "Look",
    note: "vestido midi verde, modelo",
    brief:
      "Vestido midi verde musgo no corpo, caimento visível, pessoa de 3/4, rosto e cabelo inteiros com espaço acima da cabeça, vitrine de loja ao fundo desfocada, luz de janela.",
  },
] as const;

export type PromptShot = { note: string; brief: string };
export type ImageStyleId = (typeof IMAGE_STYLES)[number]["id"];
export type ImageEngineId = (typeof IMAGE_ENGINES)[number]["id"];
export type ImageLookId = (typeof IMAGE_LOOKS)[number]["id"];
export type ImageFrameworkId = (typeof PROMPT_FRAMEWORKS)[number]["id"];
export type ImageKind = "product" | "logo";

function engineModel(id: ImageEngineId | undefined): string {
  return IMAGE_ENGINES.find((e) => e.id === id)?.model ?? "grok-imagine-image";
}

export const aiImageStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ available: Boolean(process.env.XAI_API_KEY) }));

export const expandCatalogPromptFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      prompt: string;
      kind: ImageKind;
      look?: ImageLookId;
      style?: ImageStyleId;
      framework?: ImageFrameworkId;
      shots?: PromptShot[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, data.kind === "logo" ? "settings.write" : "products.write");
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Enriquecer texto indisponível agora." };
    const look = IMAGE_LOOKS.find((L) => L.id === (data.look ?? "realista"));
    const style = IMAGE_STYLES.find((s) => s.id === (data.style ?? "catalogo"));
    const frame = PROMPT_FRAMEWORKS.find((f) => f.id === (data.framework ?? "shot")) ?? PROMPT_FRAMEWORKS[0];
    const shots = (data.shots ?? []).slice(0, 3);
    const examples = shots.flatMap((s) => [
      {
        role: "user" as const,
        content: `Visual: ${look?.label ?? "Foto real"}. Cena: ${style?.label ?? "Catálogo"}. Nota da loja: ${s.note.slice(0, 180)}`,
      },
      { role: "assistant" as const, content: s.brief.slice(0, 280) },
    ]);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 180,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `${frame.expand} Siga o mesmo nível de detalhe e a mesma ordem dos exemplos.`,
          },
          ...examples,
          {
            role: "user",
            content: `Visual: ${look?.label ?? "Foto real"}. Cena: ${style?.label ?? "Catálogo"}. Nota da loja: ${data.prompt.trim().slice(0, 280) || "produto da loja"}`,
          },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: "Não foi possível enriquecer o texto." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "O texto veio vazio." };
    return { ok: true as const, text };
  });

export const generateCatalogImageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      prompt: string;
      kind: ImageKind;
      style?: ImageStyleId;
      engine?: ImageEngineId;
      look?: ImageLookId;
      framework?: ImageFrameworkId;
      shots?: PromptShot[];
      seed?: number;
      imageDataUrl?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { tenant } = await requireTenant(context.userId);
    assertCan(tenant.role, data.kind === "logo" ? "settings.write" : "products.write");
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Geração de imagem indisponível neste ambiente." };
    }
    const seed = Number.isFinite(data.seed) ? Math.floor(data.seed as number) : Math.floor(Math.random() * 1_000_000_000);
    const model = engineModel(data.engine);
    if (data.imageDataUrl) {
      const edited = await requestEdit(
        apiKey,
        model,
        composeEditPrompt(
          data.prompt,
          data.kind,
          data.style ?? "catalogo",
          data.look ?? "realista",
          data.framework ?? "shot",
        ),
        data.imageDataUrl,
      );
      if (edited.ok) return { ...edited, seed };
      return edited;
    }
    const prompt = composePrompt(
      data.prompt,
      data.kind,
      data.style ?? "catalogo",
      data.look ?? "realista",
      data.framework ?? "shot",
      data.shots,
    );
    const result = await requestImage(apiKey, model, prompt, seed);
    if (result.ok) return { ...result, seed };
    if (result.status === 400 || result.status === 404) {
      const fallback = await requestImage(apiKey, "grok-imagine-image", prompt, seed);
      if (fallback.ok) return { ...fallback, seed };
      return fallback;
    }
    return result;
  });

function composePrompt(
  raw: string,
  kind: ImageKind,
  style: ImageStyleId,
  look: ImageLookId,
  framework: ImageFrameworkId,
  shots?: PromptShot[],
): string {
  const subject = raw.trim().slice(0, 400) || "produto de loja";
  if (kind === "logo") {
    return [
      `Simple square retail store logo for "${subject}".`,
      "Flat mark, two colors, forest green and warm cream paper, no tiny unreadable text,",
      "generous padding, centered, no photoreal people, no watermark.",
    ].join(" ");
  }
  const scene = sceneLine(style);
  const lookTxt = lookLine(look);
  const frame =
    framework === "costar"
      ? [
          `Context: Brazilian boutique catalog, item: ${subject}.`,
          `Objective: one selling product photo.`,
          `Style: ${lookTxt}`,
          `Tone: ${scene}.`,
          `Audience: shoppers at the counter and in the online list.`,
          "Response: a single catalog photograph, whole product in frame, full face and hair if a person appears.",
        ]
      : framework === "risen"
        ? [
            "Role: catalog photographer for a Brazilian clothing shop.",
            `Instructions: photograph ${subject}.`,
            `Steps: 1) set ${scene}; 2) light to match; 3) frame the whole item including the top edge.`,
            `End: one ${lookTxt} image ready for the product card.`,
          ]
        : [
            `Subject: ${subject}.`,
            `Setting: ${scene}.`,
            lookTxt,
            "Composition: one product, centered, the whole item including the top edge inside the frame; if a person appears, full face and hair with headroom above.",
            "Lighting matches the setting. Positive description only.",
          ];
  const examples = (shots ?? [])
    .slice(0, 3)
    .map((s, i) => `Example ${i + 1}: ${s.brief.slice(0, 180)}`)
    .join(" ");
  return examples ? `${frame.join(" ")} Match this shop's catalog language. ${examples}` : frame.join(" ");
}

function composeEditPrompt(
  raw: string,
  kind: ImageKind,
  style: ImageStyleId,
  look: ImageLookId,
  framework: ImageFrameworkId,
): string {
  const note = raw.trim().slice(0, 400);
  if (kind === "logo") {
    return `Keep this store mark recognizable. ${note || "Cleaner edges, same colors."} Square logo, no extra text, no watermark.`;
  }
  const lookTxt = lookLine(look);
  if (framework === "costar") {
    return `Context: existing product photo. Objective: ${note || sceneLine(style)}. Style: ${lookTxt} Keep the same item. Audience: catalog. Response: one edited photo, full product and faces in frame.`;
  }
  if (framework === "risen") {
    return `Role: catalog retoucher. Instructions: keep this item. Steps: 1) ${note || sceneLine(style)}; 2) apply ${lookTxt}; 3) keep heads and the top of the product in frame. End: one catalog photo.`;
  }
  return [
    "This is a retail product photo. Keep the same item, materials and color.",
    note ? `Change: ${note}.` : `Restyle as ${sceneLine(style)}.`,
    lookTxt,
    "Do not crop faces or the top of the product. No watermark, no extra items.",
  ].join(" ");
}

function lookLine(look: ImageLookId): string {
  if (look === "estudio") {
    return "Polished commercial advertising image, perfectly clean edges, idealized lighting, seamless studio, magazine catalog smoothness, slightly illustrated, no film grain.";
  }
  if (look === "editorial") {
    return [
      "Midjourney v6 aesthetic, cinematic fashion editorial,",
      "rich volumetric lighting, cohesive filmic color grade, exquisite composition,",
      "stylized photorealism, shallow depth of field, premium lookbook,",
      "the subject fully in frame with headroom if a person appears.",
    ].join(" ");
  }
  return "Photorealistic camera photograph, natural fabric texture, subtle grain, 50mm lens, real retail product, not a 3D render, not an illustration.";
}

function sceneLine(style: ImageStyleId): string {
  if (style === "branco") return "isolated packshot on a pure white seamless background, even studio light";
  if (style === "vitrine") return "sitting on a wooden boutique counter in a Brazilian clothing shop, warm ambient light, blurred shop interior";
  if (style === "look") return "lifestyle fashion photograph, subject fully in frame, headroom above hair if a person appears, natural window light";
  return "commercial e-commerce catalog photo, soft studio lighting, light gray seamless, centered";
}

async function requestImage(
  apiKey: string,
  model: string,
  prompt: string,
  seed: number,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      resolution: "1k",
      seed,
    }),
  });
  return readImageResponse(res);
}

async function requestEdit(
  apiKey: string,
  model: string,
  prompt: string,
  imageDataUrl: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const payload = {
    model,
    prompt,
    image: imageDataUrl,
  };
  let res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 400) {
    res = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        image: { url: imageDataUrl, type: "image_url" },
      }),
    });
  }
  return readImageResponse(res);
}

async function readImageResponse(
  res: Response,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: res.status === 429 ? "Fila da geração cheia. Tente de novo em instantes." : "Não foi possível gerar a imagem.",
    };
  }
  const body = (await res.json()) as {
    data?: { url?: string; b64_json?: string }[];
    url?: string;
  };
  const item = body.data?.[0];
  if (item?.b64_json) {
    return { ok: true, dataUrl: `data:image/jpeg;base64,${item.b64_json}` };
  }
  const url = item?.url ?? body.url;
  if (!url) return { ok: false, status: 502, error: "A geração não devolveu a foto." };
  const img = await fetch(url);
  if (!img.ok) return { ok: false, status: img.status, error: "Não foi possível baixar a foto gerada." };
  const mime = img.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = Buffer.from(await img.arrayBuffer());
  return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
}
