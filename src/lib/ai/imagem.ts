import "server-only";
import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { getConfig, getSegredo, type Marca } from "../config";
import { IaIndisponivel } from "./claude";
import { checarLimiteIa, registrarGasto, type ContextoGasto } from "../gastos";

export type Proporcao = "4:5" | "9:16" | "1:1";

const BANHO_EN: Record<string, string> = {
  ouro_18k: "yellow gold",
  ouro_14k: "light champagne gold",
  ouro_rose: "rose gold",
  rodio_branco: "rhodium silver",
  rodio_negro: "black rhodium",
  prata: "sterling silver",
  bicolor: "two-tone gold and silver",
  pvd_dourado: "yellow gold",
};
const TONS_PELE = ["fair", "light olive", "medium tan", "deep brown"];

type PromptsFoto = NonNullable<Marca["prompts_ia_foto"]> & {
  instrucao_referencia_estilo?: string;
  aliases?: Record<string, string>;
  por_subtipo?: Record<string, string>;
  por_subtipo_modelo?: Record<string, string>;
  still_life?: string;
  cenario_padrao?: string;
  cenario_por_tipo?: Record<string, string>;
  cenario_por_subtipo?: Record<string, string>;
  negativo_modelo?: string[];
};

const contem = (subtipo: string | null | undefined, chave: string) => {
  const sub = (subtipo ?? "").toLowerCase();
  const k = chave.toLowerCase();
  return sub.includes(k) || (k === "religioso" && /religios|santa|nossa senhora|crucifix|terço|escapul|são |sao /.test(sub));
};

/**
 * Monta o prompt na ordem definida pelo marketing (marca.json → prompts_ia_foto.montagem):
 * base + instrução da referência de estilo (se houver imagem 2) + bloco do cenário
 * (expositor: still_life | com modelo: por_tipo + por_subtipo_modelo) + por_subtipo + cena
 * + ajuste da avaliação anterior + "Avoid:" negativo (+ negativo_modelo se houver modelo).
 */
