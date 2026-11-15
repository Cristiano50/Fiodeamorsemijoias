/**
 * Consignado (maletas) exportado do UP Vendas: leitura flexível da planilha, situação de cada peça
 * (com a revendedora, devolvida, vendida, avariada, perdida) e resumos para a maleta.
 *
 * Cada importação fica guardada no seu lote. Para a mesma revendedora, data e peça, vale o lote mais novo
 * (a situação muda de um relatório para o outro); desfazer um lote faz voltar o anterior.
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/dados-consignado.test.ts.
 */
import {
  chaveNome,
  lerData,
  lerNumero,
  limparCodigo,
  linhaVazia,
  normalizarTexto,
  pontuarCabecalho,
  sugerirMapeamentoPor,
  textoCelula,
  type LinhaIgnorada,
  type RegraCabecalho,
} from "./vendas-calculo";

export const SITUACOES = ["com_revendedora", "devolvida", "vendida", "avariada", "perdida"] as const;
export type Situacao = (typeof SITUACOES)[number];

export const NOME_SITUACAO: Record<Situacao, string> = {
  com_revendedora: "com a revendedora",
  devolvida: "devolvida",
  vendida: "vendida",
  avariada: "avariada",
  perdida: "perdida",
};

/* ----------------------------------------------------------- campos */

export const CAMPOS_CONSIGNADO = [
  { id: "data", nome: "Data (envio da maleta)" },
  { id: "revendedora", nome: "Revendedora" },
  { id: "codigoBarras", nome: "Código de barras (EAN)" },
  { id: "referencia", nome: "Referência" },
  { id: "descricao", nome: "Descrição do produto" },
  { id: "quantidade", nome: "Quantidade" },
  { id: "situacao", nome: "Situação" },
  { id: "qtdComRevendedora", nome: "Qtd. com a revendedora (em aberto)" },
  { id: "qtdDevolvida", nome: "Qtd. devolvida" },
  { id: "qtdVendida", nome: "Qtd. vendida" },
  { id: "qtdAvariada", nome: "Qtd. avariada" },
  { id: "qtdPerdida", nome: "Qtd. perdida" },
] as const;

export type CampoConsignado = (typeof CAMPOS_CONSIGNADO)[number]["id"];
export type MapeamentoConsignado = Partial<Record<CampoConsignado, number>>;

/** Colunas de quantidade por situação (planilha com uma coluna para cada situação). */
const QTD_POR_SITUACAO: [CampoConsignado, Situacao][] = [
  ["qtdComRevendedora", "com_revendedora"],
  ["qtdDevolvida", "devolvida"],
  ["qtdVendida", "vendida"],
  ["qtdAvariada", "avariada"],
  ["qtdPerdida", "perdida"],
];

// Coluna de data, valor ou preço nunca é quantidade ("Data da devolução", "Valor vendido").
const NAO_E_QUANTIDADE = /\b(data|dt|valor|vlr|vl|preco|r)\b/;

const REGRAS: RegraCabecalho<CampoConsignado>[] = [
  {
    campo: "codigoBarras",
    testes: [
      [/\b(cod|codigo|cd)\s*(de\s*)?barras?\b/, 10],
      [/\bean\b|\bean13\b|\bgtin\b|\bbarcode\b/, 10],
      [/\bbarras?\b/, 6],
    ],
  },
  {
    campo: "referencia",
    testes: [
      [/^(ref|referencia)$/, 10],
      [/\bref\b|\breferencia\b/, 8],
      [/\bsku\b/, 7],
      [/\bcod(igo)?\s*(do\s*)?produto\b/, 6],
      [/^(cod|codigo)$/, 4],
    ],
  },
  {
    campo: "data",
    testes: [
      [/^(data|dt)$/, 10],
      [/\b(data|dt)\s*(de\s*)?(envio|saida|entrega|emissao|abertura)\b/, 11],
      [/\bdata\b|\bdt\b/, 7],
      [/\bemissao\b|^dia$/, 6],
    ],
    exceto: /\b(devolu|retorno|acerto|fechamento|venda)/,
  },
  {
    campo: "revendedora",
    testes: [
      [/\brevendedor(a|es|as)?\b/, 10],
      [/\bvendedor(a)?\b|\bconsultor(a)?\b|\brepresentante\b/, 9],
      [/\bcliente\b|\bmaleta\b/, 4],
    ],
  },
  {
    campo: "descricao",
    testes: [
      [/\bdescri/, 9],
      [/^(produto|nome|item)$/, 8],
      [/\bproduto\b|\bnome\b|\bitem\b/, 5],
    ],
  },
  {
    campo: "situacao",
    testes: [
      [/\bsituacao\b|\bstatus\b/, 10],
      [/\bestado\b|\bposicao\b/, 6],
    ],
  },
  {
    campo: "quantidade",
    testes: [
      [/\b(qtd|qtde|quantidade)\s*(enviada|consignada|total|saida|na maleta)\b/, 11],
      [/^(qtd|qtde|quant|quantidade|qt|pecas)$/, 10],
      [/\bqtd|\bqtde\b|\bquantidade\b|\bquant\b/, 6],
    ],
    exceto: /\b(data|dt|valor|vlr|preco|devolv|vendid|avari|perdid|aberto|pendente|retorn)/,
  },
  { campo: "qtdComRevendedora", testes: [[/\b(em\s*aberto|aberto|pendente|em\s*posse|com\s*(a\s*)?revendedora|a\s*acertar|saldo)\b/, 9]], exceto: NAO_E_QUANTIDADE },
  { campo: "qtdDevolvida", testes: [[/\bdevolv|\bretornad|\bdevolucao/, 9]], exceto: NAO_E_QUANTIDADE },
  { campo: "qtdVendida", testes: [[/\bvendid/, 9]], exceto: NAO_E_QUANTIDADE },
  { campo: "qtdAvariada", testes: [[/\bavari|\bdefeit|\bdanific|\bquebrad/, 9]], exceto: NAO_E_QUANTIDADE },
  { campo: "qtdPerdida", testes: [[/\bperdid|\bperda|\bextravi/, 9]], exceto: NAO_E_QUANTIDADE },
];

