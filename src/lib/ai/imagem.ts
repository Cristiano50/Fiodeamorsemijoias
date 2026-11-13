import "server-only";
import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { getConfig, getSegredo, type Marca } from "../config";
import { IaIndisponivel } from "./claude";

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

/** Monta o prompt da foto publicitária a partir do guia de marketing (src/config/marca.json). */
export function montarPromptFoto(
  marca: Marca,
  opts: { tipo?: string | null; subtipo?: string | null; banho?: string | null; tamanho?: string | null; cenarioId?: string; extra?: string; descricaoPeca?: string },
): string {
  const p = (marca.prompts_ia_foto ?? {}) as NonNullable<Marca["prompts_ia_foto"]> & {
    aliases?: Record<string, string>;
    por_subtipo?: Record<string, string>;
  };
  const tipo = (opts.tipo && (p.por_tipo?.[opts.tipo] ? opts.tipo : p.aliases?.[opts.tipo])) || "default";
  const porTipo = p.por_tipo?.[tipo] ?? p.por_tipo?.default ?? "";
  const subtipoChave = Object.keys(p.por_subtipo ?? {}).find((k) => opts.subtipo?.toLowerCase().includes(k.toLowerCase()));
  const porSubtipo = subtipoChave ? p.por_subtipo![subtipoChave] : "";
  const cenario = p.cenarios?.find((c) => c.id === opts.cenarioId)?.prompt ?? p.cenarios?.[0]?.prompt ?? "";
  const negativo = Array.isArray(p.negativo) && p.negativo.length ? `Avoid: ${p.negativo.join(", ")}.` : "";
  const texto = [
    p.base ??
      "Use the reference photo as the exact jewelry piece. Keep its shape, color, stones and plating identical. Remove supplier cards, tags and QR codes.",
    porTipo,
    porSubtipo,
    p.base?.includes("{scene}") || porTipo.includes("{scene}") ? "" : cenario,
    opts.extra ?? "",
    `Brand palette: dusty rose ${marca.cores?.primaria ?? "#CEA6B6"}, cream and soft gold. Elegant, feminine, soft natural light. No text, no logos, no watermarks.`,
    negativo,
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

export async function gerarFotoIA(opts: {
  imagem: Buffer;
  mime: string;
  prompt: string;
  proporcao: Proporcao;
  provedor?: "gemini" | "openai";
}): Promise<{ dados: Buffer; mime: string; provedor: string; modelo: string }> {
  const sistema = await getConfig("sistema");
  const provedor = opts.provedor ?? (sistema.imagemProvedor === "nenhum" ? undefined : sistema.imagemProvedor);
  if (!provedor) throw new IaIndisponivel("Geração de fotos por IA desativada em Configurações.");

  if (provedor === "gemini") {
    const apiKey = await getSegredo("GEMINI_API_KEY");
    if (!apiKey) throw new IaIndisponivel("Configure a chave do Google Gemini em Configurações → Integrações.");
    const ai = new GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model: sistema.geminiModelo,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: opts.mime, data: opts.imagem.toString("base64") } }, { text: opts.prompt }],
        },
      ],
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: opts.proporcao } },
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
  const size = opts.proporcao === "1:1" ? "1024x1024" : "1024x1536";
  const resp = await client.images.edit({
    model: sistema.openaiModelo,
    image: await toFile(opts.imagem, "peca.jpg", { type: opts.mime }),
    prompt: opts.prompt,
    size,
  });
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("A OpenAI não devolveu a imagem.");
  return { dados: Buffer.from(b64, "base64"), mime: "image/png", provedor, modelo: sistema.openaiModelo };
}
