import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { salvarImagem } from "@/lib/servicos";
import { apelidoDe, apelidosFornecedores, creditosParaPedido, sincronizarCreditosDoPedido } from "@/lib/fornecedores";
import {
  dataBr,
  dataLocal,
  dataValida,
  divergencia,
  especificacaoDaLinha,
  nomeSituacao,
  novaConferencia,
  resumoConferencia,
  situacaoValida,
  tudoCerto,
  type EntradaConferencia,
  type SituacaoRecebimento,
} from "@/lib/recebimento";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Chegada e conferência do pedido (itens 23 e 24). A funcionária pode conferir (não exige gestora).
 *  GET   → situação, data de chegada, linhas com o que foi conferido, resumo e (gestora) créditos gerados.
 *  PATCH → { situacao?: "em_transito" | "recebido" | null, dataChegada?, hoje?,
 *            linhas?: [{ id, quantidadeRecebida?, quantidadeDefeito?, defeitoObs?, removerFoto? }],
 *            tudoCerto?: true, concluir?: true, reabrir?: true }
 *          "conferido" só pela conclusão; concluir gera/atualiza os créditos com o fornecedor.
 *  POST  → multipart { produtoId, foto }: foto da peça com defeito (fica só no pedido, não vai para o catálogo).
 */

async function estado(pedidoId: string, gestora: boolean) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) return null;
  const itens = await db.select().from(schema.produtos).where(eq(schema.produtos.pedidoId, pedidoId)).orderBy(asc(schema.produtos.linha));
  const linhas = itens.map((p) => ({
    id: p.id,
    linha: p.linha,
    codigoFornecedor: p.codigoFornecedor,
    especificacao: especificacaoDaLinha(p) || null,
    nome: p.nome ?? p.traducao ?? p.descricaoOriginal,
    referencia: p.referencia,
    imagemId: p.imagemId,
    quantidade: p.quantidade,
    quantidadeRecebida: p.quantidadeRecebida,
    quantidadeDefeito: p.quantidadeDefeito,
    defeitoImagemId: p.defeitoImagemId,
    defeitoObs: p.defeitoObs,
    precoOrigem: p.precoOrigem,
    recompra: p.recompraDe != null,
  }));
  const creditos = gestora ? ((await creditosParaPedido(pedidoId))?.gerados ?? []) : [];
  return {
    pedido: {
      id: pedido.id,
      numero: pedido.numero,
      fornecedor: pedido.fornecedor,
      fornecedorApelido: apelidoDe(await apelidosFornecedores(), pedido.fornecedor),
      moeda: pedido.moeda,
      dataCompra: pedido.dataCompra,
      dataChegada: pedido.dataChegada,
      recebimento: situacaoValida(pedido.recebimento),
      conferidoEm: pedido.conferidoEm,
      conferidoPor: pedido.conferidoPor,
    },
    linhas,
    resumo: resumoConferencia(linhas),
    creditos,
    gestora,
  };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const u = await exigirPapel(req);
    const { id } = await params;
    const e = await estado(id, u.p === "gestora");
    if (!e) return erro("Pedido não encontrado", 404);
    return ok(e);
  } catch (e) {
    return erro(e);
  }
}

