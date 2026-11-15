/**
 * Chegada e conferência da mercadoria (itens 23 e 24 da revisão).
 *  - situação do pedido: Em trânsito → Recebido → Conferido;
 *  - conferência por linha: quantidade recebida (padrão = pedida), com defeito (foto e observação);
 *  - o que entra no estoque é estoqueEntrada() (src/lib/estoque.ts): recebida − defeito;
 *  - faltas e defeitos viram o relatório para o fornecedor e os créditos da conta dele.
 *
 * Funções puras (sem banco e sem "server-only"): usadas nas rotas e nas telas (celular),
 * testadas em tests/operacao-recebimento.test.ts.
 */
import { estoqueEntrada } from "./estoque";
import { lerLinha } from "./extracao";
import { lerNumeroBr } from "./numeros";

export type SituacaoRecebimento = "em_transito" | "recebido" | "conferido";

export const SITUACOES: { id: SituacaoRecebimento; nome: string; explicacao: string }[] = [
  { id: "em_transito", nome: "Em trânsito", explicacao: "A mercadoria está a caminho." },
  { id: "recebido", nome: "Recebido", explicacao: "A caixa chegou. Falta conferir peça por peça." },
  { id: "conferido", nome: "Conferido", explicacao: "Tudo contado: entra no estoque o que foi conferido." },
];

export const nomeSituacao = (s: string | null | undefined) => SITUACOES.find((x) => x.id === s)?.nome ?? "Não informado";

export function situacaoValida(v: unknown): SituacaoRecebimento | null {
  return SITUACOES.some((s) => s.id === v) ? (v as SituacaoRecebimento) : null;
}

/* ------------------------------------------------------------------ datas */

const dois = (n: number) => String(n).padStart(2, "0");

