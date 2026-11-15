/**
 * Conta corrente com o fornecedor (item 30 da revisão): créditos por falta e defeito que a conferência
 * gera e que são abatidos no próximo pedido do mesmo fornecedor, e o lote mínimo de cada fornecedor.
 *
 * Funções puras (sem banco e sem "server-only"): usadas nas rotas e nas telas, testadas em
 * tests/operacao-conta-fornecedor.test.ts.
 */

/** Chave do fornecedor: o nome original sem espaços e em minúsculas (a mesma regra da recompra). */
export const chaveFornecedor = (nome: string | null | undefined) => (nome ?? "").replace(/\s+/g, "").toLowerCase();

export type StatusCredito = "aberto" | "abatido" | "cancelado";

export const NOME_STATUS_CREDITO: Record<StatusCredito, string> = {
  aberto: "em aberto",
  abatido: "abatido",
  cancelado: "cancelado",
};

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const inteiro = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

const SIMBOLO: Record<string, string> = { CNY: "¥", BRL: "R$", USD: "US$" };

/** "¥ 45,00", "US$ 3,50", "R$ 12,00" (para textos do histórico e das telas). */
export const textoValorMoeda = (v: number | null | undefined, moeda: string) =>
  v == null || Number.isNaN(v) ? "—" : `${SIMBOLO[moeda] ?? moeda} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* -------------------------------------------- créditos gerados na conferência */

/** O que a conferência pede ao fornecedor numa linha do pedido. */
export interface NecessidadeCredito {
  produtoId: string;
  quantidade: number; // peças a creditar (falta + defeito, descontada a sobra)
  preco: number; // preço unitário na moeda do pedido
  descricao: string;
}

/** Crédito já gravado (só os campos que o planejamento usa). */
export interface CreditoGravado {
  id: string;
  produtoId: string | null;
  status: string;
  quantidade: number;
  valorMoeda: number;
  moeda: string;
  descricao: string;
}

export interface PlanoCreditos {
  criar: { produtoId: string; quantidade: number; valorMoeda: number; descricao: string }[];
  atualizar: { id: string; quantidade: number; valorMoeda: number; descricao: string }[]; // ficam (ou voltam a ficar) "aberto"
  cancelar: { id: string; descricao: string }[]; // a falta sumiu: cancelado com quantidade 0
}

/**
 * Créditos da conferência de UM pedido, sem duplicar ao conferir de novo. Por linha (produto):
 *  - abatido (já usado em outro pedido) fica travado e conta como já pedido;
 *  - o crédito em aberto da linha é atualizado; sem ele, reabre o cancelado pela própria conferência
 *    (quantidade 0) ou cria um novo;
 *  - a falta sumiu → o crédito em aberto é cancelado (quantidade e valor 0);
 *  - crédito cancelado pela gestora (quantidade > 0) não volta sozinho e a linha não ganha outro.
 * Créditos sem produto (lançados à mão) nunca são mexidos aqui.
 */
export function planejarCreditos(necessidades: NecessidadeCredito[], existentes: CreditoGravado[], moeda: string): PlanoCreditos {
  const plano: PlanoCreditos = { criar: [], atualizar: [], cancelar: [] };
  const porProduto = new Map<string, CreditoGravado[]>();
  for (const c of existentes) {
    if (!c.produtoId) continue;
    porProduto.set(c.produtoId, [...(porProduto.get(c.produtoId) ?? []), c]);
  }
  const vistos = new Set<string>();

  for (const n of necessidades) {
    if (vistos.has(n.produtoId)) continue; // a mesma linha duas vezes: vale a primeira
    vistos.add(n.produtoId);
    const doProduto = porProduto.get(n.produtoId) ?? [];
    const travado = doProduto.filter((c) => c.status === "abatido").reduce((s, c) => s + inteiro(c.quantidade), 0);
    const abertos = doProduto.filter((c) => c.status === "aberto");
    const reabrivel = doProduto.find((c) => c.status === "cancelado" && inteiro(c.quantidade) === 0);
    const canceladoPelaGestora = doProduto.some((c) => c.status === "cancelado" && inteiro(c.quantidade) > 0);
    const desejado = Math.max(0, inteiro(n.quantidade) - travado);
    const valor = r2(desejado * (Number(n.preco) || 0));
    const editavel = abertos[0] ?? (canceladoPelaGestora ? undefined : reabrivel);

    // Duplicados em aberto (não deveria haver): fica o primeiro.
    for (const extra of abertos.slice(1)) plano.cancelar.push({ id: extra.id, descricao: `${extra.descricao} — duplicado` });

    if (desejado > 0) {
      if (editavel) {
        const igual =
          editavel.status === "aberto" &&
          inteiro(editavel.quantidade) === desejado &&
          r2(editavel.valorMoeda) === valor &&
          editavel.descricao === n.descricao &&
          editavel.moeda === moeda;
        if (!igual) plano.atualizar.push({ id: editavel.id, quantidade: desejado, valorMoeda: valor, descricao: n.descricao });
      } else if (!canceladoPelaGestora) {
        plano.criar.push({ produtoId: n.produtoId, quantidade: desejado, valorMoeda: valor, descricao: n.descricao });
      }
    } else if (abertos[0]) {
      plano.cancelar.push({ id: abertos[0].id, descricao: `${abertos[0].descricao} — corrigido na conferência` });
    }
  }

  // Linhas que não pedem mais crédito (excluídas ou desconferidas): cancela o que estiver em aberto.
  for (const [produtoId, lista] of porProduto) {
    if (vistos.has(produtoId)) continue;
    for (const c of lista) if (c.status === "aberto") plano.cancelar.push({ id: c.id, descricao: `${c.descricao} — corrigido na conferência` });
  }
  return plano;
}

/** Texto do crédito: "#12 · MR1542A (G) · BRINCO ARGOLA: falta 2, defeito 1". */
export function descricaoCredito(l: {
  linha?: number | null;
  codigo?: string | null;
  especificacao?: string | null;
  nome?: string | null;
  falta: number;
  defeito: number;
  sobra?: number;
}): string {
  const partes = [l.falta > 0 && `falta ${l.falta}`, l.defeito > 0 && `defeito ${l.defeito}`, (l.sobra ?? 0) > 0 && `sobra ${l.sobra}`].filter(Boolean);
  const peca = [l.linha != null ? `#${l.linha}` : null, l.codigo ? `${l.codigo}${l.especificacao ? ` (${l.especificacao})` : ""}` : null, l.nome?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  return `${peca || "Peça do pedido"}: ${partes.join(", ") || "sem diferença"}`.slice(0, 300);
}

