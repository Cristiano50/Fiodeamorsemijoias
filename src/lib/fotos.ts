import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig, getSegredo } from "./config";
import { avaliarFotoMarketing, type AvaliacaoFoto } from "./ai/claude";
import { cenarioDoTipo, gerarFotoIA, montarPromptFoto, type Proporcao } from "./ai/imagem";
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
  const cenarioId = cenarioDoTipo(marca, p.tipo, opts.cenarioId, p.subtipo);
  const cenario = marca.prompts_ia_foto?.cenarios?.find((c) => c.id === cenarioId);
  // Referência de estilo só para cenários de expositor (com modelo, a cena vem do texto).
  const estilo = cenario?.modelo ? null : await referenciaDeEstilo(p.tipo, cenario?.referencia_estilo);
  const avaliar = !!(await getSegredo("ANTHROPIC_API_KEY"));
  const maxTentativas = Math.min(Math.max(opts.tentativas ?? sistema.fotoTentativas ?? 3, 1), 5);
  const estiloB64 = estilo ? (await sharp(estilo.dados).resize({ width: 640, height: 640, fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString("base64") : null;
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
      comReferencia: !!estilo,
    });
    const foto = await gerarFotoIA({ imagem: base.dados, mime: base.mime, prompt, proporcao: opts.proporcao ?? "4:5", provedor: opts.provedor, estilo, ctx: { produtoId, pedidoId: p.pedidoId } });
    let avaliacao: AvaliacaoFoto | null = null;
    if (avaliar) {
      const geradaB64 = (await sharp(foto.dados).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 88 }).toBuffer()).toString("base64");
      avaliacao = await avaliarFotoMarketing({ referenciaBase64: referenciaB64, geradaBase64: geradaB64, geradaMime: "image/jpeg", estiloBase64: estiloB64, produto: produtoInfo, ctx: { produtoId, pedidoId: p.pedidoId } });
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
      referenciaEstilo: estilo?.id ?? null,
      prompt: melhor!.prompt,
      aprovada,
      avaliacao: melhor!.avaliacao,
      tentativas,
    },
  });
  return { imagemId, aprovada, avaliacao: melhor!.avaliacao, tentativas, provedor: melhor!.provedor, modelo: melhor!.modelo };
}

/**
 * Foto de referência de estilo: a cadastrada em Configurações para o tipo da peça (uma ao acaso);
 * se não houver, o arquivo indicado pelo marketing no cenário (cenarios[].referencia_estilo), se existir.
 */
export async function referenciaDeEstilo(tipo: string | null, arquivoDoCenario?: string | null) {
  const db = await getDb();
  if (tipo) {
    const refs = await db.select().from(schema.imagens).where(eq(schema.imagens.origem, "referencia"));
    const doTipo = refs.filter((r) => ((r.meta as { tipos?: string[] } | null)?.tipos ?? []).includes(tipo));
    if (doTipo.length) {
      const r = doTipo[Math.floor(Math.random() * doTipo.length)];
      return { id: r.id, dados: r.dados, mime: r.mime };
    }
  }
  if (arquivoDoCenario) {
    const caminho = path.resolve(process.cwd(), arquivoDoCenario);
    if (caminho.startsWith(process.cwd() + path.sep)) {
      const dados = await fs.readFile(caminho).catch(() => null);
      if (dados) return { id: arquivoDoCenario, dados: await sharp(dados).jpeg({ quality: 90 }).toBuffer(), mime: "image/jpeg" };
    }
  }
  return null;
}

/** Última foto com modelo de cada produto (para a tabela do pedido e o estúdio). */
export async function fotosModeloPorProduto(produtoIds: string[]) {
  if (!produtoIds.length) return {};
  const db = await getDb();
  const linhas = await db
    .select({ id: schema.imagens.id, produtoId: schema.imagens.produtoId, meta: schema.imagens.meta, criadoEm: schema.imagens.criadoEm })
    .from(schema.imagens)
    .where(eq(schema.imagens.origem, "ia"));
  type Foto = { id: string; aprovada: boolean | null; nota: number | null; decisao: "aprovada" | "recusada" | null; publicavel: boolean };
  const out: Record<string, Foto> = {};
  const peso = (f: Foto) => (f.decisao === "aprovada" ? 3 : f.aprovada ? 2 : 1);
  for (const l of linhas.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))) {
    if (!l.produtoId || !produtoIds.includes(l.produtoId)) continue;
    const m = (l.meta ?? {}) as { aprovada?: boolean | null; avaliacao?: { nota?: number } | null; decisao?: "aprovada" | "recusada" };
    if (m.decisao === "recusada") continue; // recusada na fila de aprovação: nunca aparece
    const f: Foto = { id: l.id, aprovada: m.aprovada ?? null, nota: m.avaliacao?.nota ?? null, decisao: m.decisao ?? null, publicavel: m.decisao === "aprovada" };
    const atual = out[l.produtoId];
    // Prefere a aprovada pela loja; depois a aprovada pelo marketing; empate → a mais recente.
    if (!atual || peso(f) >= peso(atual)) out[l.produtoId] = f;
  }
  return out;
}
