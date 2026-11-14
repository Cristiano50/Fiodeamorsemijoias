/**
 * Custos e precificação. Funções puras, usadas no servidor e no navegador.
 * Política padrão: src/config/precificacao.json (administrador) + src/config/fiscal.json (contador).
 */

export interface ComponenteCusto {
  id: string;
  nome: string;
  tipo: "percentual" | "valor_fixo_pedido" | "valor_por_peca";
  padrao: number;
  explicacao?: string;
  base?: string;
}

export interface FaixaCusto {
  ate: number | null;
  fator: number;
}

export interface TabelaPreco {
  id: string;
  nome: string;
  multiplicador_sobre_tabela_base: number;
  tabela_up_vendas?: string | null;
  descricao?: string;
}

export interface PoliticaPreco {
  fator_padrao: number;
  fator_minimo?: number;
  fatores_por_tipo: Record<string, number>;
  usar_faixas: boolean;
  faixas_modo?: string;
  faixas_custo: FaixaCusto[];
  arredondamento: { modo: string; centavos: number; minimo?: number; direcao?: string };
  tabela_base: string;
  tabelas_preco: TabelaPreco[];
  comissao_consignacao_pct: number;
  margem_minima_pct: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ custos */

export interface ItemCusto {
  id: string;
  precoOrigem: number | null;
  quantidade: number;
}

export interface ResultadoCusto {
  custoProdutoBrl: number;
  custoAdicionalBrl: number;
  custoTotalBrl: number;
}

export interface DetalheCusto {
  mercadoriaBrl: number;
  pecas: number;
  linhas: { id: string; nome: string; valor: number }[];
  adicionaisBrl: number;
  porPecaBrl: number;
  fatorCusto: number; // (mercadoria + adicionais) / mercadoria
  custoTotalPedidoBrl: number;
}

/** Componentes de valor fixo do pedido (podem ser rateados por peça). */
const FIXOS_CONHECIDOS = ["frete_internacional", "taxa_siscomex", "desembaraco_despachante", "frete_nacional"];
const FORMULA_CONHECIDA = new Set([
  "taxa_agente", "frete_internacional", "seguro_internacional", "spread_cambio", "iof_cambio", "imposto_importacao",
  "ipi_importacao", "pis_importacao", "cofins_importacao", "taxa_siscomex", "desembaraco_despachante",
  "icms_importacao", "frete_nacional", "perdas_defeitos", "embalagem_etiqueta",
]);

/**
 * Custo de aquisição do pedido (fórmula do contador — docs/especialistas/contador.md):
 *  M = Σ preço × qtd × cotação
 *  EXT (pago ao exterior) = M + agente + frete internacional + seguro → spread → IOF sobre (EXT + spread)
 *  VA (valor aduaneiro) = M + frete + seguro → II, IPI, PIS, COFINS; ICMS "por dentro"
 *  fator de custo = (M + adicionais) / M; custo da peça = preço × cotação × fator + custos por peça.
 * Componentes que não fazem parte da fórmula entram pelo tipo (percentual sobre M, fixo do pedido, por peça).
 */
export function detalharCustos(
  itens: ItemCusto[],
  pedido: { cotacao: number; custos?: Record<string, number> | null },
  componentes: ComponenteCusto[],
): DetalheCusto {
  const valores = pedido.custos ?? {};
  const v = (id: string) => {
    const c = componentes.find((x) => x.id === id);
    return c ? Number(valores[id] ?? c.padrao ?? 0) || 0 : 0;
  };
  const pct = (id: string) => v(id) / 100;
  const M = itens.reduce((s, i) => s + (i.precoOrigem ?? 0) * pedido.cotacao * i.quantidade, 0);
  const pecas = itens.reduce((s, i) => s + i.quantidade, 0);

  const agente = M * pct("taxa_agente");
  const frete = v("frete_internacional");
  const seguro = M * pct("seguro_internacional");
  const ext = M + agente + frete + seguro;
  const spread = ext * pct("spread_cambio");
  const iof = (ext + spread) * pct("iof_cambio");
  const va = M + frete + seguro;
  const ii = va * pct("imposto_importacao");
  const ipi = (va + ii) * pct("ipi_importacao");
  const pis = va * pct("pis_importacao");
  const cofins = va * pct("cofins_importacao");
  const siscomex = v("taxa_siscomex");
  const aliqIcms = pct("icms_importacao");
  const icms = aliqIcms > 0 && aliqIcms < 1 ? ((va + ii + ipi + pis + cofins + siscomex) / (1 - aliqIcms)) * aliqIcms : 0;
  const valoresFormula: Record<string, number> = {
    taxa_agente: agente,
    frete_internacional: frete,
    seguro_internacional: seguro,
    spread_cambio: spread,
    iof_cambio: iof,
    imposto_importacao: ii,
    ipi_importacao: ipi,
    pis_importacao: pis,
    cofins_importacao: cofins,
    taxa_siscomex: siscomex,
    desembaraco_despachante: v("desembaraco_despachante"),
    icms_importacao: icms,
    frete_nacional: v("frete_nacional"),
    perdas_defeitos: M * pct("perdas_defeitos"),
  };

  const linhas: DetalheCusto["linhas"] = [];
  let porPeca = v("embalagem_etiqueta");
  for (const c of componentes) {
    if (c.id === "embalagem_etiqueta") continue;
    let valor = 0;
    if (FORMULA_CONHECIDA.has(c.id)) valor = valoresFormula[c.id] ?? 0;
    else if (c.tipo === "percentual") valor = M * pct(c.id);
    else if (c.tipo === "valor_fixo_pedido") valor = v(c.id);
    else if (c.tipo === "valor_por_peca") {
      porPeca += v(c.id);
      continue;
    }
    if (valor) linhas.push({ id: c.id, nome: c.nome, valor: r2(valor) });
  }
  const adicionais = linhas.reduce((s, l) => s + l.valor, 0);
  return {
    mercadoriaBrl: r2(M),
    pecas,
    linhas,
    adicionaisBrl: r2(adicionais),
    porPecaBrl: r2(porPeca),
    fatorCusto: M > 0 ? Math.round(((M + adicionais) / M) * 10000) / 10000 : 1,
    custoTotalPedidoBrl: r2(M + adicionais + porPeca * pecas),
  };
}

/** Custo unitário de cada item, rateando os adicionais por valor (recomendado) ou os fixos por peça. */
export function calcularCustos(
  itens: ItemCusto[],
  pedido: { cotacao: number; custos?: Record<string, number> | null; rateio?: string | null },
  componentes: ComponenteCusto[],
): Map<string, ResultadoCusto> {
  const d = detalharCustos(itens, pedido, componentes);
  const fixos = pedido.rateio === "peca" ? d.linhas.filter((l) => FIXOS_CONHECIDOS.includes(l.id) || componentes.find((c) => c.id === l.id)?.tipo === "valor_fixo_pedido").reduce((s, l) => s + l.valor, 0) : 0;
  const proporcional = d.adicionaisBrl - fixos;
  const fatorProp = d.mercadoriaBrl > 0 ? (d.mercadoriaBrl + proporcional) / d.mercadoriaBrl : 1;
  const fixoPorPeca = d.pecas > 0 ? fixos / d.pecas : 0;

  const saida = new Map<string, ResultadoCusto>();
  for (const i of itens) {
    const produto = (i.precoOrigem ?? 0) * pedido.cotacao;
    const total = produto * fatorProp + fixoPorPeca + d.porPecaBrl;
    saida.set(i.id, {
      custoProdutoBrl: r2(produto),
      custoAdicionalBrl: r2(total - produto),
      custoTotalBrl: r2(total),
    });
  }
  return saida;
}

/** Aplica um cenário de importação (valores do contador) sobre os padrões dos componentes. */
export function valoresDoCenario(componentes: ComponenteCusto[], cenario?: { valores: Record<string, number> } | null) {
  const out: Record<string, number> = {};
  for (const c of componentes) out[c.id] = c.padrao ?? 0;
  return { ...out, ...(cenario?.valores ?? {}) };
}

/* ------------------------------------------------------------------ preço */

export function arredondar(valor: number, regra: PoliticaPreco["arredondamento"], aplicarMinimo = true): number {
  let v = r2(valor);
  if (regra.modo === "terminar_em") {
    const c = r2(regra.centavos);
    v = r2(Math.ceil(r2(v - c)) + c);
  } else if (regra.modo === "inteiro") {
    v = Math.ceil(v);
  }
  if (aplicarMinimo && regra.minimo && v < regra.minimo) v = regra.minimo;
  return r2(v);
}

/** Fator pela prioridade: da peça → do pedido (escolhido pelo funcionário) → faixas (se ativas) → por tipo → padrão. */
export function escolherFator(
  custoTotal: number,
  tipo: string | null | undefined,
  pol: PoliticaPreco,
  fatorManual?: number | null,
  fatorPedido?: number | null,
): { fator: number; origem: string; piso: number } {
  if (fatorManual && fatorManual > 0) return { fator: fatorManual, origem: "fator da peça", piso: 0 };
  if (fatorPedido && fatorPedido > 0) return { fator: fatorPedido, origem: "fator do pedido", piso: 0 };
  if (pol.usar_faixas && pol.faixas_custo?.length) {
    const faixas = pol.faixas_custo;
    const idx = faixas.findIndex((f) => f.ate === null || custoTotal <= f.ate);
    const i = idx === -1 ? faixas.length - 1 : idx;
    // Regra monotônica: uma peça mais cara nunca sai mais barata que o teto da faixa anterior.
    const anterior = i > 0 ? faixas[i - 1] : null;
    const piso = pol.faixas_modo === "degrau_monotonico" && anterior?.ate ? anterior.ate * anterior.fator : 0;
    return { fator: faixas[i].fator, origem: `faixa até ${faixas[i].ate ?? "∞"}`, piso };
  }
  if (tipo && pol.fatores_por_tipo?.[tipo]) return { fator: pol.fatores_por_tipo[tipo], origem: `tipo ${tipo}`, piso: 0 };
  return { fator: pol.fator_padrao, origem: "padrão", piso: 0 };
}

export interface ResultadoPreco {
  fator: number;
  origemFator: string;
  precoBruto: number;
  preco: number; // tabela base
  precos: Record<string, number>;
  lucroPct: number; // campo "% Lucro" do UP Vendas
  fatorEfetivo: number;
  margemPct: number; // margem da loja após comissão da revendedora
  alertas: string[];
}

export function calcularPreco(
  custoTotal: number,
  tipo: string | null | undefined,
  pol: PoliticaPreco,
  opcoes: { fatorManual?: number | null; fatorPedido?: number | null; precoManual?: number | null } = {},
): ResultadoPreco {
  const alertas: string[] = [];
  const { fator, origem, piso } = escolherFator(custoTotal, tipo, pol, opcoes.fatorManual, opcoes.fatorPedido);
  if (pol.fator_minimo && fator < pol.fator_minimo && !(opcoes.precoManual && opcoes.precoManual > 0))
    alertas.push(`Fator ×${fator} abaixo do mínimo da loja (×${pol.fator_minimo}).`);
  const precoBruto = r2(Math.max(custoTotal * fator, piso));
  const preco =
    opcoes.precoManual && opcoes.precoManual > 0 ? r2(opcoes.precoManual) : arredondar(precoBruto, pol.arredondamento);

  const precos: Record<string, number> = {};
  for (const t of pol.tabelas_preco) {
    precos[t.id] =
      t.id === pol.tabela_base ? preco : arredondar(preco * t.multiplicador_sobre_tabela_base, pol.arredondamento, false);
  }

  const lucroPct = custoTotal > 0 ? r2((preco / custoTotal - 1) * 100) : 0;
  const liquido = preco * (1 - (pol.comissao_consignacao_pct ?? 0) / 100);
  const margemPct = liquido > 0 ? r2(((liquido - custoTotal) / liquido) * 100) : 0;

  if (custoTotal <= 0) alertas.push("Sem custo: confira preço de origem e cotação.");
  if (margemPct < pol.margem_minima_pct)
    alertas.push(`Margem de ${margemPct.toFixed(0)}% após comissão (mínimo ${pol.margem_minima_pct}%).`);
  for (const t of pol.tabelas_preco) {
    if (t.id !== pol.tabela_base && precos[t.id] <= custoTotal * 1.2)
      alertas.push(`Tabela ${t.nome}: preço muito próximo do custo.`);
  }

  return {
    fator,
    origemFator: origem,
    precoBruto,
    preco,
    precos,
    lucroPct,
    fatorEfetivo: custoTotal > 0 ? r2(preco / custoTotal) : 0,
    margemPct,
    alertas,
  };
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