/* ------------------------------------------------------ abater no pedido */

export interface CreditoParaAbater {
  status: string;
  moeda: string;
  fornecedorChave: string;
  pedidoId: string | null;
}

/**
 * Motivo para NÃO poder abater o crédito neste pedido (null = pode). O crédito vai para um pedido do mesmo
 * fornecedor, na mesma moeda, comprado no mesmo dia ou depois do pedido onde ele nasceu (o "pedido seguinte").
 */
export function motivoNaoAbater(
  c: CreditoParaAbater,
  pedido: { id: string; moeda: string; fornecedor: string | null; dataCompra?: string | null },
  origem?: { dataCompra?: string | null } | null,
): string | null {
  if (c.status !== "aberto") return c.status === "abatido" ? "Este crédito já foi abatido." : "Este crédito está cancelado.";
  if (!chaveFornecedor(pedido.fornecedor)) return "O pedido não tem o nome do fornecedor.";
  if (c.fornecedorChave !== chaveFornecedor(pedido.fornecedor)) return "O crédito é de outro fornecedor.";
  if (c.pedidoId === pedido.id) return "O crédito nasceu neste pedido: abata no próximo pedido do fornecedor.";
  if (origem?.dataCompra && pedido.dataCompra && pedido.dataCompra < origem.dataCompra) return "Este pedido é anterior ao pedido onde o crédito nasceu: abata num pedido seguinte.";
  if (c.moeda !== pedido.moeda) return `O crédito está em ${c.moeda} e o pedido em ${pedido.moeda}.`;
  return null;
}

/** Soma dos créditos abatidos neste pedido, na moeda do pedido (entra na cotação efetiva). */
export function somaAbatida(creditos: { status: string; abatidoPedidoId: string | null; moeda: string; valorMoeda: number }[], pedidoId: string, moeda: string): number {
  return r2(creditos.filter((c) => c.status === "abatido" && c.abatidoPedidoId === pedidoId && c.moeda === moeda).reduce((s, c) => s + (Number(c.valorMoeda) || 0), 0));
}

/* --------------------------------------------------------- resumo da conta */

export interface TotalCreditos {
  moeda: string;
  valor: number;
  pecas: number;
  creditos: number;
}

/** Créditos em aberto e abatidos, somados por moeda (um fornecedor quase sempre tem uma moeda só). */
export function totaisCreditos(creditos: { status: string; moeda: string; valorMoeda: number; quantidade: number }[]) {
  const somar = (status: StatusCredito) => {
    const porMoeda = new Map<string, TotalCreditos>();
    for (const c of creditos) {
      if (c.status !== status) continue;
      const t = porMoeda.get(c.moeda) ?? { moeda: c.moeda, valor: 0, pecas: 0, creditos: 0 };
      t.valor = r2(t.valor + (Number(c.valorMoeda) || 0));
      t.pecas += inteiro(c.quantidade);
      t.creditos++;
      porMoeda.set(c.moeda, t);
    }
    return [...porMoeda.values()];
  };
  return { abertos: somar("aberto"), abatidos: somar("abatido"), cancelados: creditos.filter((c) => c.status === "cancelado").length };
}

/* ----------------------------------------------------------- lote mínimo */

export const MAX_LOTE_MINIMO = 10000;

/**
 * Lote mínimo digitado: inteiro de 1 a 10.000. Vazio → null (vale o padrão da loja).
 * Retorna undefined quando o valor é inválido.
 */
export function lerLoteMinimo(v: unknown): number | null | undefined {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isInteger(n) || n < 1 || n > MAX_LOTE_MINIMO) return undefined;
  return n;
}

/** Lote mínimo que vale para o fornecedor: o dele, senão o padrão da loja (nunca menor que 1). */
export const loteMinimoEfetivo = (lote: number | null | undefined, padrao: number | null | undefined) =>
  lote && lote > 0 ? Math.floor(lote) : Math.max(1, Math.floor(Number(padrao) || 1));