/** Maior pontuação de um nome de coluna entre os campos do consignado (para achar a linha do cabeçalho). */
export const pontuarColunaConsignado = (cabecalho: string) => Math.max(0, ...pontuarCabecalho(REGRAS, cabecalho).map((p) => p.pontos));

/** Sugere o mapeamento pelos nomes das colunas (sem acento e sem maiúsculas). */
export function sugerirMapeamentoConsignado(cabecalhos: string[]): MapeamentoConsignado {
  return sugerirMapeamentoPor(REGRAS, cabecalhos);
}

/** Colunas de quantidade por situação que estão mapeadas. */
export function colunasPorSituacao(mapa: MapeamentoConsignado): [CampoConsignado, Situacao][] {
  return QTD_POR_SITUACAO.filter(([c]) => mapa[c] != null && mapa[c]! >= 0);
}

/* ----------------------------------------------------------- situação */

/** Situação escrita do jeito do UP ("Em aberto", "Devolvido", "Vendida", "Avaria", "Perda"…). Desconhecida = null. */
export function lerSituacao(v: unknown): Situacao | null {
  const t = normalizarTexto(textoCelula(v));
  if (!t) return null;
  if (/\bnao\s*vend/.test(t)) return "devolvida"; // não vendida no acerto = voltou para a loja
  if (/\b(devolv|devolucao|retorn|voltou)/.test(t)) return "devolvida";
  if (/\b(avari|defeit|danific|quebrad|estragad)/.test(t)) return "avariada";
  if (/\b(perdid|perda|extravi|sumiu|faltante)/.test(t)) return "perdida";
  if (/\b(vendid|venda|vendeu|faturad)/.test(t)) return "vendida";
  if (/\b(abert[oa]|pendente|consignad\w*|com a revendedora|com revendedora|em posse|posse|maleta|enviad\w*|saida|em maos|ativ[oa])\b/.test(t)) return "com_revendedora";
  return null;
}

/* ----------------------------------------------------------- linhas */

export interface LinhaConsignado {
  linha: number; // número da linha na planilha (1 = primeira linha do arquivo)
  data: string | null;
  revendedora: string;
  codigoBarras: string | null;
  referencia: string | null;
  descricao: string | null;
  quantidade: number;
  situacao: Situacao;
}

const textoOuNulo = (v: unknown) => textoCelula(v) || null;

/**
 * Converte as linhas (após o cabeçalho) pelo mapeamento escolhido.
 *  - Revendedora vazia repete a de cima (relatórios agrupados por revendedora); sem coluna, usa `revendedoraPadrao`.
 *  - Com colunas de quantidade por situação, cada uma vira uma linha (a coluna Situação é ignorada); se houver
 *    "Quantidade" (enviada) e não houver "em aberto", o que sobra da enviada conta como "com a revendedora".
 *  - Senão, quantidade + situação (sem coluna de situação, tudo conta como "com a revendedora").
 */
