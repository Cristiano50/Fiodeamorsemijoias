import "server-only";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig, getSegredo } from "./config";
import { avaliarFotoMarketing, type AvaliacaoFoto } from "./ai/claude";
import { gerarFotoIA, montarPromptFoto, type Proporcao } from "./ai/imagem";
import { lerImagem, salvarImagem } from "./servicos";

export interface Tentativa {
  numero: number;
  aprovada: boolean | null; // null = sem avaliação (sem chave do Claude)
  nota: number | null;
  problemas: string[];
}

/**
 * Foto com modelo (padrão do estúdio):
 *  1. gera a foto da peça usada por uma modelo, a partir da foto do catálogo;
 *  2. o especialista de marketing (IA) compara com a peça real e aprova ou reprova pela rubrica;
 *  3. se reprovar, gera de novo com o ajuste sugerido (até "fotoTentativas").
 * Grava só a foto final (aprovada ou a de maior nota) com a avaliação em meta.
 */
export async function gerarFotoModelo(
  produtoId: string,
  opts: { cenarioId?: string; proporcao?: Proporcao; extra?: string; provedor?: "gemini" | "openai"; tentativas?: number; imagemId?: string },
) {
  const db = await getDb();
  const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!p) throw new Error("Produto não encontrado");
  const base = await lerImagem(opts.imagemId ?? p.imagemId ?? "");
  if (!base) throw new Error("O produto não tem foto de referência.");
  const [marca, sistema] = await Promise.all([getConfig("marca"), getConfig("sistema")]);
  const pf = (marca.prompts_ia_foto ?? {}) as { cenario_padrao?: string };
  const cenarioId = opts.cenarioId || pf.cenario_padrao;
  const avaliar = !!(await getSegredo("ANTHROPIC_API_KEY"));
  const maxTentativas = Math.min(Math.max(opts.tentativas ?? sistema.fotoTentativas ?? 3, 1), 5);
  const referenciaB64 = (await sharp(base.dados).resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
  const produtoInfo = {
    nome: p.nome,
    tipo: p.tipo,
    subtipo: p.subtipo,
    banho: p.banho,
    cor_pedra: p.corPedra,
    tamanho: p.tamanho,
    descricao: p.traducao,
    avaliacao: p.avaliacao,
  };

  const tentativas: Tentativa[] = [];
  let melhor: { dados: Buffer; mime: string; provedor: string; modelo: string; prompt: string; avaliacao: AvaliacaoFoto | null } | null = null;
  let ajuste = "";
  for (let n = 1; n <= maxTentativas; n++) {
    const prompt = montarPromptFoto(marca, {
      tipo: p.tipo,
      subtipo: p.subtipo,
      banho: p.banho,
      tamanho: p.tamanho,
      cenarioId,
      extra: [opts.extra, ajuste && `Fix from previous attempt: ${ajuste}`].filter(Boolean).join("\n"),
      descricaoPeca: [p.traducao, p.avaliacao].filter(Boolean).join(" — "),
    });
    const foto = await gerarFotoIA({ imagem: base.dados, mime: base.mime, prompt, proporcao: opts.proporcao ?? "4:5", provedor: opts.provedor });
    let avaliacao: AvaliacaoFoto | null = null;
    if (avaliar) {
      const geradaB64 = (await sharp(foto.dados).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 88 }).toBuffer()).toString("base64");
      avaliacao = await avaliarFotoMarketing({ referenciaBase64: referenciaB64, geradaBase64: geradaB64, geradaMime: "image/jpeg", produto: produtoInfo });
    }
    tentativas.push({ numero: n, aprovada: avaliacao ? avaliacao.aprovada : null, nota: avaliacao?.nota ?? null, problemas: avaliacao?.problemas ?? [] });
    if (!melhor || (avaliacao?.nota ?? 0) > (melhor.avaliacao?.nota ?? -1)) melhor = { ...foto, prompt, avaliacao };
    if (!avaliacao || avaliacao.aprovada) break;
    ajuste = avaliacao.ajuste_prompt;
  }

  const aprovada = melhor!.avaliacao ? melhor!.avaliacao.aprovada : null;
  const imagemId = await salvarImagem({
    dados: melhor!.dados,
    origem: "ia",
    produtoId,
    meta: {
      fotoModelo: true,
      geradaPorIa: true,
      provedor: melhor!.provedor,
      modelo: melhor!.modelo,
      cenario: cenarioId,
      prompt: melhor!.prompt,
      aprovada,
      avaliacao: melhor!.avaliacao,
      tentativas,
    },
  });
  return { imagemId, aprovada, avaliacao: melhor!.avaliacao, tentativas, provedor: melhor!.provedor, modelo: melhor!.modelo };
}

/** Última foto com modelo de cada produto (para a tabela do pedido e o estúdio). */
export async function fotosModeloPorProduto(produtoIds: string[]) {
  if (!produtoIds.length) return {};
  const db = await getDb();
  const linhas = await db
    .select({ id: schema.imagens.id, produtoId: schema.imagens.produtoId, meta: schema.imagens.meta, criadoEm: schema.imagens.criadoEm })
    .from(schema.imagens)
    .where(eq(schema.imagens.origem, "ia"));
  const out: Record<string, { id: string; aprovada: boolean | null; nota: number | null }> = {};
  for (const l of linhas.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))) {
    if (!l.produtoId || !produtoIds.includes(l.produtoId)) continue;
    const m = (l.meta ?? {}) as { aprovada?: boolean | null; avaliacao?: { nota?: number } | null };
    const atual = out[l.produtoId];
    // Prefere a aprovada mais recente; senão a mais recente.
    if (!atual || m.aprovada || !atual.aprovada) out[l.produtoId] = { id: l.id, aprovada: m.aprovada ?? null, nota: m.avaliacao?.nota ?? null };
  }
  return out;
}
