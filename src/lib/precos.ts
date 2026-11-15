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

/** Degrau da escada de preços: até `ate` (null = sem limite), preços de `passo` em `passo` reais. */
export interface DegrauEscada {
  ate: number | null;
  passo: number;
}

/**
 * Arredondamento do preço de venda.
 *  - "escada" (política da loja): preço possível mais próximo de custo × fator — 19,99 (mínimo); de 5 em 5 até 49,99;
 *    de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100 em 100 acima (sempre ,99); empate fica com o maior.
 *  - "terminar_em": sobe até terminar nos centavos (ex.: ,99). "inteiro": sobe para o real inteiro.
 */
export interface RegraArredondamento {
  modo: string;
  centavos: number;
  minimo?: number;
  direcao?: string;
  degraus?: DegrauEscada[];
  formula?: string;
}

export interface PoliticaPreco {
  fator_padrao: number;
  fator_minimo?: number;
  fatores_por_tipo: Record<string, number>;
  usar_faixas: boolean;
  faixas_modo?: string;
  faixas_custo: FaixaCusto[];
  arredondamento: RegraArredondamento;
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

/** Cenário de custo de um pedido novo (ou ao trocar a moeda): compra em real = importador nacional; senão o padrão da loja. */
export function cenarioPadraoPara(moeda: string | null | undefined, cenarios: Record<string, unknown>, padrao: string): string {
  return String(moeda ?? "").toUpperCase() === "BRL" && cenarios.compra_importador_nacional ? "compra_importador_nacional" : padrao;
}

/**
 * Valores iniciais dos componentes de custo de um pedido novo: o frete digitado e os padrões da loja
 * (Configurações → perdas e defeitos %, embalagem e etiqueta R$/peça). Só entra o que for maior que zero:
 * com os padrões em 0, o pedido segue exatamente o cenário escolhido.
 */
export function custosIniciais(o: { frete?: number | null; perdasPct?: number | null; embalagemPorPeca?: number | null }): Record<string, number> | null {
  const c: Record<string, number> = {};
  if (o.frete != null && o.frete > 0) c.frete_internacional = o.frete;
  if (o.perdasPct != null && o.perdasPct > 0) c.perdas_defeitos = o.perdasPct;
  if (o.embalagemPorPeca != null && o.embalagemPorPeca > 0) c.embalagem_etiqueta = o.embalagemPorPeca;
  return Object.keys(c).length ? c : null;
}

/* ------------------------------------------------------------------ preço */

/** Arredondamento antigo (até 15/11/2026): sobe até terminar em ,99, mínimo 19,99. */
export const ARREDONDAMENTO_ANTIGO: RegraArredondamento = {
  modo: "terminar_em",
  centavos: 0.99,
  direcao: "cima",
  formula: "ceil(preco_bruto - centavos) + centavos",
  minimo: 19.99,
};

/** A regra salva em Configurações é exatamente a antiga (ninguém personalizou)? Então passa para a escada nova. */
export function ehArredondamentoAntigo(a: unknown): boolean {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const o = a as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(k in ARREDONDAMENTO_ANTIGO))) return false;
  return (
    o.modo === "terminar_em" &&
    Number(o.centavos) === 0.99 &&
    Number(o.minimo) === 19.99 &&
    (o.direcao === undefined || o.direcao === "cima") &&
    (o.formula === undefined || o.formula === ARREDONDAMENTO_ANTIGO.formula)
  );
}

/**
 * Preço possível da escada mais próximo de `valor` (empate fica com o maior), sem o mínimo.
 * Pontos de cada degrau: k × passo − 0,01 (com centavos 0,99), acima do "ate" do degrau anterior e até o "ate" deste.
 * Contas em centavos inteiros, para o empate ser exato.
 */