export function converterLinhasConsignado(
  linhas: unknown[][],
  mapa: MapeamentoConsignado,
  opcoes: { primeiraLinha?: number; revendedoraPadrao?: string | null; dataPadrao?: string | null } = {},
): { itens: LinhaConsignado[]; ignoradas: LinhaIgnorada[] } {
  const primeira = opcoes.primeiraLinha ?? 2;
  const revPadrao = opcoes.revendedoraPadrao?.replace(/\s+/g, " ").trim() || null;
  const dataPadrao = opcoes.dataPadrao ? lerData(opcoes.dataPadrao) : null;
  const tem = (c: CampoConsignado) => mapa[c] != null && mapa[c]! >= 0;
  const porSituacao = colunasPorSituacao(mapa);
  const itens: LinhaConsignado[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  let ultimaRevendedora: string | null = null;

  linhas.forEach((l, i) => {
    const linha = primeira + i;
    if (linhaVazia(l)) return;
    const cel = (c: CampoConsignado) => (tem(c) ? l[mapa[c]!] : undefined);
    const ignorar = (motivo: string) => ignoradas.push({ linha, motivo });

    let revendedora = tem("revendedora") ? textoCelula(cel("revendedora")).replace(/\s+/g, " ").trim() || null : null;
    const referencia = textoOuNulo(cel("referencia"));
    const codigoBarras = limparCodigo(cel("codigoBarras"));
    if (!referencia && !codigoBarras) {
      const texto = normalizarTexto(l.map((c) => textoCelula(c)).join(" "));
      if (/\b(sub)?total/.test(texto)) return ignorar("linha de total");
      // Linha só com o nome (e a data): cabeçalho do grupo da revendedora nos relatórios agrupados.
      const soONome = !!revendedora && (Object.keys(mapa) as CampoConsignado[]).every((c) => c === "revendedora" || c === "data" || c === "descricao" || !textoCelula(cel(c)));
      if (soONome) {
        ultimaRevendedora = revendedora;
        return;
      }
      return ignorar("sem referência nem código de barras");
    }
    if (revendedora) ultimaRevendedora = revendedora;
    else revendedora = tem("revendedora") ? ultimaRevendedora : revPadrao;
    if (!revendedora) return ignorar("sem revendedora");

    let data: string | null = null;
    if (tem("data")) {
      const bruto = textoCelula(cel("data"));
      data = lerData(cel("data"));
      if (!data && bruto && !dataPadrao) return ignorar(`data inválida ("${bruto}")`);
    }
    data ??= dataPadrao;

    const comum = { linha, data, revendedora, codigoBarras, referencia, descricao: textoOuNulo(cel("descricao")) };
    if (porSituacao.length) {
      let algum = false;
      let soma = 0;
      for (const [campo, situacao] of porSituacao) {
        const q = lerNumero(cel(campo));
        if (q == null || q <= 0) continue;
        itens.push({ ...comum, quantidade: q, situacao });
        soma += q;
        algum = true;
      }
      // "Qtd. enviada" sem a coluna "em aberto": o que sobra da enviada ainda está com ela.
      if (!tem("qtdComRevendedora") && tem("quantidade")) {
        const enviada = lerNumero(cel("quantidade"));
        if (enviada != null && enviada - soma > 1e-9) {
          itens.push({ ...comum, quantidade: enviada - soma, situacao: "com_revendedora" });
          algum = true;
        }
      }
      if (!algum) ignorar("sem quantidade em nenhuma situação");
      return;
    }

    let quantidade = 1;
    if (tem("quantidade")) {
      const q = lerNumero(cel("quantidade"));
      if (q == null) return ignorar(textoCelula(cel("quantidade")) ? `quantidade inválida ("${textoCelula(cel("quantidade"))}")` : "sem quantidade");
      if (q <= 0) return ignorar("quantidade zero");
      quantidade = q;
    }
    let situacao: Situacao = "com_revendedora";
    if (tem("situacao")) {
      const bruto = textoCelula(cel("situacao"));
      if (bruto) {
        const s = lerSituacao(bruto);
        if (!s) return ignorar(`situação desconhecida ("${bruto}")`);
        situacao = s;
      }
    }
    itens.push({ ...comum, quantidade, situacao });
  });
  return { itens, ignoradas };
}

/* ------------------------------------------------- lote mais novo vale */

/** Mesma peça, da mesma revendedora, na mesma data: a situação mais nova substitui a antiga. */
export const chaveLinhaConsignado = (x: { revendedora: string | null; data: string | null; codigoBarras: string | null; referencia: string | null }) =>
  [chaveNome(x.revendedora), x.data ?? "", (x.codigoBarras || x.referencia || "").trim().toUpperCase()].join("|");

export interface RegistroConsignado {
  loteId: string;
  /** Quando o lote foi importado (ISO): o mais novo vale. */
  loteEm: string;
  data: string | null;
  revendedora: string | null;
  codigoBarras: string | null;
  referencia: string | null;
  produtoId: string | null;
  descricao: string | null;
  quantidade: number;
  situacao: string;
}

/** Para cada revendedora + data + peça, fica só o que veio no lote mais novo. */
export function registrosEfetivos<T extends RegistroConsignado>(registros: T[]): T[] {
  const lotePorChave = new Map<string, { em: string; id: string }>();
  for (const r of registros) {
    const k = chaveLinhaConsignado(r);
    const atual = lotePorChave.get(k);
    if (!atual || r.loteEm > atual.em || (r.loteEm === atual.em && r.loteId > atual.id)) lotePorChave.set(k, { em: r.loteEm, id: r.loteId });
  }
  return registros.filter((r) => lotePorChave.get(chaveLinhaConsignado(r))?.id === r.loteId);
}

const situacaoValida = (s: string): s is Situacao => (SITUACOES as readonly string[]).includes(s);

/* ----------------------------------------------------------- resumos */

export interface ResumoRevendedoraConsignado {
  chave: string;
  nome: string;
  com_revendedora: number;
  devolvida: number;
  vendida: number;
  avariada: number;
  perdida: number;
  total: number;
  ultimaData: string | null;
}

/** Por revendedora: peças com ela, devolvidas, vendidas, avariadas e perdidas (da que tem mais com ela para a que tem menos). */
export function resumoPorRevendedora(registros: RegistroConsignado[]): ResumoRevendedoraConsignado[] {
  const m = new Map<string, ResumoRevendedoraConsignado & { grafias: Map<string, number> }>();
  for (const r of registros) {
    if (!situacaoValida(r.situacao)) continue;
    const chave = chaveNome(r.revendedora);
    if (!chave) continue;
    let x = m.get(chave);
    if (!x) {
      x = { chave, nome: "", com_revendedora: 0, devolvida: 0, vendida: 0, avariada: 0, perdida: 0, total: 0, ultimaData: null, grafias: new Map() };
      m.set(chave, x);
    }
    const grafia = r.revendedora!.replace(/\s+/g, " ").trim();
    x.grafias.set(grafia, (x.grafias.get(grafia) ?? 0) + 1);
    x[r.situacao] += r.quantidade;
    x.total += r.quantidade;
    if (r.data && (!x.ultimaData || r.data > x.ultimaData)) x.ultimaData = r.data;
  }
  return [...m.values()]
    .map(({ grafias, ...x }) => ({ ...x, nome: [...grafias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? x.chave }))
    .sort((a, b) => b.com_revendedora - a.com_revendedora || b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Peças com as revendedoras por chave de SKU (para descontar do disponível da maleta). */
export function comRevendedorasPorSku(registros: RegistroConsignado[], chaveDe: (r: RegistroConsignado) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of registros) {
    if (r.situacao !== "com_revendedora") continue;
    const k = chaveDe(r);
    if (k) m.set(k, (m.get(k) ?? 0) + r.quantidade);
  }
  return m;
}

/** Para a revendedora escolhida: SKUs que estão com ela agora e os que ela já devolveu. */
export function consignadoDaRevendedora(
  registros: RegistroConsignado[],
  revendedora: string | null | undefined,
  chaveDe: (r: RegistroConsignado) => string | null,
): { comEla: Set<string>; devolvidas: Set<string> } {
  const comEla = new Set<string>();
  const devolvidas = new Set<string>();
  const alvo = chaveNome(revendedora);
  if (!alvo) return { comEla, devolvidas };
  for (const r of registros) {
    if (chaveNome(r.revendedora) !== alvo) continue;
    const k = chaveDe(r);
    if (!k) continue;
    if (r.situacao === "com_revendedora") comEla.add(k);
    else if (r.situacao === "devolvida") devolvidas.add(k);
  }
  // O que está com ela agora não conta como "devolvida" (voltou e foi de novo).
  for (const k of comEla) devolvidas.delete(k);
  return { comEla, devolvidas };
}

/** Totais de uma importação, por situação, para a prévia. */
export function totaisPorSituacao(itens: { quantidade: number; situacao: string }[]): Record<Situacao, number> {
  const t = { com_revendedora: 0, devolvida: 0, vendida: 0, avariada: 0, perdida: 0 } as Record<Situacao, number>;
  for (const i of itens) if (situacaoValida(i.situacao)) t[i.situacao] += i.quantidade;
  return t;
}
