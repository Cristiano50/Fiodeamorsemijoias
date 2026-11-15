/**
 * Maleta inteligente: mix sugerido para a maleta de consignação de cada revendedora.
 *
 * 1. Divide as peças (e o valor de referência) entre os tipos na proporção das vendas (em R$) da revendedora.
 *    Com pouco histórico, mistura com as vendas gerais da loja; sem histórico, usa só as da loja;
 *    sem nenhuma venda importada, usa o valor em estoque de cada tipo.
 * 2. Dentro de cada tipo, escolhe pela pontuação: sell-through geral + afinidade com a faixa de preço
 *    que ela (ou a loja) mais vende + novidade (destaque ou chegada há menos de 30 dias).
 * 3. No máximo 1 peça por SKU (2 para as campeãs), só do disponível (estoque − o que está com as revendedoras),
 *    só peças que já chegaram e que o UP conhece, e nunca o que ela já tem na maleta ou devolveu.
 * 4. O valor informado é TETO (nunca passa dele). Sem valor = sem teto: a maleta fecha pelas peças-alvo,
 *    e o valor de referência por tipo é peças-alvo × preço médio das peças disponíveis.
 *
 * Funções puras (sem banco), testadas em tests/vendas.test.ts e tests/dados-maleta.test.ts.
 */
import { chaveNome, diasEntre, type SkuAnalise } from "./vendas-calculo";

export const FAIXAS_PRECO = [
  { ate: 60, nome: "até R$ 60" },
  { ate: 100, nome: "de R$ 60 a R$ 100" },
  { ate: 150, nome: "de R$ 100 a R$ 150" },
  { ate: 250, nome: "de R$ 150 a R$ 250" },
  { ate: Infinity, nome: "acima de R$ 250" },
] as const;

export const faixaDe = (preco: number) => FAIXAS_PRECO.findIndex((f) => preco <= f.ate);

/** Pesos da pontuação de cada peça (somam 1). */
export const PESOS_PONTUACAO = { giro: 0.5, faixa: 0.3, novidade: 0.2 };
export const DIAS_NOVIDADE = 30;
/** A partir dessas peças vendidas, o mix é 100% o da revendedora. */
export const PECAS_HISTORICO_CONFIAVEL = 20;
/** Tolerância acima do valor de referência de cada tipo (o total nunca passa do teto). */
const FOLGA_TIPO = 1.15;
export const SEM_TIPO = "outros";

export interface VendaMaleta {
  chave: string | null; // chave do SKU (vendas-calculo → chaveSku)
  revendedora: string | null;
  quantidade: number;
  valorTotal: number | null;
}

export interface PedidoMaleta {
  revendedora?: string | null;
  /** Teto do valor em etiqueta (R$). 0 ou vazio = sem teto. */
  valorAlvo: number;
  pecasAlvo: number;
  tiposExcluidos?: string[];
}

/** Consignado da revendedora escolhida (chaves de SKU): o que está com ela agora e o que ela já devolveu. */
export interface ConsignadoMaleta {
  comEla?: Iterable<string>;
  devolvidas?: Iterable<string>;
}

export interface ItemMaleta {
  chave: string;
  produtoId: string;
  referencia: string | null;
  codigoBarras: string | null;
  nome: string;
  tipo: string;
  imagemId: string | null;
  preco: number;
  custo: number;
  quantidade: number;
  /** Disponível para a maleta (estoque − com as revendedoras). */
  estoque: number;
  pontuacao: number;
  campea: boolean;
  novidade: boolean;
  motivo: string;
}

export interface TipoMaleta {
  tipo: string;
  peso: number;
  alvoValor: number;
  alvoPecas: number;
  valor: number;
  pecas: number;
}