/** Data de hoje (AAAA-MM-DD) no fuso de quem chama (no celular: o horário da loja). */
export function dataLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** AAAA-MM-DD de um dia que existe (entre 2000 e 2100); senão null. */
export function dataValida(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [a, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return a >= 2000 && a <= 2100 ? v : null;
}

/** "2026-11-15" → "15/11/2026". */
export const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/* ----------------------------------------------------- divergência da linha */

export interface LinhaConferivel {
  quantidade: number; // pedida
  quantidadeRecebida?: number | null; // null = ainda não conferida
  quantidadeDefeito?: number | null;
}

export interface Divergencia {
  conferida: boolean;
  pedida: number;
  recebida: number | null;
  defeito: number;
  entram: number; // estoqueEntrada: o que vai para o estoque e para o UP
  falta: number;
  sobra: number;
  aCreditar: number; // peças a pedir ao fornecedor (crédito ou reposição) = pedida − boas
}

const inteiro = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * Diferença entre o pedido e o que chegou. Veio 14 de 13 com 1 defeito: a sobra cobre o defeito,
 * não há o que cobrar. Veio 11 de 13 com 1 defeito: falta 2 + defeito 1 = 3 peças a creditar.
 */
export function divergencia(p: LinhaConferivel): Divergencia {
  const pedida = inteiro(p.quantidade);
  const entram = estoqueEntrada(p);
  if (p.quantidadeRecebida == null) return { conferida: false, pedida, recebida: null, defeito: 0, entram, falta: 0, sobra: 0, aCreditar: 0 };
  const recebida = inteiro(p.quantidadeRecebida);
  const defeito = Math.min(inteiro(p.quantidadeDefeito), recebida);
  return {
    conferida: true,
    pedida,
    recebida,
    defeito,
    entram,
    falta: Math.max(0, pedida - recebida),
    sobra: Math.max(0, recebida - pedida),
    aCreditar: Math.max(0, pedida - entram),
  };
}

export const temProblema = (d: Divergencia) => d.conferida && (d.falta > 0 || d.defeito > 0 || d.sobra > 0);

/* ------------------------------------------------- o que a tela pode gravar */

export const MAX_QUANTIDADE = 100_000;
export const MAX_OBS = 500;

export interface EstadoConferencia {
  quantidade: number;
  quantidadeRecebida: number | null;
  quantidadeDefeito: number;
  defeitoObs: string | null;
}

export interface EntradaConferencia {
  quantidadeRecebida?: unknown;
  quantidadeDefeito?: unknown;
  defeitoObs?: unknown;
}

function lerQuantidade(v: unknown): number | undefined {
  const n = lerNumeroBr(v);
  return n != null && Number.isInteger(n) && n >= 0 && n <= MAX_QUANTIDADE ? n : undefined;
}

/**
 * Nova conferência da linha a partir do que veio da tela (só os campos enviados mudam):
 *  - quantidades inteiras de 0 a 100.000; recebida null = desfaz a conferência da linha;
 *  - marcar defeito numa linha ainda não conferida = recebeu a quantidade pedida;
 *  - defeito nunca maior que o recebido; observação com até 500 caracteres.
 */
export function novaConferencia(atual: EstadoConferencia, entrada: EntradaConferencia): { ok: true; valor: EstadoConferencia } | { ok: false; erro: string } {
  let recebida = atual.quantidadeRecebida;
  let defeito = inteiro(atual.quantidadeDefeito);
  let obs = atual.defeitoObs;
  if ("quantidadeRecebida" in entrada) {
    if (entrada.quantidadeRecebida === null || entrada.quantidadeRecebida === "") recebida = null;
    else {
      const n = lerQuantidade(entrada.quantidadeRecebida);
      if (n === undefined) return { ok: false, erro: `Quantidade recebida inválida: use um número inteiro de 0 a ${MAX_QUANTIDADE.toLocaleString("pt-BR")}.` };
      recebida = n;
    }
  }
  if ("quantidadeDefeito" in entrada) {
    const n = entrada.quantidadeDefeito === null || entrada.quantidadeDefeito === "" ? 0 : lerQuantidade(entrada.quantidadeDefeito);
    if (n === undefined) return { ok: false, erro: "Quantidade com defeito inválida: use um número inteiro." };
    defeito = n;
    if (n > 0 && recebida == null) recebida = inteiro(atual.quantidade);
  }
  if ("defeitoObs" in entrada) {
    const t = typeof entrada.defeitoObs === "string" ? entrada.defeitoObs.trim().slice(0, MAX_OBS) : "";
    obs = t || null;
  }
  if (recebida == null) defeito = 0;
  else defeito = Math.min(defeito, recebida);
  return { ok: true, valor: { quantidade: atual.quantidade, quantidadeRecebida: recebida, quantidadeDefeito: defeito, defeitoObs: obs } };
}

/** "Tudo certo": a linha ainda não conferida recebe a quantidade pedida, sem defeito. */
export const tudoCerto = (p: { quantidade: number }) => ({ quantidadeRecebida: inteiro(p.quantidade), quantidadeDefeito: 0 });

/* --------------------------------------------------------------- resumo */

export interface ResumoConferencia {
  linhas: number;
  conferidas: number;
  pendentes: number;
  pedidas: number; // peças pedidas
  recebidas: number; // peças contadas nas linhas conferidas
  defeito: number;
  entram: number; // peças que entram no estoque (linhas pendentes contam pela quantidade pedida)
  faltas: number;
  sobras: number;
  comProblema: number; // linhas com falta, sobra ou defeito
  pecasACreditar: number;
  valorACreditar: number; // na moeda do pedido
}

export function resumoConferencia(linhas: (LinhaConferivel & { precoOrigem?: number | null })[]): ResumoConferencia {
  const r: ResumoConferencia = { linhas: linhas.length, conferidas: 0, pendentes: 0, pedidas: 0, recebidas: 0, defeito: 0, entram: 0, faltas: 0, sobras: 0, comProblema: 0, pecasACreditar: 0, valorACreditar: 0 };
  for (const l of linhas) {
    const d = divergencia(l);
    r.pedidas += d.pedida;
    r.entram += d.entram;
    if (!d.conferida) {
      r.pendentes++;
      continue;
    }
    r.conferidas++;
    r.recebidas += d.recebida ?? 0;
    r.defeito += d.defeito;
    r.faltas += d.falta;
    r.sobras += d.sobra;
    if (temProblema(d)) r.comProblema++;
    r.pecasACreditar += d.aCreditar;
    r.valorACreditar += d.aCreditar * (Number(l.precoOrigem) || 0);
  }
  r.valorACreditar = Math.round(r.valorACreditar * 100) / 100;
  return r;
}

/* ------------------------------------------------- relatório do fornecedor */

/** Especificação/cor do fornecedor (G, MR, 金色…): a gravada, senão a lida da linha original do documento, senão a variação. */
export function especificacaoDaLinha(p: { especificacao?: string | null; textoOriginal?: string | null; variacao?: string | null }): string {
  return (p.especificacao || (p.textoOriginal ? lerLinha(p.textoOriginal).especificacao : undefined) || p.variacao || "").trim();
}

export interface LinhaParaRelatorio extends LinhaConferivel {
  id: string;
  linha: number | null;
  codigoFornecedor: string | null;
  especificacao: string | null;
  nome: string | null;
  imagemId: string | null;
  defeitoImagemId: string | null;
  defeitoObs: string | null;
  precoOrigem: number | null;
}

export interface ItemRelatorio {
  id: string;
  linha: number | null;
  codigo: string;
  especificacao: string;
  nome: string;
  imagemId: string | null;
  defeitoImagemId: string | null;
  obs: string;
  pedida: number;
  recebida: number;
  falta: number;
  defeito: number;
  sobra: number;
  aCreditar: number;
  preco: number;
  valor: number; // aCreditar × preço, na moeda do pedido
}

/** Linhas com falta ou defeito a pedir ao fornecedor (crédito ou reposição), com o total. */
export function relatorioFornecedor(linhas: LinhaParaRelatorio[]): { itens: ItemRelatorio[]; pecas: number; total: number } {
  const itens: ItemRelatorio[] = [];
  for (const l of linhas) {
    const d = divergencia(l);
    if (!d.conferida || d.aCreditar <= 0) continue;
    const preco = Number(l.precoOrigem) || 0;
    itens.push({
      id: l.id,
      linha: l.linha,
      codigo: l.codigoFornecedor ?? "",
      especificacao: l.especificacao ?? "",
      nome: l.nome ?? "",
      imagemId: l.imagemId,
      defeitoImagemId: l.defeitoImagemId,
      obs: l.defeitoObs ?? "",
      pedida: d.pedida,
      recebida: d.recebida ?? 0,
      falta: d.falta,
      defeito: d.defeito,
      sobra: d.sobra,
      aCreditar: d.aCreditar,
      preco,
      valor: Math.round(d.aCreditar * preco * 100) / 100,
    });
  }
  itens.sort((a, b) => (a.linha ?? 0) - (b.linha ?? 0));
  return { itens, pecas: itens.reduce((s, i) => s + i.aCreditar, 0), total: Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100 };
}

/* -------------------------------------------------------------- etiquetas */

/**
 * Quantas etiquetas imprimir de uma linha: pela quantidade que entrou no estoque (conferência).
 * Conferida sem nenhuma peça boa → nenhuma etiqueta. Ainda não conferida → a quantidade pedida (mínimo 1).
 */
export function copiasEtiqueta(p: LinhaConferivel, modo: "quantidade" | "uma"): number {
  const conferida = p.quantidadeRecebida != null;
  const entram = estoqueEntrada(p);
  if (conferida && entram === 0) return 0;
  if (modo === "uma") return 1;
  return conferida ? entram : Math.max(1, entram);
}