export function precoNaEscada(valor: number, degraus: DegrauEscada[], centavos = 0.99): number {
  const alvo = Math.round(valor * 100);
  const cent = Number.isFinite(centavos) && centavos >= 0 && centavos < 1 ? Math.round(centavos * 100) : 99;
  const recuo = 100 - cent; // ponto = k × passo − recuo (centavos)
  let melhor: number | null = null;
  const considerar = (p: number) => {
    if (melhor === null) {
      melhor = p;
      return;
    }
    const d = Math.abs(p - alvo);
    const dm = Math.abs(melhor - alvo);
    if (d < dm || (d === dm && p > melhor)) melhor = p;
  };
  let inicio = 0;
  for (const g of degraus) {
    const passo = Math.round(Number(g.passo) * 100);
    const fim = g.ate == null ? Infinity : Math.round(Number(g.ate) * 100);
    if (passo > 0 && fim > inicio) {
      const kMin = Math.floor((inicio + recuo) / passo) + 1; // primeiro ponto acima do degrau anterior
      const kMax = fim === Infinity ? Infinity : Math.floor((fim + recuo) / passo); // último ponto até o "ate"
      const k = (alvo + recuo) / passo;
      for (const kk of [Math.floor(k), Math.ceil(k), kMin, kMax])
        if (Number.isFinite(kk) && kk >= kMin && kk <= kMax) considerar(kk * passo - recuo);
    }
    if (fim === Infinity) break;
    inicio = Math.max(inicio, fim);
  }
  return melhor === null ? valor : melhor / 100;
}

export function arredondar(valor: number, regra: RegraArredondamento, aplicarMinimo = true): number {
  const bruto = r2(valor);
  let v = bruto;
  const escada = regra.modo === "escada" && !!regra.degraus?.length;
  if (escada) {
    v = precoNaEscada(bruto, regra.degraus!, regra.centavos);
  } else if (regra.modo === "terminar_em") {
    const c = r2(regra.centavos);
    v = r2(Math.ceil(r2(v - c)) + c);
  } else if (regra.modo === "inteiro") {
    v = Math.ceil(v);
  }
  // Mínimo da loja (só na tabela base): nunca abaixo dele; na escada, bruto até o mínimo = mínimo.
  if (aplicarMinimo && regra.minimo && (v < regra.minimo || (escada && bruto <= regra.minimo))) v = regra.minimo;
  return r2(v);
}

/** O fator escolhido (antes do arredondamento) está abaixo do mínimo da loja? Arredondar para baixo na escada não conta. */
export function fatorAbaixoDoMinimo(fator: number | null | undefined, pol: Pick<PoliticaPreco, "fator_minimo">): boolean {
  const minimo = Number(pol.fator_minimo ?? 0);
  return fator != null && fator > 0 && minimo > 0 && fator < minimo - 1e-9;
}

/**
 * Preço manual abaixo do fator mínimo? Fator efetivo = preço ÷ custo. Para a escada não gerar alerta falso,
 * compara com o preço que o próprio fator mínimo daria (custo × mínimo, arredondado na escada, sem o preço mínimo).
 * Sem custo (0/desconhecido) não dá para saber: o recálculo confere quando o custo chegar.
 */
export function precoManualAbaixoDoMinimo(
  preco: number | null | undefined,
  custo: number | null | undefined,
  pol: Pick<PoliticaPreco, "fator_minimo" | "arredondamento">,
): { abaixo: boolean; fatorEfetivo: number | null; precoMinimo: number | null } {
  const minimo = Number(pol.fator_minimo ?? 0);
  if (!(preco != null && preco > 0) || !(custo != null && custo > 0)) return { abaixo: false, fatorEfetivo: null, precoMinimo: null };
  const fatorEfetivo = r2(preco / custo);
  if (!(minimo > 0)) return { abaixo: false, fatorEfetivo, precoMinimo: null };
  const precoMinimo = arredondar(custo * minimo, pol.arredondamento, false);
  return { abaixo: preco < precoMinimo - 0.004, fatorEfetivo, precoMinimo };
}

/** Diferença acima da qual a recompra avisa "Custo mudou" (preço calculado × preço vigente do original). */
export const LIMITE_CUSTO_MUDOU_PCT = 10;