export interface ResultadoMaleta {
  base: "revendedora" | "geral" | "estoque";
  revendedora: string | null;
  /** Teto em R$ (nulo = sem teto). */
  teto: number | null;
  /** Valor usado para dividir os tipos: o teto, ou peças-alvo × preço médio das disponíveis. */
  valorReferencia: number;
  /** Peças com estoque que ficaram de fora, por motivo. */
  fora: { semPreco: number; foraDoUp: number; comRevendedoras: number; jaComEla: number; devolvidas: number };
  historico: { pecas: number; receita: number };
  confianca: number; // parte do mix que vem da revendedora (0 a 1)
  distribuicao: TipoMaleta[];
  itens: ItemMaleta[];
  reservas: ItemMaleta[]; // alternativas para trocar/adicionar (as melhores de cada tipo que ficaram de fora)
  totais: { pecas: number; valor: number; custo: number };
  avisos: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const soma = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PLURAIS: Record<string, string> = { choker: "chokers", anel: "anéis", oculos: "óculos", óculos: "óculos" };

/** Plural simples do nome do tipo ("Brinco" → "brincos", "Colar" → "colares", "Anel" → "anéis"). */
export function plural(nome: string): string {
  const n = nome.toLowerCase().trim();
  if (PLURAIS[n]) return PLURAIS[n];
  if (/[\s/]/.test(n) || n.endsWith("s")) return n;
  if (n.endsWith("el")) return n.slice(0, -2) + "éis";
  if (/[rz]$/.test(n)) return n + "es";
  if (n.endsWith("m")) return n.slice(0, -1) + "ns";
  return n + "s";
}

/** Normaliza um mapa de pesos (só os tipos permitidos), para somar 1. */
function normalizar(m: Map<string, number>, permitidos: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of m) if (permitidos.has(k) && v > 0) out.set(k, v);
  const total = soma(out);
  if (!total) return new Map();
  for (const [k, v] of out) out.set(k, v / total);
  return out;
}

/** Pesos por tipo: α × revendedora + (1 − α) × loja, renormalizado. */
export function combinarPesos(dela: Map<string, number>, loja: Map<string, number>, alfa: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of new Set([...dela.keys(), ...loja.keys()])) {
    const v = alfa * (dela.get(k) ?? 0) + (1 - alfa) * (loja.get(k) ?? 0);
    if (v > 0) out.set(k, v);
  }
  const total = soma(out);
  if (total) for (const [k, v] of out) out.set(k, v / total);
  return out;
}

