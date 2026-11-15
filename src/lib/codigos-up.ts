/**
 * Código de barras criado pelo UP Vendas.
 *
 * O UP gera o código de barras de cada produto (e de cada variação da grade) no cadastro. A loja quer usar
 * esse código em tudo: etiqueta, recompra, vendas e catálogo. Por isso o app:
 *  1. manda a planilha do UP sem código (o UP cria o dele);
 *  2. importa de volta a lista de produtos exportada do UP (referência + código de barras) ou recebe o código bipado;
 *  3. grava o código no produto e nas recompras dele (a recompra é o mesmo produto no UP).
 * Regras de segurança: nunca liga um código à variação (grade) errada — na dúvida, a peça fica "pendente" para bipar;
 * e nunca troca em silêncio um código que já veio do UP — a troca vira "conflito" para a gestora confirmar.
 * A lista do UP pode trazer também o saldo de estoque (coluna opcional), gravado em saldos_up.
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/codigos-up.test.ts.
 */
import { lerNumeroBr } from "./numeros";
import { normalizarTexto, textoCelula } from "./vendas-calculo";

/* ------------------------------------------------------------ campos */

export const CAMPOS_CODIGOS_UP = [
  { id: "referencia", nome: "Referência", obrigatorio: true },
  { id: "codigoBarras", nome: "Código de barras", obrigatorio: true },
  { id: "codigoExterno", nome: "Código externo (código do fornecedor)", obrigatorio: false },
  { id: "grade", nome: "Descrição da grade / variação", obrigatorio: false },
  { id: "nome", nome: "Nome do produto", obrigatorio: false },
  { id: "saldo", nome: "Saldo / estoque no UP", obrigatorio: false },
] as const;

export type CampoCodigoUp = (typeof CAMPOS_CODIGOS_UP)[number]["id"];
export type MapeamentoCodigos = Partial<Record<CampoCodigoUp, number>>;

const PADROES: Record<CampoCodigoUp, RegExp[]> = {
  referencia: [/^ref(erencia)?$/, /^referencia do produto$/, /^cod(igo)? (do )?produto$/, /^referencia/],
  codigoBarras: [/^cod(igo)? ?(de )?barras?$/, /^ean( 13)?$/, /^gtin$/, /barras/, /^ean/],
  codigoExterno: [/^cod(igo)? externo$/, /externo/, /fornecedor/],
  grade: [/^descricao (da )?grade$/, /grade/, /variacao/, /^cor$/, /^tamanho$/],
  nome: [/^nome( do produto)?$/, /^descricao( do produto)?$/, /^produto$/],
  saldo: [/^saldo( em estoque| atual| disponivel)?$/, /^estoque( atual| disponivel)?$/, /^qtde? (em )?estoque$/, /^quantidade em estoque$/, /saldo/, /estoque/],
};