/** Alertas de preço refeitos a cada recálculo (os demais alertas da peça ficam). */
export const PREFIXOS_ALERTA_PRECO = ["Margem", "Tabela", "Sem custo", "Fator ×", "Preço manual abaixo", "Custo mudou", "Sem cotação"];
export const semAlertasDePreco = (alertas: string[] | null | undefined) => (alertas ?? []).filter((a) => !PREFIXOS_ALERTA_PRECO.some((p) => a.startsWith(p)));

const fmtNum = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

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
  precoCalculado: number; // pelo custo desta peça (na recompra, o preço usado é o vigente do original)
  custoMudouPct: number | null; // recompra: calculado × vigente, em %
  precos: Record<string, number>;
  lucroPct: number; // campo "% Lucro" do UP Vendas
  fatorEfetivo: number;
  margemPct: number; // margem da loja após comissão da revendedora
  alertas: string[];
}

/** Preços das tabelas (base e secundárias) a partir do preço da tabela base. */
export function precosDasTabelas(preco: number, pol: PoliticaPreco): Record<string, number> {
  const precos: Record<string, number> = {};
  for (const t of pol.tabelas_preco) {
    precos[t.id] = t.id === pol.tabela_base ? preco : arredondar(preco * t.multiplicador_sobre_tabela_base, pol.arredondamento, false);
  }
  return precos;
}

/**
 * Preço de venda. Prioridade: preço manual → fator da peça → fator do pedido → faixas → tipo → padrão.
 * `precoVigente` (recompra): o preço continua o do original (mesma referência/EAN = um preço só no UP);
 * o preço pelo custo novo é calculado mesmo assim e, se diferir mais de 10%, a peça recebe o alerta "Custo mudou".
 */
export function calcularPreco(
  custoTotal: number,
  tipo: string | null | undefined,
  pol: PoliticaPreco,
  opcoes: { fatorManual?: number | null; fatorPedido?: number | null; precoManual?: number | null; precoVigente?: number | null } = {},
): ResultadoPreco {
  const alertas: string[] = [];
  const { fator, origem, piso } = escolherFator(custoTotal, tipo, pol, opcoes.fatorManual, opcoes.fatorPedido);
  const manual = opcoes.precoManual && opcoes.precoManual > 0 ? r2(opcoes.precoManual) : null;
  const vigente = opcoes.precoVigente && opcoes.precoVigente > 0 ? r2(opcoes.precoVigente) : null;
  const precoBruto = r2(Math.max(custoTotal * fator, piso));
  const precoCalculado = manual ?? arredondar(precoBruto, pol.arredondamento);
  const preco = vigente ?? precoCalculado;
  if (vigente == null) {
    // O fator escolhido é comparado antes do arredondamento (arredondar para baixo na escada não gera alerta).
    if (manual == null && fatorAbaixoDoMinimo(fator, pol)) alertas.push(`Fator ×${fator} abaixo do mínimo da loja (×${pol.fator_minimo}).`);
    if (manual != null) {
      const m = precoManualAbaixoDoMinimo(manual, custoTotal, pol);
      if (m.abaixo) alertas.push(`Preço manual abaixo do fator mínimo (×${fmtNum(Number(pol.fator_minimo))}): fator efetivo ×${fmtNum(m.fatorEfetivo!)}.`);
    }
  }
  const custoMudouPct = vigente != null && custoTotal > 0 ? r2(((precoCalculado - vigente) / vigente) * 100) : null;
  if (custoMudouPct != null && Math.abs(custoMudouPct) > LIMITE_CUSTO_MUDOU_PCT)
    alertas.push(`Custo mudou: preço vigente ${brl(vigente)}, pelo custo novo ${brl(precoCalculado)} (${custoMudouPct > 0 ? "+" : ""}${fmtNum(custoMudouPct)}%).`);

  const precos = precosDasTabelas(preco, pol);

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
    precoCalculado,
    custoMudouPct,
    precos,
    lucroPct,
    fatorEfetivo: custoTotal > 0 ? r2(preco / custoTotal) : 0,
    margemPct,
    alertas,
  };
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