export function sugerirMaleta(
  skus: SkuAnalise[],
  vendas: VendaMaleta[],
  pedido: PedidoMaleta,
  opcoes: { hoje: string; nomesTipo?: Record<string, string>; consignado?: ConsignadoMaleta },
): ResultadoMaleta {
  const nomeTipo = (t: string) => opcoes.nomesTipo?.[t] ?? t;
  const tipoDe = (s: Pick<SkuAnalise, "tipo">) => s.tipo || SEM_TIPO;
  const excluidos = new Set(pedido.tiposExcluidos ?? []);
  const teto = Number(pedido.valorAlvo) > 0 ? Number(pedido.valorAlvo) : null;
  const pecasAlvo = Math.max(0, Math.floor(Number(pedido.pecasAlvo) || 0));
  const nomeRev = pedido.revendedora?.trim() || null;
  const chaveRev = nomeRev ? chaveNome(nomeRev) : "";
  const avisos: string[] = [];

  /* vendas com o SKU (só saídas: quantidade > 0) */
  const porChave = new Map(skus.map((s) => [s.chave, s]));
  type V = { sku: SkuAnalise; tipo: string; faixa: number; pecas: number; receita: number; dela: boolean };
  const vs: V[] = [];
  for (const v of vendas) {
    if (!v.chave || v.quantidade <= 0) continue;
    const sku = porChave.get(v.chave);
    if (!sku) continue;
    const unit = v.valorTotal && v.valorTotal > 0 ? v.valorTotal / v.quantidade : (sku.precoVenda ?? 0);
    vs.push({
      sku,
      tipo: tipoDe(sku),
      faixa: faixaDe(unit),
      pecas: v.quantidade,
      receita: v.valorTotal != null && v.valorTotal > 0 ? v.valorTotal : unit * v.quantidade,
      dela: !!chaveRev && chaveNome(v.revendedora) === chaveRev,
    });
  }
  const dela = vs.filter((v) => v.dela);
  const pecasDela = dela.reduce((s, v) => s + v.pecas, 0);
  const receitaDela = dela.reduce((s, v) => s + v.receita, 0);
  const base: ResultadoMaleta["base"] = pecasDela > 0 ? "revendedora" : vs.length ? "geral" : "estoque";
  const confianca = base === "revendedora" ? Math.min(1, pecasDela / PECAS_HISTORICO_CONFIAVEL) : 0;

  /*
   * candidatas: disponível ≥ 1 (estoque − com as revendedoras), com preço, tipo não excluído, conhecida pelo UP,
   * e nada que ela já tem agora ou que já devolveu. (Peças de pedidos a caminho não têm estoque: nem entram aqui.)
   */
  const comEla = new Set(opcoes.consignado?.comEla ?? []);
  const devolveu = new Set(opcoes.consignado?.devolvidas ?? []);
  const fora: ResultadoMaleta["fora"] = { semPreco: 0, foraDoUp: 0, comRevendedoras: 0, jaComEla: 0, devolvidas: 0 };
  const candidatas: SkuAnalise[] = [];
  for (const s of skus) {
    if (s.estoque < 1) continue;
    if (s.disponivel < 1) {
      fora.comRevendedoras++;
      continue;
    }
    if (!(s.precoVenda && s.precoVenda > 0)) {
      fora.semPreco++;
      continue;
    }
    if (excluidos.has(tipoDe(s))) continue;
    if (!s.noUp) fora.foraDoUp++;
    else if (comEla.has(s.chave)) fora.jaComEla++;
    else if (devolveu.has(s.chave)) fora.devolvidas++;
    else candidatas.push(s);
  }
  const tiposDisponiveis = new Set(candidatas.map(tipoDe));
  // Sem teto, o valor de referência de cada tipo sai do preço médio das peças disponíveis.
  const precoMedio = candidatas.length ? candidatas.reduce((t, s) => t + (s.precoVenda ?? 0), 0) / candidatas.length : 0;
  const valorAlvo = teto ?? pecasAlvo * precoMedio;

  /* pesos por tipo */
  const somarPor = <T>(lista: T[], tipo: (x: T) => string, valor: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of lista) m.set(tipo(x), (m.get(tipo(x)) ?? 0) + valor(x));
    return m;
  };
  const pesoLoja = normalizar(somarPor(vs, (v) => v.tipo, (v) => v.receita), tiposDisponiveis);
  const pesoDela = normalizar(somarPor(dela, (v) => v.tipo, (v) => v.receita), tiposDisponiveis);
  const pesoEstoque = normalizar(somarPor(candidatas, tipoDe, (s) => s.estoque * (s.precoVenda ?? 0)), tiposDisponiveis);
  let pesos = base === "estoque" ? pesoEstoque : combinarPesos(pesoDela, pesoLoja, confianca);
  if (!soma(pesos)) pesos = pesoEstoque; // vendas só em tipos excluídos ou sem estoque

  /* faixa de preço preferida por tipo (da revendedora, senão da loja) */
  const faixasPor = (lista: V[]) => {
    const m = new Map<string, number[]>();
    for (const v of lista) {
      const arr = m.get(v.tipo) ?? FAIXAS_PRECO.map(() => 0);
      arr[v.faixa] += v.pecas;
      m.set(v.tipo, arr);
    }
    return m;
  };
  const faixasDela = faixasPor(dela);
  const faixasLoja = faixasPor(vs);
  const fonteFaixa = (tipo: string) => {
    const d = faixasDela.get(tipo);
    if (d && d.reduce((s, x) => s + x, 0) > 0) return { arr: d, daRevendedora: true };
    const l = faixasLoja.get(tipo);
    return l ? { arr: l, daRevendedora: false } : null;
  };
  const afinidade = (tipo: string, faixa: number) => {
    const f = fonteFaixa(tipo);
    const total = f ? f.arr.reduce((s, x) => s + x, 0) : 0;
    return f && total ? f.arr[faixa] / total : 0;
  };
  const faixaCampea = (tipo: string) => {
    const f = fonteFaixa(tipo);
    if (!f) return null;
    const max = Math.max(...f.arr);
    if (max < 2) return null;
    return { indice: f.arr.indexOf(max), daRevendedora: f.daRevendedora };
  };

  /* campeãs: as mais vendidas da loja e as que ela mais vende */
  const comVenda = skus.filter((s) => s.vendido >= 2).sort((a, b) => b.vendido - a.vendido);
  const maisVendidasLoja = new Set(comVenda.slice(0, Math.max(5, Math.ceil(comVenda.length * 0.05))).map((s) => s.chave));
  const pecasPorSkuDela = new Map<string, number>();
  for (const v of dela) pecasPorSkuDela.set(v.sku.chave, (pecasPorSkuDela.get(v.sku.chave) ?? 0) + v.pecas);
  const topDela = new Set(
    [...pecasPorSkuDela.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k),
  );
  const ehNovidade = (s: SkuAnalise) => s.destaque || diasEntre(s.dataEntrada, opcoes.hoje) < DIAS_NOVIDADE;

  type Cand = { sku: SkuAnalise; tipo: string; preco: number; pontuacao: number; campea: boolean; novidade: boolean };
  const cands: Cand[] = candidatas
    .map((s) => {
      const tipo = tipoDe(s);
      const preco = s.precoVenda!;
      const novidade = ehNovidade(s);
      const pontuacao =
        PESOS_PONTUACAO.giro * Math.min(1, Math.max(0, s.sellThrough)) + PESOS_PONTUACAO.faixa * afinidade(tipo, faixaDe(preco)) + PESOS_PONTUACAO.novidade * (novidade ? 1 : 0);
      const campea = (maisVendidasLoja.has(s.chave) || topDela.has(s.chave) || (s.curva === "A" && s.vendido >= 2)) && s.vendido > 0;
      return { sku: s, tipo, preco, pontuacao: Math.round(pontuacao * 1000) / 1000, campea, novidade };
    })
    .sort(
      (a, b) =>
        b.pontuacao - a.pontuacao ||
        Number(b.sku.destaque) - Number(a.sku.destaque) ||
        b.sku.dataEntrada.localeCompare(a.sku.dataEntrada) ||
        b.sku.disponivel - a.sku.disponivel ||
        a.sku.chave.localeCompare(b.sku.chave),
    );

  const motivo = (c: Cand, completar: boolean) => {
    const partes: string[] = [];
    const tipoPlural = plural(nomeTipo(c.tipo));
    const f = faixaDe(c.preco);
    const fc = faixaCampea(c.tipo);
    if (fc && fc.indice === f) {
      partes.push(fc.daRevendedora && base === "revendedora" ? `campeã da revendedora em ${tipoPlural} ${FAIXAS_PRECO[f].nome}` : `faixa que mais vende em ${tipoPlural} (${FAIXAS_PRECO[f].nome})`);
    }
    if (topDela.has(c.sku.chave)) partes.push("uma das que ela mais vende");
    if (maisVendidasLoja.has(c.sku.chave)) partes.push("mais vendida da loja");
    else if (c.sku.sellThrough >= 0.5 && c.sku.vendido >= 2) partes.push(`giro de ${Math.round(c.sku.sellThrough * 100)}%`);
    if (c.novidade) partes.push(c.sku.destaque && diasEntre(c.sku.dataEntrada, opcoes.hoje) >= DIAS_NOVIDADE ? "destaque" : "novidade");
    if (!partes.length) partes.push(completar ? "para completar a maleta" : base === "estoque" ? "disponível no estoque" : `boa opção em ${tipoPlural}`);
    return partes.join(" · ");
  };

  const paraItem = (c: Cand, quantidade: number, completar: boolean): ItemMaleta => ({
    chave: c.sku.chave,
    produtoId: c.sku.produtoId,
    referencia: c.sku.referencia,
    codigoBarras: c.sku.codigoBarras,
    nome: c.sku.nome,
    tipo: c.tipo,
    imagemId: c.sku.imagemId,
    preco: r2(c.preco),
    custo: r2(c.sku.custo ?? 0),
    quantidade,
    estoque: c.sku.disponivel,
    pontuacao: c.pontuacao,
    campea: c.campea,
    novidade: c.novidade,
    motivo: motivo(c, completar),
  });

  /* seleção */
  const distribuicao: TipoMaleta[] = [...pesos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, peso]) => ({ tipo, peso: Math.round(peso * 10000) / 10000, alvoValor: r2(valorAlvo * peso), alvoPecas: Math.round(pecasAlvo * peso * 10) / 10, valor: 0, pecas: 0 }));
  const porTipo = new Map<string, Cand[]>();
  for (const c of cands) porTipo.set(c.tipo, [...(porTipo.get(c.tipo) ?? []), c]);

  const escolhidos = new Map<string, ItemMaleta>();
  let totPecas = 0;
  let totValor = 0;
  // O teto nunca é ultrapassado (é teto, não meta). Sem teto, só as peças-alvo limitam.
  const cabe = (preco: number, q: number) => totPecas + q <= pecasAlvo && (teto == null || totValor + preco * q <= teto + 1e-9);
  const adicionar = (c: Cand, q: number, d: TipoMaleta, completar: boolean) => {
    escolhidos.set(c.sku.chave, paraItem(c, q, completar));
    totPecas += q;
    totValor += c.preco * q;
    d.pecas += q;
    d.valor = r2(d.valor + c.preco * q);
  };

  for (const d of distribuicao) {
    const alvoValorTipo = valorAlvo * d.peso;
    const alvoPecasTipo = pecasAlvo * d.peso;
    for (const c of porTipo.get(d.tipo) ?? []) {
      if (d.pecas >= alvoPecasTipo || d.valor >= alvoValorTipo || totPecas >= pecasAlvo) break;
      if (d.valor > 0 && d.valor + c.preco > alvoValorTipo * FOLGA_TIPO) continue; // cara demais para o que falta no tipo
      let q = c.campea && c.sku.disponivel >= 2 ? 2 : 1;
      if (q === 2 && (d.pecas + 2 > Math.ceil(alvoPecasTipo) || d.valor + 2 * c.preco > alvoValorTipo * FOLGA_TIPO)) q = 1;
      if (!cabe(c.preco, q)) {
        if (q === 2 && cabe(c.preco, 1)) q = 1;
        else continue;
      }
      adicionar(c, q, d, false);
    }
  }

  // Completa com as melhores restantes (primeiro dos tipos com peso) se faltou estoque em algum tipo, sem passar do teto.
  if (totPecas < pecasAlvo && (teto == null || totValor < teto)) {
    const resto = cands.filter((c) => !escolhidos.has(c.sku.chave)).sort((a, b) => Number(pesos.has(b.tipo)) - Number(pesos.has(a.tipo)));
    for (const c of resto) {
      if (totPecas >= pecasAlvo || (teto != null && totValor >= teto)) break;
      if (!cabe(c.preco, 1)) continue;
      let d = distribuicao.find((x) => x.tipo === c.tipo);
      if (!d) {
        d = { tipo: c.tipo, peso: 0, alvoValor: 0, alvoPecas: 0, valor: 0, pecas: 0 };
        distribuicao.push(d);
      }
      adicionar(c, 1, d, true);
    }
  }

  const ordemTipo = new Map(distribuicao.map((d, i) => [d.tipo, i]));
  const itens = [...escolhidos.values()].sort((a, b) => (ordemTipo.get(a.tipo) ?? 99) - (ordemTipo.get(b.tipo) ?? 99) || b.pontuacao - a.pontuacao);
  const reservas: ItemMaleta[] = [];
  for (const [, lista] of porTipo) reservas.push(...lista.filter((c) => !escolhidos.has(c.sku.chave)).slice(0, 12).map((c) => paraItem(c, 1, false)));

  const totais = {
    pecas: itens.reduce((s, i) => s + i.quantidade, 0),
    valor: r2(itens.reduce((s, i) => s + i.preco * i.quantidade, 0)),
    custo: r2(itens.reduce((s, i) => s + i.custo * i.quantidade, 0)),
  };

  if (base === "estoque") avisos.push("Ainda não há vendas importadas: a sugestão usa os destaques e as novidades do estoque. Importe as vendas do UP em “Vendas e recompra” para a maleta aprender o que sai.");
  else if (nomeRev && base === "geral") avisos.push(`Sem histórico de vendas para “${nomeRev}”: usei o mix de vendas da loja.`);
  else if (base === "revendedora" && confianca < 1)
    avisos.push(`${nomeRev} tem pouco histórico (${r2(pecasDela)} peças): o mix usa ${Math.round(confianca * 100)}% das vendas dela e o resto das vendas da loja.`);
  if (!candidatas.length) avisos.push("Não há peças disponíveis (que já chegaram, cadastradas no UP, com preço e fora das maletas) para montar a maleta.");
  else if (totais.pecas < pecasAlvo && teto != null && totais.valor >= teto * 0.9) {
    // O teto foi atingido antes da quantidade: as peças escolhidas são caras para esse teto.
    const medio = totais.pecas ? totais.valor / totais.pecas : precoMedio;
    avisos.push(
      `O teto de ${brl(teto)} coube ${totais.pecas} peças (preço médio ${brl(medio)}), abaixo das ${pecasAlvo} pedidas. ` +
        `Para ${pecasAlvo} peças nesse preço médio seriam cerca de ${brl(medio * pecasAlvo)}: aumente o teto, deixe o campo em branco (sem teto) ou desmarque os tipos mais caros.`,
    );
  } else if (totais.pecas < pecasAlvo)
    avisos.push(`A maleta ficou com ${totais.pecas} peça(s) de ${pecasAlvo} pedidas: não há mais modelos disponíveis (vai no máximo 1 de cada modelo, 2 das campeãs).`);
  if (fora.semPreco) avisos.push(`${fora.semPreco} peça(s) com estoque e sem preço de venda ficaram de fora.`);
  if (fora.foraDoUp) avisos.push(`${fora.foraDoUp} peça(s) ainda sem cadastro no UP ficaram de fora (cadastre no UP e traga o código em UP Vendas → Códigos de barras do UP).`);
  if (fora.jaComEla) avisos.push(`${fora.jaComEla} peça(s) que já estão com ${nomeRev ?? "a revendedora"} ficaram de fora.`);
  if (fora.devolvidas) avisos.push(`${fora.devolvidas} peça(s) que ${nomeRev ?? "a revendedora"} já devolveu ficaram de fora.`);

  return {
    base,
    revendedora: nomeRev,
    teto,
    valorReferencia: r2(valorAlvo),
    fora,
    historico: { pecas: r2(pecasDela), receita: r2(receitaDela) },
    confianca: Math.round(confianca * 100) / 100,
    distribuicao: distribuicao.filter((d) => d.peso > 0 || d.pecas > 0),
    itens,
    reservas,
    totais,
    avisos,
  };
}