type CorpoLinha = { id?: unknown; quantidadeRecebida?: unknown; quantidadeDefeito?: unknown; defeitoObs?: unknown; removerFoto?: unknown };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const u = await exigirPapel(req);
    const { id } = await params;
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return erro("Dados inválidos.", 400);
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    const itens = await db.select().from(schema.produtos).where(eq(schema.produtos.pedidoId, id));
    const porId = new Map(itens.map((p) => [p.id, p]));
    const hoje = dataValida(corpo.hoje) ?? dataLocal();
    const agora = new Date().toISOString();
    const nomePedido = pedido.numero ?? id.slice(0, 8);
    const antes: SituacaoRecebimento | null = situacaoValida(pedido.recebimento);
    let situacao = antes;
    const avisos: string[] = [];
    const resumoHistorico: string[] = [];
    const fotosRemovidas: string[] = [];

    // 1) Linhas conferidas (validadas todas antes de gravar).
    const mudancas = new Map<string, { quantidadeRecebida: number | null; quantidadeDefeito: number; defeitoObs: string | null; defeitoImagemId?: null }>();
    if (corpo.linhas !== undefined) {
      if (!Array.isArray(corpo.linhas) || corpo.linhas.length > 5000) return erro("Linhas inválidas.", 400);
      for (const bruto of corpo.linhas as CorpoLinha[]) {
        const atual = typeof bruto?.id === "string" ? porId.get(bruto.id) : undefined;
        if (!atual) return erro("Peça não encontrada neste pedido. Recarregue a tela.", 404);
        const entrada: EntradaConferencia = {};
        if ("quantidadeRecebida" in bruto) entrada.quantidadeRecebida = bruto.quantidadeRecebida;
        if ("quantidadeDefeito" in bruto) entrada.quantidadeDefeito = bruto.quantidadeDefeito;
        if ("defeitoObs" in bruto) entrada.defeitoObs = bruto.defeitoObs;
        const base = mudancas.get(atual.id) ?? atual;
        const r = novaConferencia({ quantidade: atual.quantidade, quantidadeRecebida: base.quantidadeRecebida, quantidadeDefeito: base.quantidadeDefeito, defeitoObs: base.defeitoObs }, entrada);
        if (!r.ok) return erro(`Linha ${atual.linha ?? ""} (${atual.codigoFornecedor ?? "sem código"}): ${r.erro}`, 400);
        const m: { quantidadeRecebida: number | null; quantidadeDefeito: number; defeitoObs: string | null; defeitoImagemId?: null } = {
          quantidadeRecebida: r.valor.quantidadeRecebida,
          quantidadeDefeito: r.valor.quantidadeDefeito,
          defeitoObs: r.valor.defeitoObs,
        };
        if (bruto.removerFoto === true && atual.defeitoImagemId) {
          m.defeitoImagemId = null;
          fotosRemovidas.push(atual.defeitoImagemId);
        }
        mudancas.set(atual.id, m);
      }
    }

    // 2) "Tudo certo": as linhas ainda não conferidas recebem a quantidade pedida, sem defeito.
    let marcadasTudoCerto = 0;
    if (corpo.tudoCerto === true) {
      for (const p of itens) {
        const atual = mudancas.get(p.id) ?? p;
        if (atual.quantidadeRecebida != null) continue;
        mudancas.set(p.id, { ...(mudancas.get(p.id) ?? {}), ...tudoCerto(p), defeitoObs: atual.defeitoObs });
        marcadasTudoCerto++;
      }
      if (marcadasTudoCerto) resumoHistorico.push(`${marcadasTudoCerto} linha(s) marcadas como tudo certo`);
    }

    // Só as linhas que mudaram de verdade.
    const linhasMudadas = [...mudancas].filter(([pid, m]) => {
      const p = porId.get(pid)!;
      return p.quantidadeRecebida !== m.quantidadeRecebida || p.quantidadeDefeito !== m.quantidadeDefeito || p.defeitoObs !== m.defeitoObs || m.defeitoImagemId === null;
    });
    // Conferir com a conferência já concluída: registra o que mudou no histórico.
    if (antes === "conferido")
      for (const [pid, m] of linhasMudadas) {
        const p = porId.get(pid)!;
        const de = divergencia(p);
        const para = divergencia({ quantidade: p.quantidade, ...m });
        const partes = [
          de.recebida !== para.recebida && `recebidas ${de.recebida ?? "—"} → ${para.recebida ?? "—"}`,
          de.defeito !== para.defeito && `defeito ${de.defeito} → ${para.defeito}`,
        ].filter(Boolean);
        if (partes.length) resumoHistorico.push(`linha ${p.linha ?? "?"} ${p.codigoFornecedor ?? ""}: ${partes.join(", ")}`);
      }

    // Começou a conferir (contou peças) com o pedido ainda "em trânsito": a mercadoria chegou.
    const setPedido: Partial<typeof schema.pedidos.$inferInsert> = {};
    const contou = linhasMudadas.some(([pid, m]) => {
      const p = porId.get(pid)!;
      return p.quantidadeRecebida !== m.quantidadeRecebida || p.quantidadeDefeito !== m.quantidadeDefeito;
    });
    if (contou && (situacao == null || situacao === "em_transito")) {
      situacao = "recebido";
      setPedido.recebimento = "recebido";
      if (!pedido.dataChegada) setPedido.dataChegada = hoje;
      avisos.push(`Conferência começada: o pedido passou para "Recebido"${pedido.dataChegada ? "" : ` com chegada em ${dataBr(hoje)}`}.`);
    }

    // 3) Data de chegada.
    if ("dataChegada" in corpo) {
      const vazio = corpo.dataChegada === null || corpo.dataChegada === "";
      const d = vazio ? null : dataValida(corpo.dataChegada);
      if (!vazio && !d) return erro("Data de chegada inválida.", 400);
      if (d && d > somarDia(hoje)) return erro("A data de chegada não pode ser no futuro.", 400);
      if (!d && situacao && situacao !== "em_transito") return erro("O pedido já chegou: informe a data de chegada (ou volte a situação para Em trânsito).", 400);
      if (d !== pedido.dataChegada) {
        setPedido.dataChegada = d;
        resumoHistorico.push(`chegada ${dataBr(pedido.dataChegada) || "—"} → ${dataBr(d) || "—"}`);
      }
    }

    // 4) Reabrir a conferência concluída (antes da situação: "reabrir e voltar para Em trânsito").
    if (corpo.reabrir === true && situacao === "conferido") {
      situacao = "recebido";
      setPedido.recebimento = "recebido";
      setPedido.conferidoEm = null;
      setPedido.conferidoPor = null;
      resumoHistorico.push("conferência reaberta");
    }

    // 5) Situação (Em trânsito / Recebido). "Conferido" só pela conclusão.
    if ("situacao" in corpo) {
      const nova = corpo.situacao === null || corpo.situacao === "" ? null : situacaoValida(corpo.situacao);
      if (corpo.situacao != null && corpo.situacao !== "" && !nova) return erro("Situação inválida.", 400);
      if (nova === "conferido") return erro('Para marcar como conferido, conclua a conferência (botão "Concluir conferência").', 400);
      if (situacao === "conferido") return erro("A conferência já foi concluída. Use “Reabrir conferência” para mudar a situação.", 409);
      if (nova !== situacao) {
        if (nova === "recebido" && !(setPedido.dataChegada ?? pedido.dataChegada)) {
          setPedido.dataChegada = hoje;
          avisos.push(`Chegada em ${dataBr(hoje)} (hoje). Se chegou em outro dia, troque a data.`);
        }
        if (nova !== "recebido") setPedido.dataChegada = null; // em trânsito (ou não informado): ainda não chegou
        setPedido.recebimento = nova;
        resumoHistorico.push(`situação ${nomeSituacao(situacao)} → ${nomeSituacao(nova)}`);
        situacao = nova;
      }
    }

    // 6) Concluir: todas as linhas conferidas.
    let concluiu = false;
    if (corpo.concluir === true) {
      const pendentes = itens.filter((p) => (mudancas.get(p.id) ?? p).quantidadeRecebida == null).length;
      if (pendentes) return erro(`Ainda há ${pendentes} linha(s) sem conferir. Confira cada uma ou use “Tudo certo”.`, 400);
      if (situacao !== "conferido") {
        concluiu = true;
        situacao = "conferido";
        setPedido.recebimento = "conferido";
        setPedido.conferidoEm = agora;
        setPedido.conferidoPor = u.n;
        if (!(setPedido.dataChegada ?? pedido.dataChegada)) setPedido.dataChegada = hoje;
      }
    }

    // Grava tudo de uma vez.
    const ops: BatchItem<"sqlite">[] = linhasMudadas.map(([pid, m]) => db.update(schema.produtos).set({ ...m, atualizadoEm: agora }).where(eq(schema.produtos.id, pid)));
    if (Object.keys(setPedido).length) ops.push(db.update(schema.pedidos).set(setPedido).where(eq(schema.pedidos.id, id)));
    if (ops.length) await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    for (const img of fotosRemovidas) await db.delete(schema.imagens).where(and(eq(schema.imagens.id, img), eq(schema.imagens.origem, "defeito")));

    // Créditos com o fornecedor: na conclusão e em cada correção depois de concluída.
    if (situacao === "conferido" && (concluiu || linhasMudadas.length)) {
      const c = await sincronizarCreditosDoPedido(id);
      if (c.semFornecedor) avisos.push("O pedido não tem o nome do fornecedor: as faltas e os defeitos ficaram no relatório, mas sem crédito na conta do fornecedor.");
    }

    if (concluiu) {
      const final = await estado(id, u.p === "gestora");
      const r = final!.resumo;
      resumoHistorico.push(`conferência concluída: ${r.entram} de ${r.pedidas} peça(s) entram no estoque; faltas ${r.faltas}, defeito ${r.defeito}, sobras ${r.sobras}`);
      await registrar(req, { acao: "pedido.conferencia", entidade: "pedido", entidadeId: id, resumo: `Pedido ${nomePedido}: ${resumoHistorico.join("; ")}` });
      return ok({ ...final, avisos });
    }
    if (resumoHistorico.length) await registrar(req, { acao: "pedido.recebimento", entidade: "pedido", entidadeId: id, resumo: `Pedido ${nomePedido}: ${resumoHistorico.join("; ")}` });
    return ok({ ...(await estado(id, u.p === "gestora")), avisos });
  } catch (e) {
    return erro(e);
  }
}