/** Sugere a coluna de cada campo pelo nome do cabeçalho (sem repetir colunas). */
export function sugerirMapeamentoCodigos(cabecalhos: string[]): MapeamentoCodigos {
  const norm = cabecalhos.map((c) => normalizarTexto(c));
  const usadas = new Set<number>();
  const mapa: MapeamentoCodigos = {};
  for (const campo of ["codigoBarras", "codigoExterno", "referencia", "grade", "nome", "saldo"] as CampoCodigoUp[]) {
    for (const re of PADROES[campo]) {
      const i = norm.findIndex((h, k) => !usadas.has(k) && re.test(h));
      if (i >= 0) {
        mapa[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }
  return mapa;
}

/* ------------------------------------------------------------ valores */

export const normRef = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");
const normCodigo = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Código de barras como texto, sem espaços. Notação científica do Excel (9,00E+12) não dá para recuperar. */
export function lerCodigoBarras(v: unknown): { codigo: string | null; erro?: string } {
  const t = textoCelula(v).replace(/\s+/g, "");
  if (!t) return { codigo: null };
  if (/^\d+[.,]\d+E\+?\d+$/i.test(t)) return { codigo: null, erro: "código em notação científica (no Excel, formate a coluna como Texto antes de exportar)" };
  if (/^\d+[.,]0+$/.test(t)) return { codigo: t.replace(/[.,]0+$/, "") }; // 9000000000017,0
  if (!/^[0-9A-Za-z-]{4,40}$/.test(t)) return { codigo: null, erro: `código de barras inválido ("${t.slice(0, 20)}")` };
  return { codigo: t };
}

/** Saldo de estoque da célula (inteiro; aceita "12", "12,000", "-3"); vazio ou texto = null. */
export function lerSaldo(v: unknown): number | null {
  const t = textoCelula(v);
  if (!t) return null;
  const n = lerNumeroBr(t);
  return n == null ? null : Math.round(n);
}

/** Dígito verificador EAN-13 confere? */
export function ean13Valido(c: string): boolean {
  if (!/^\d{13}$/.test(c)) return false;
  const soma = c
    .slice(0, 12)
    .split("")
    .reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === Number(c[12]);
}

/* ------------------------------------------------------------ casamento */

/** Produto do app que pode receber o código do UP (só o original; as recompras herdam). */
export interface ProdutoCodigo {
  id: string;
  referencia: string | null;
  codigoFornecedor: string | null;
  variacao: string | null;
  nome: string | null;
  codigoBarras: string | null;
  codigoBarrasOrigem: string | null;
  recompraDe: string | null;
  especificacao?: string | null; // especificação/cor do fornecedor (G, MR, 金色…)
}

export interface LinhaCodigoUp {
  linha: number; // linha na planilha (1 = primeira)
  referencia: string;
  codigoBarras: string;
  codigoExterno: string | null;
  grade: string | null;
  nome: string | null;
  saldo?: number | null; // saldo de estoque no UP (coluna opcional)
}

export interface Atualizacao {
  produtoId: string;
  referencia: string;
  nome: string | null;
  variacao: string | null;
  antes: string | null;
  antesOrigem: string | null;
  depois: string;
  linha: number;
}

/** Troca de um código que já veio do UP: só com a confirmação da gestora (uma a uma ou todas). */
export interface TrocaCodigo {
  produtoId: string;
  referencia: string;
  nome: string | null;
  variacao: string | null;
  atual: string;
  novo: string;
}

export interface ConflitoCodigo {
  linha: number;
  referencia: string;
  codigoBarras: string;
  motivo: string;
  troca?: TrocaCodigo; // presente = a gestora pode confirmar a troca
}

export interface ResultadoCodigos {
  atualizar: Atualizacao[];
  iguais: number; // o produto já tinha esse código do UP
  semPar: { linha: number; referencia: string; codigoBarras: string; motivo: string }[];
  ambiguas: { linha: number; referencia: string; codigoBarras: string; opcoes: { id: string; nome: string | null; variacao: string | null }[] }[];
  conflitos: ConflitoCodigo[];
  // Peças das referências da planilha que ficaram sem o código por dúvida de variação: bipar à mão.
  pendentes: { id: string; referencia: string; nome: string | null; variacao: string | null; especificacao: string | null }[];
  ignoradas: { linha: number; motivo: string }[];
  semCodigoDoUp: number; // produtos do app (originais com referência) que continuam sem o código do UP
}

/** Lê as linhas da planilha com o mapeamento escolhido. */
export function lerLinhasCodigos(linhas: unknown[][], mapa: MapeamentoCodigos, primeiraLinha: number) {
  const lidas: LinhaCodigoUp[] = [];
  const ignoradas: { linha: number; motivo: string }[] = [];
  const col = (l: unknown[], c: CampoCodigoUp) => (mapa[c] != null && mapa[c]! >= 0 ? l[mapa[c]!] : undefined);
  linhas.forEach((l, i) => {
    const linha = primeiraLinha + i;
    if (!l || l.every((c) => textoCelula(c) === "")) return;
    const referencia = textoCelula(col(l, "referencia"));
    const { codigo, erro } = lerCodigoBarras(col(l, "codigoBarras"));
    if (erro) return ignoradas.push({ linha, motivo: erro });
    if (!codigo) return ignoradas.push({ linha, motivo: "sem código de barras" });
    if (!referencia) return ignoradas.push({ linha, motivo: "sem referência" });
    lidas.push({
      linha,
      referencia,
      codigoBarras: codigo,
      codigoExterno: textoCelula(col(l, "codigoExterno")) || null,
      grade: textoCelula(col(l, "grade")) || null,
      nome: textoCelula(col(l, "nome")) || null,
      saldo: mapa.saldo != null ? lerSaldo(col(l, "saldo")) : null,
    });
  });
  return { lidas, ignoradas };
}

/** Saldos de estoque da planilha por código de barras (a última linha de cada código vale). */
export function saldosDaPlanilha(lidas: LinhaCodigoUp[]): { codigoBarras: string; saldo: number }[] {
  const porCodigo = new Map<string, number>();
  for (const l of lidas) if (l.saldo != null) porCodigo.set(l.codigoBarras, l.saldo);
  return [...porCodigo].map(([codigoBarras, saldo]) => ({ codigoBarras, saldo }));
}

const POUCO_PARA_ESPECIFICACAO = new Set(["A", "E", "O", "DE", "DA", "DO", "EM", "COM"]);
const normEspecificacao = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toUpperCase().replace(/[\s.\-]+/g, "");

/** A especificação do fornecedor (G, 14KF, 金色…) aparece no texto do UP (grade, código externo, nome)? */
function textoTemEspecificacao(textos: (string | null)[], especificacao: string): boolean {
  const esp = normEspecificacao(especificacao);
  if (!esp || POUCO_PARA_ESPECIFICACAO.has(esp)) return false;
  const juntos = textos.filter(Boolean).join(" ").normalize("NFKC").toUpperCase();
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(esp)) return normEspecificacao(juntos).includes(esp);
  return juntos.split(/[^0-9A-Z+#\u00c0-\u024f\u3400-\u9fff\uf900-\ufaff]+/).some((t) => normEspecificacao(t) === esp);
}

/**
 * Quanto a linha do UP parece ser esta variação do app.
 * `forte`: grade/variação, especificação, nome ou o próprio código já gravado; `fraco`: código externo (igual em todas as
 * variações do mesmo código do fornecedor, só desempata quando a planilha e o app têm o mesmo número de variações).
 */
function pontuar(p: ProdutoCodigo, l: LinhaCodigoUp): { forte: number; fraco: number } {
  let forte = 0;
  let fraco = 0;
  if (p.codigoBarras && p.codigoBarrasOrigem === "up" && p.codigoBarras === l.codigoBarras) forte += 10;
  const ext = normCodigo(l.codigoExterno);
  const forn = normCodigo(p.codigoFornecedor);
  if (ext && forn) {
    if (ext === forn) fraco += 3;
    else if (ext.startsWith(forn) || forn.startsWith(ext)) fraco += 1;
  }
  const variacao = normalizarTexto(p.variacao ?? "");
  const textoUp = normalizarTexto([l.grade, l.codigoExterno, l.nome].filter(Boolean).join(" "));
  if (variacao && textoUp && ` ${textoUp} `.includes(` ${variacao} `)) forte += 4;
  if (p.especificacao && textoTemEspecificacao([l.grade, l.codigoExterno, l.nome], p.especificacao)) forte += 4;
  if (l.nome && p.nome && normalizarTexto(l.nome) === normalizarTexto(p.nome)) forte += 1;
  return { forte, fraco };
}

/**
 * Liga cada linha da lista do UP a um produto do app pela referência.
 *  - Referência com 1 peça no app e 1 código no UP: liga direto.
 *  - Mais de uma variação (de um lado ou do outro): só liga com correspondência de grade/variação/especificação/nome
 *    (o código externo só desempata quando os dois lados têm o mesmo número de variações). Cada peça recebe uma linha só.
 *    O que ficar em dúvida vai para `ambiguas` (linhas) e `pendentes` (peças, para bipar à mão).
 *  - Peça que já tem outro código do UP: não troca; vira conflito com `troca` para a gestora confirmar.
 * `todos` = todos os produtos do app (originais e recompras), para checar códigos já usados.
 */
export function casarCodigosUp(todos: ProdutoCodigo[], linhasUp: LinhaCodigoUp[], ignoradas: { linha: number; motivo: string }[] = []): ResultadoCodigos {
  const originais = todos.filter((p) => !p.recompraDe && p.referencia);
  const porRef = new Map<string, ProdutoCodigo[]>();
  for (const p of originais) porRef.set(normRef(p.referencia), [...(porRef.get(normRef(p.referencia)) ?? []), p]);
  const linhasDaRef = new Map<string, LinhaCodigoUp[]>();
  for (const l of linhasUp) linhasDaRef.set(normRef(l.referencia), [...(linhasDaRef.get(normRef(l.referencia)) ?? []), l]);
  // Dono atual de cada código (raiz da cadeia de recompra).
  const donoDoCodigo = new Map<string, string>();
  for (const p of todos) if (p.codigoBarras) donoDoCodigo.set(p.codigoBarras, p.recompraDe ?? p.id);

  const r: ResultadoCodigos = { atualizar: [], iguais: 0, semPar: [], ambiguas: [], conflitos: [], pendentes: [], ignoradas: [...ignoradas], semCodigoDoUp: 0 };

  // 1. Qual peça cada linha é, referência por referência.
  const escolha = new Map<LinhaCodigoUp, ProdutoCodigo>();
  const refsEmDuvida = new Set<string>();
  for (const [ref, linhas] of linhasDaRef) {
    const candidatos = porRef.get(ref) ?? [];
    if (!candidatos.length) continue;
    const codigosNoUp = new Set(linhas.map((l) => l.codigoBarras)).size;
    if (candidatos.length === 1 && codigosNoUp === 1) {
      for (const l of linhas) escolha.set(l, candidatos[0]);
      continue;
    }
    const mesmaQuantidade = candidatos.length === codigosNoUp;
    const propostas = new Map<ProdutoCodigo, { l: LinhaCodigoUp; nota: number }[]>();
    for (const l of linhas) {
      const notas = candidatos
        .map((p) => {
          const n = pontuar(p, l);
          return { p, forte: n.forte, nota: n.forte + (mesmaQuantidade ? n.fraco : 0) };
        })
        .sort((a, b) => b.nota - a.nota);
      const [a, b] = notas;
      const unica = a.nota > 0 && (!b || a.nota > b.nota);
      if (!unica || (!mesmaQuantidade && a.forte <= 0)) {
        refsEmDuvida.add(ref);
        continue;
      }
      propostas.set(a.p, [...(propostas.get(a.p) ?? []), { l, nota: a.nota }]);
    }
    // Cada peça fica com uma linha só: na disputa vence a de nota maior; empate = dúvida.
    for (const [p, lista] of propostas) {
      lista.sort((a, b) => b.nota - a.nota);
      const vencedora = lista.length === 1 || lista[0].nota > lista[1].nota || lista.every((x) => x.l.codigoBarras === lista[0].l.codigoBarras) ? lista[0] : null;
      for (const x of lista) {
        if (vencedora && x.l.codigoBarras === vencedora.l.codigoBarras) escolha.set(x.l, p);
        else refsEmDuvida.add(ref);
      }
    }
  }

  // 2. Confere cada linha escolhida (código de outro produto, troca de código do UP, linhas repetidas).
  const codigoEscolhido = new Map<string, { codigo: string; linha: number }>(); // produto → código
  const produtoDoCodigo = new Map<string, string>(); // código → produto (nesta planilha)
  for (const l of linhasUp) {
    const base = { linha: l.linha, referencia: l.referencia, codigoBarras: l.codigoBarras };
    const candidatos = porRef.get(normRef(l.referencia)) ?? [];
    if (!candidatos.length) {
      r.semPar.push({ ...base, motivo: "referência não encontrada no app" });
      continue;
    }
    const escolhido = escolha.get(l);
    if (!escolhido) {
      r.ambiguas.push({ ...base, opcoes: candidatos.map((p) => ({ id: p.id, nome: p.nome, variacao: p.variacao ?? p.especificacao ?? null })) });
      continue;
    }
    const dono = donoDoCodigo.get(l.codigoBarras);
    if (dono && dono !== escolhido.id) {
      const outro = todos.find((p) => p.id === dono);
      r.conflitos.push({ ...base, motivo: `o código já é de outro produto no app (${outro?.referencia ?? "sem referência"}${outro?.variacao ? ` ${outro.variacao}` : ""})` });
      continue;
    }
    const jaNoProduto = codigoEscolhido.get(escolhido.id);
    if (jaNoProduto && jaNoProduto.codigo !== l.codigoBarras) {
      r.conflitos.push({ ...base, motivo: `a planilha tem dois códigos para a mesma peça (${jaNoProduto.codigo} na linha ${jaNoProduto.linha})` });
      continue;
    }
    const outroProduto = produtoDoCodigo.get(l.codigoBarras);
    if (outroProduto && outroProduto !== escolhido.id) {
      r.conflitos.push({ ...base, motivo: "o mesmo código aparece em duas peças diferentes da planilha" });
      continue;
    }
    if (jaNoProduto) continue; // linha repetida
    codigoEscolhido.set(escolhido.id, { codigo: l.codigoBarras, linha: l.linha });
    produtoDoCodigo.set(l.codigoBarras, escolhido.id);
    if (escolhido.codigoBarras === l.codigoBarras && escolhido.codigoBarrasOrigem === "up") {
      r.iguais++;
      continue;
    }
    if (escolhido.codigoBarrasOrigem === "up" && escolhido.codigoBarras) {
      r.conflitos.push({
        ...base,
        motivo: `a peça já tem outro código do UP (${escolhido.codigoBarras}); só troca se a gestora confirmar`,
        troca: { produtoId: escolhido.id, referencia: escolhido.referencia!, nome: escolhido.nome, variacao: escolhido.variacao, atual: escolhido.codigoBarras, novo: l.codigoBarras },
      });
      continue;
    }
    r.atualizar.push({
      produtoId: escolhido.id,
      referencia: escolhido.referencia!,
      nome: escolhido.nome,
      variacao: escolhido.variacao,
      antes: escolhido.codigoBarras,
      antesOrigem: escolhido.codigoBarrasOrigem,
      depois: l.codigoBarras,
      linha: l.linha,
    });
  }
  for (const ref of refsEmDuvida)
    for (const p of porRef.get(ref) ?? [])
      if (!codigoEscolhido.has(p.id) && p.codigoBarrasOrigem !== "up")
        r.pendentes.push({ id: p.id, referencia: p.referencia!, nome: p.nome, variacao: p.variacao, especificacao: p.especificacao ?? null });
  r.semCodigoDoUp = originais.filter((p) => p.codigoBarrasOrigem !== "up" && !codigoEscolhido.has(p.id)).length;
  return r;
}
