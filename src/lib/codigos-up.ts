/**
 * Código de barras criado pelo UP Vendas.
 *
 * O UP gera o código de barras de cada produto (e de cada variação da grade) no cadastro. A loja quer usar
 * esse código em tudo: etiqueta, recompra, vendas e catálogo. Por isso o app:
 *  1. manda a planilha do UP sem código (o UP cria o dele);
 *  2. importa de volta a lista de produtos exportada do UP (referência + código de barras) ou recebe o código bipado;
 *  3. grava o código no produto e nas recompras dele (a recompra é o mesmo produto no UP).
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/codigos-up.test.ts.
 */
import { normalizarTexto, textoCelula } from "./vendas-calculo";

/* ------------------------------------------------------------ campos */

export const CAMPOS_CODIGOS_UP = [
  { id: "referencia", nome: "Referência", obrigatorio: true },
  { id: "codigoBarras", nome: "Código de barras", obrigatorio: true },
  { id: "codigoExterno", nome: "Código externo (código do fornecedor)", obrigatorio: false },
  { id: "grade", nome: "Descrição da grade / variação", obrigatorio: false },
  { id: "nome", nome: "Nome do produto", obrigatorio: false },
] as const;

export type CampoCodigoUp = (typeof CAMPOS_CODIGOS_UP)[number]["id"];
export type MapeamentoCodigos = Partial<Record<CampoCodigoUp, number>>;

const PADROES: Record<CampoCodigoUp, RegExp[]> = {
  referencia: [/^ref(erencia)?$/, /^referencia do produto$/, /^cod(igo)? (do )?produto$/, /^referencia/],
  codigoBarras: [/^cod(igo)? ?(de )?barras?$/, /^ean( 13)?$/, /^gtin$/, /barras/, /^ean/],
  codigoExterno: [/^cod(igo)? externo$/, /externo/, /fornecedor/],
  grade: [/^descricao (da )?grade$/, /grade/, /variacao/, /^cor$/, /^tamanho$/],
  nome: [/^nome( do produto)?$/, /^descricao( do produto)?$/, /^produto$/],
};

/** Sugere a coluna de cada campo pelo nome do cabeçalho (sem repetir colunas). */
export function sugerirMapeamentoCodigos(cabecalhos: string[]): MapeamentoCodigos {
  const norm = cabecalhos.map((c) => normalizarTexto(c));
  const usadas = new Set<number>();
  const mapa: MapeamentoCodigos = {};
  for (const campo of ["codigoBarras", "codigoExterno", "referencia", "grade", "nome"] as CampoCodigoUp[]) {
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
}

export interface LinhaCodigoUp {
  linha: number; // linha na planilha (1 = primeira)
  referencia: string;
  codigoBarras: string;
  codigoExterno: string | null;
  grade: string | null;
  nome: string | null;
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

export interface ResultadoCodigos {
  atualizar: Atualizacao[];
  iguais: number; // o produto já tinha esse código do UP
  semPar: { linha: number; referencia: string; codigoBarras: string; motivo: string }[];
  ambiguas: { linha: number; referencia: string; codigoBarras: string; opcoes: { id: string; nome: string | null; variacao: string | null }[] }[];
  conflitos: { linha: number; referencia: string; codigoBarras: string; motivo: string }[];
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
    });
  });
  return { lidas, ignoradas };
}

/** Pontua quanto a linha do UP parece ser esta variação do app (para referências com mais de uma variação). */
function pontuar(p: ProdutoCodigo, l: LinhaCodigoUp): number {
  let pts = 0;
  if (p.codigoBarras && p.codigoBarrasOrigem === "up" && p.codigoBarras === l.codigoBarras) pts += 10;
  const ext = normCodigo(l.codigoExterno);
  const forn = normCodigo(p.codigoFornecedor);
  if (ext && forn) {
    if (ext === forn) pts += 3;
    else if (ext.startsWith(forn) || forn.startsWith(ext)) pts += 1;
  }
  const variacao = normalizarTexto(p.variacao ?? "");
  const textoUp = normalizarTexto([l.grade, l.codigoExterno].filter(Boolean).join(" "));
  if (variacao && textoUp && ` ${textoUp} `.includes(` ${variacao} `)) pts += 4;
  if (l.nome && p.nome && normalizarTexto(l.nome) === normalizarTexto(p.nome)) pts += 1;
  return pts;
}

/**
 * Liga cada linha da lista do UP a um produto do app pela referência; quando a referência tem várias
 * variações (grade), desempata pelo código externo, pela descrição da grade e pelo nome.
 * `todos` = todos os produtos do app (originais e recompras), para checar códigos já usados.
 */
export function casarCodigosUp(todos: ProdutoCodigo[], linhasUp: LinhaCodigoUp[], ignoradas: { linha: number; motivo: string }[] = []): ResultadoCodigos {
  const originais = todos.filter((p) => !p.recompraDe && p.referencia);
  const porRef = new Map<string, ProdutoCodigo[]>();
  for (const p of originais) porRef.set(normRef(p.referencia), [...(porRef.get(normRef(p.referencia)) ?? []), p]);
  const linhasPorRef = new Map<string, number>();
  for (const l of linhasUp) linhasPorRef.set(normRef(l.referencia), (linhasPorRef.get(normRef(l.referencia)) ?? 0) + 1);
  // Dono atual de cada código (raiz da cadeia de recompra).
  const donoDoCodigo = new Map<string, string>();
  for (const p of todos) if (p.codigoBarras) donoDoCodigo.set(p.codigoBarras, p.recompraDe ?? p.id);

  const r: ResultadoCodigos = { atualizar: [], iguais: 0, semPar: [], ambiguas: [], conflitos: [], ignoradas: [...ignoradas], semCodigoDoUp: 0 };
  const codigoEscolhido = new Map<string, { codigo: string; linha: number }>(); // produto → código
  const produtoDoCodigo = new Map<string, string>(); // código → produto (nesta planilha)

  for (const l of linhasUp) {
    const base = { linha: l.linha, referencia: l.referencia, codigoBarras: l.codigoBarras };
    const candidatos = porRef.get(normRef(l.referencia)) ?? [];
    if (!candidatos.length) {
      r.semPar.push({ ...base, motivo: "referência não encontrada no app" });
      continue;
    }
    let escolhido: ProdutoCodigo | undefined;
    if (candidatos.length === 1 && (linhasPorRef.get(normRef(l.referencia)) ?? 0) === 1) escolhido = candidatos[0];
    else {
      const notas = candidatos.map((p) => ({ p, n: pontuar(p, l) })).sort((a, b) => b.n - a.n);
      if (notas[0].n > 0 && (notas.length === 1 || notas[0].n > notas[1].n)) escolhido = notas[0].p;
      else if (candidatos.length === 1) escolhido = candidatos[0]; // várias linhas no UP para uma peça só no app
    }
    if (!escolhido) {
      r.ambiguas.push({ ...base, opcoes: candidatos.map((p) => ({ id: p.id, nome: p.nome, variacao: p.variacao })) });
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
  r.semCodigoDoUp = originais.filter((p) => p.codigoBarrasOrigem !== "up" && !codigoEscolhido.has(p.id)).length;
  return r;
}