/** Dia seguinte (folga de fuso para "não pode ser no futuro"). */
function somarDia(d: string) {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

const MAX_FOTO = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const u = await exigirPapel(req);
    const { id } = await params;
    const form = await req.formData().catch(() => null);
    if (!form) return erro("Envie a foto do defeito.", 400);
    const produtoId = String(form.get("produtoId") ?? "");
    const foto = form.get("foto");
    if (!(foto instanceof File) || !foto.size) return erro("Envie a foto do defeito.", 400);
    if (foto.size > MAX_FOTO) return erro("Foto grande demais (máximo 15 MB).", 400);
    if (foto.type && !foto.type.startsWith("image/")) return erro("O arquivo não é uma foto.", 400);
    const db = await getDb();
    const [p] = await db
      .select({ id: schema.produtos.id, defeitoImagemId: schema.produtos.defeitoImagemId })
      .from(schema.produtos)
      .where(and(eq(schema.produtos.id, produtoId), eq(schema.produtos.pedidoId, id)));
    if (!p) return erro("Peça não encontrada neste pedido.", 404);
    let imagemId: string;
    try {
      // Fica ligada ao pedido (não ao produto): não aparece na galeria do produto nem vai para o UP ou o catálogo.
      imagemId = await salvarImagem({ dados: Buffer.from(await foto.arrayBuffer()), origem: "defeito", pedidoId: id, produtoId: null, meta: { produtoId: p.id, defeito: true } });
    } catch {
      return erro("Não consegui abrir a foto. Tire de novo ou envie em JPG.", 400);
    }
    await db.update(schema.produtos).set({ defeitoImagemId: imagemId, atualizadoEm: new Date().toISOString() }).where(eq(schema.produtos.id, p.id));
    if (p.defeitoImagemId) await db.delete(schema.imagens).where(and(eq(schema.imagens.id, p.defeitoImagemId), eq(schema.imagens.origem, "defeito")));
    return ok({ ...(await estado(id, u.p === "gestora")), imagemId });
  } catch (e) {
    return erro(e);
  }
}