export function montarPromptFoto(
  marca: Marca,
  opts: { tipo?: string | null; subtipo?: string | null; banho?: string | null; tamanho?: string | null; cenarioId?: string; extra?: string; descricaoPeca?: string; comReferencia?: boolean },
): string {
  const p = (marca.prompts_ia_foto ?? {}) as PromptsFoto;
  const cen = p.cenarios?.find((c) => c.id === cenarioDoTipo(marca, opts.tipo, opts.cenarioId, opts.subtipo)) ?? p.cenarios?.[0];
  const comModelo = cen?.modelo === true;
  const tipo = (opts.tipo && (p.por_tipo?.[opts.tipo] ? opts.tipo : p.aliases?.[opts.tipo])) || "default";
  const bloco = comModelo
    ? [
        p.por_tipo?.[tipo] ?? p.por_tipo?.default ?? "",
        ...Object.keys(p.por_subtipo_modelo ?? {})
          .filter((k) => contem(opts.subtipo, k))
          .map((k) => p.por_subtipo_modelo![k]),
      ]
    : [p.still_life ?? ""];
  const porSubtipo = Object.keys(p.por_subtipo ?? {})
    .filter((k) => contem(opts.subtipo, k))
    .map((k) => p.por_subtipo![k]);
  const cenario = cen?.prompt ?? "";
  const usaPlaceholderCena = [p.base, ...bloco, ...porSubtipo].some((t) => t?.includes("{scene}"));
  const negativos = [...(Array.isArray(p.negativo) ? p.negativo : []), ...(comModelo && Array.isArray(p.negativo_modelo) ? p.negativo_modelo : [])];
  const instrucaoRef =
    opts.comReferencia &&
    (p.instrucao_referencia_estilo ??
      "Image 1 is the real product: copy the jewelry ONLY from image 1. Image 2 is a style reference only: reproduce its display prop, materials, colors, background, light and framing, but never copy the jewelry shown in image 2.");
  const texto = [
    p.base ??
      "Use the reference photo as the exact jewelry piece. Keep its shape, color, stones and plating identical. Remove supplier cards, tags and QR codes.",
    instrucaoRef || "",
    ...bloco,
    ...porSubtipo,
    usaPlaceholderCena ? "" : cenario,
    opts.extra ?? "",
    negativos.length ? `Avoid: ${negativos.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return texto
    .replaceAll("{piece_description}", opts.descricaoPeca || "the jewelry piece in the reference photo")
    .replaceAll("{plating}", BANHO_EN[opts.banho ?? ""] ?? "the same metal tone as the reference")
    .replaceAll("{size}", opts.tamanho && !/único|unico/i.test(opts.tamanho) ? opts.tamanho : "true-to-life size, as in the reference")
    .replaceAll("{scene}", cenario)
    .replaceAll("{skin_tone}", TONS_PELE[Math.floor(Math.random() * TONS_PELE.length)]);
}

/** Cenário: o escolhido no estúdio; em "auto", o expositor do subtipo, senão o do tipo, senão o padrão (marketing). */
export function cenarioDoTipo(marca: Marca, tipo?: string | null, escolhido?: string, subtipo?: string | null): string | undefined {
  const p = (marca.prompts_ia_foto ?? {}) as PromptsFoto;
  if (escolhido && escolhido !== "auto") return escolhido;
  if (p.cenario_padrao && p.cenario_padrao !== "auto") return p.cenario_padrao;
  const porSub = subtipo ? p.cenario_por_subtipo?.[subtipo] : undefined;
  const mapa = p.cenario_por_tipo ?? {};
  return porSub ?? (tipo ? (mapa[tipo] ?? (p.aliases?.[tipo] ? mapa[p.aliases[tipo]] : undefined)) : undefined) ?? mapa.default ?? p.cenarios?.[0]?.id;
}

export async function gerarFotoIA(opts: {
  imagem: Buffer;
  mime: string;
  prompt: string;
  proporcao: Proporcao;
  provedor?: "gemini" | "openai";
  estilo?: { dados: Buffer; mime: string } | null; // foto de referência de estilo (expositor, luz, fundo)
  ctx?: ContextoGasto;
}): Promise<{ dados: Buffer; mime: string; provedor: string; modelo: string }> {
  const sistema = await getConfig("sistema");
  const provedor = opts.provedor ?? (sistema.imagemProvedor === "nenhum" ? undefined : sistema.imagemProvedor);
  if (!provedor) throw new IaIndisponivel("Geração de fotos por IA desativada em Configurações.");
  await checarLimiteIa();

  if (provedor === "gemini") {
    const apiKey = await getSegredo("GEMINI_API_KEY");
    if (!apiKey) throw new IaIndisponivel("Configure a chave do Google Gemini em Configurações → Integrações.");
    const ai = new GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model: sistema.geminiModelo,
      contents: [
        {
          role: "user",
          parts: opts.estilo
            ? [
                { text: "Image 1 — the real product (copy the jewelry only from here):" },
                { inlineData: { mimeType: opts.mime, data: opts.imagem.toString("base64") } },
                { text: "Image 2 — style reference only (display, materials, light, background, framing):" },
                { inlineData: { mimeType: opts.estilo.mime, data: opts.estilo.dados.toString("base64") } },
                { text: opts.prompt },
              ]
            : [{ inlineData: { mimeType: opts.mime, data: opts.imagem.toString("base64") } }, { text: opts.prompt }],
        },
      ],
      config: {
        responseModalities: ["IMAGE"],
        // Modelos Gemini 3 aceitam resolução maior (2K) — melhor para campanha.
        imageConfig: { aspectRatio: opts.proporcao, ...(/gemini-3/.test(sistema.geminiModelo) ? { imageSize: "2K" } : {}) },
      },
    });
    await registrarGasto({
      servico: "gemini",
      modelo: sistema.geminiModelo,
      finalidade: "foto",
      ctx: opts.ctx,
      tokensEntrada: resp.usageMetadata?.promptTokenCount ?? 0,
      tokensSaida: resp.usageMetadata?.candidatesTokenCount ?? 0,
      imagens: 1,
    });
    const parte = resp.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!parte?.inlineData?.data) {
      const motivo = resp.candidates?.[0]?.finishReason ?? resp.promptFeedback?.blockReason ?? "sem imagem na resposta";
      throw new Error(`O Gemini não gerou a imagem (${motivo}).`);
    }
    return {
      dados: Buffer.from(parte.inlineData.data, "base64"),
      mime: parte.inlineData.mimeType ?? "image/png",
      provedor,
      modelo: sistema.geminiModelo,
    };
  }

  const apiKey = await getSegredo("OPENAI_API_KEY");
  if (!apiKey) throw new IaIndisponivel("Configure a chave da OpenAI em Configurações → Integrações.");
  const client = new OpenAI({ apiKey });
  // gpt-image-2 aceita resolução livre (LxA); se o modelo recusar, cai para um tamanho padrão.
  const exato = { "4:5": "1024x1280", "9:16": "1024x1824", "1:1": "1024x1024" }[opts.proporcao];
  const padrao = opts.proporcao === "1:1" ? "1024x1024" : "1024x1536";
  const editar = async (size: string) =>
    client.images.edit({
      model: sistema.openaiModelo,
      image: opts.estilo
        ? [await toFile(opts.imagem, "1-peca.jpg", { type: opts.mime }), await toFile(opts.estilo.dados, "2-estilo.jpg", { type: opts.estilo.mime })]
        : await toFile(opts.imagem, "peca.jpg", { type: opts.mime }),
      prompt: opts.prompt,
      size,
      quality: "high",
    });
  let resp;
  try {
    resp = await editar(exato);
  } catch (e) {
    if (e instanceof OpenAI.BadRequestError && exato !== padrao) resp = await editar(padrao);
    else throw e;
  }
  await registrarGasto({
    servico: "openai",
    modelo: sistema.openaiModelo,
    finalidade: "foto",
    ctx: opts.ctx,
    tokensEntrada: resp.usage?.input_tokens ?? 0,
    tokensSaida: resp.usage?.output_tokens ?? 0,
    imagens: 1,
  });
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("A OpenAI não devolveu a imagem.");
  return { dados: Buffer.from(b64, "base64"), mime: "image/png", provedor, modelo: sistema.openaiModelo };
}
