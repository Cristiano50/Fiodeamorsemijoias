/**
 * Feed do catálogo de produtos da Meta (WhatsApp Business e Instagram Shopping, pelo Commerce Manager).
 *
 * Lógica pura, sem acesso ao banco: a rota /api/feed/meta busca os dados e chama montarFeedMeta().
 * Os nomes das colunas seguem a especificação da Meta (em inglês). O CSV usa vírgula, como a Meta exige.
 *
 * Entram só peças com foto boa para o público: a foto com IA aprovada na fila "Fotos para aprovar"
 * (avaliada pelo marketing e aprovada pela loja) ou uma foto enviada pela loja (origem "upload").
 * Estoque: o saldo do UP quando existe; senão o que entrou (pedidos que já chegaram) − vendidas.
 */
import { estoqueEntrada } from "./estoque";

export const COLUNAS_META = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "google_product_category",
  "item_group_id",
  "color",
  "material",
  "size",
  "inventory",
  "custom_label_0",
  "custom_label_1",
] as const;

export type ColunaMeta = (typeof COLUNAS_META)[number];
export type LinhaMeta = Record<ColunaMeta, string>;
export type FormatoFeed = "csv" | "tsv";

export const CATEGORIA_GOOGLE = "Apparel & Accessories > Jewelry";

/** Campos do produto usados no feed (subconjunto da tabela `produtos`). */
export interface ProdutoFeed {
  id: string;
  referencia: string | null;
  codigoBarras: string | null;
  nome: string | null;
  nomeComercial: string | null;
  traducao?: string | null;
  avaliacao: string | null;
  legenda: string | null;
  tipo: string | null;
  material: string | null;
  banho: string | null;
  corPedra: string[] | null;
  tamanho: string | null;
  grupo: string | null;
  estilo: string | null;
  quantidade: number;
  precoVenda: number | null;
  status: string;
  imagemId: string | null;
  /* Sem `ctx.estoque`, o estoque da linha sai daqui (o pedido já chegou: recebida − defeito ou a pedida). */
  quantidadeRecebida?: number | null;
  quantidadeDefeito?: number | null;
  /** O pedido já chegou? (falso = a caminho: estoque 0). Vazio = chegou. */
  chegou?: boolean;
}

/** Estoque do SKU da peça, calculado pelo servidor (o mesmo para todas as linhas do SKU). */
export interface EstoqueFeed {
  /** Chave do SKU (código de barras ou a cadeia de recompra): linhas da mesma chave viram uma linha no feed. */
  chave: string;
  estoque: number;
  fonte: "up" | "app";
}

/** Foto criada por IA escolhida para o produto (ver fotosModeloPorProduto). */
export interface FotoModeloFeed {
  id: string;
  /** Nota do especialista de marketing (IA). */
  aprovada: boolean | null;
  /** Aprovada pela loja na fila "Fotos para aprovar": só essa vai para o catálogo. */
  publicavel?: boolean;
}

type ItemTaxonomia = { id: string; nome: string };

export interface ContextoFeed {
  /** Endereço público do app, sem barra no fim (ex.: https://fiodeamor.vercel.app). */
  urlBase: string;
  marca: string;
  whatsapp: string;
  linkModelo: string;
  taxonomia: { tipos: ItemTaxonomia[]; materiais: ItemTaxonomia[]; banhos: ItemTaxonomia[]; cores_pedra: ItemTaxonomia[] };
  fotos: Record<string, FotoModeloFeed | undefined>;
  /** Foto enviada pela loja (origem "upload") de cada produto: id da imagem. */
  fotosLoja?: Record<string, string | undefined>;
  /** Estoque por produto (saldo do UP ou entrada − vendidas). Sem ele, vale o da própria linha. */
  estoque?: Record<string, EstoqueFeed | undefined>;
}

/* ------------------------------------------------------------------ textos */

/** Uma linha só: sem quebras, tabs, caracteres de controle nem espaços duplicados. */
export function limpar(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Corta no limite de caracteres, de preferência entre palavras. */
export function cortar(texto: string, max: number): string {
  const s = limpar(texto);
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,;:–-]+$/, "");
}

const MINUSCULAS = new Set(["a", "o", "as", "os", "e", "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "com", "para", "por", "ao", "aos", "à", "às", "um", "uma"]);

/** "BRINCO ARGOLA DE ZIRCÔNIA 18K" → "Brinco Argola de Zircônia 18K". */
export function emTitulo(texto: string | null | undefined): string {
  return limpar(texto)
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((p, i) => {
      if (!p) return p;
      if (/^\d+k$/.test(p)) return p.toUpperCase(); // quilate: 18K
      if (/\d/.test(p)) return p; // medidas: 40cm, 925
      if (i > 0 && MINUSCULAS.has(p)) return p;
      return p.replace(/\p{L}/u, (c) => c.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

/** Preço no formato da Meta: "22.99 BRL". */
export function precoMeta(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor) || valor <= 0) return "";
  return `${valor.toFixed(2)} BRL`;
}

/** Só os dígitos do número de WhatsApp (DDI 55 + DDD + número). */
export const soDigitos = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

/** Número de WhatsApp brasileiro completo: 55 + DDD + 8 ou 9 dígitos. */
export const whatsappValido = (v: string | null | undefined) => /^55\d{10,11}$/.test(soDigitos(v));

/** Codifica o texto fixo do modelo (espaços, acentos), sem estragar o que já está codificado (%20). */
function codificarLiteral(s: string): string {
  return s.replace(/%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu, (c) => encodeURIComponent(c));
}

/**
 * Link do produto a partir do modelo (Configurações, seção "WhatsApp e catálogo Meta").
 * Marcadores: {whatsapp} {referencia} {nome}; os valores entram codificados para URL.
 */
export function preencherLink(modelo: string, dados: { whatsapp?: string | null; referencia?: string | null; nome?: string | null }): string {
  const valores: Record<string, string> = {
    whatsapp: soDigitos(dados.whatsapp),
    referencia: limpar(dados.referencia),
    nome: limpar(dados.nome),
  };
  return limpar(modelo)
    .split(/(\{(?:whatsapp|referencia|nome)\})/)
    .map((parte) => {
      const m = /^\{(whatsapp|referencia|nome)\}$/.exec(parte);
      return m ? encodeURIComponent(valores[m[1]]) : codificarLiteral(parte);
    })
    .join("");
}

/* ------------------------------------------------------------ endereço base */

/**
 * Endereço público para montar links absolutos (as imagens precisam de URL completa).
 * Ordem: NEXT_PUBLIC_URL_PUBLICA → cabeçalhos do proxy (x-forwarded-*) → Host → origem da requisição.
 */
export function urlBaseDe(o: { publica?: string | null; host?: string | null; proto?: string | null; origem: string }): string {
  const publica = limpar(o.publica);
  if (/^https?:\/\/[^\s/]+/i.test(publica)) return publica.replace(/\/+$/, "");
  const host = limpar(o.host?.split(",")[0]);
  if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    const protoOrigem = o.origem.startsWith("https:") ? "https" : "http";
    const proto = limpar(o.proto?.split(",")[0]).toLowerCase();
    return `${proto === "https" || proto === "http" ? proto : protoOrigem}://${host}`;
  }
  return o.origem.replace(/\/+$/, "");
}

/** O endereço só funciona dentro da loja (a Meta não consegue buscar o feed nem as fotos)? */
export function enderecoPrivado(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".local") || host === "[::1]" || host === "::1" || host === "0.0.0.0") return true;
  const ip = host.split(".").map(Number);
  if (ip.length === 4 && ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = ip;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return !host.includes(".");
}

/* ------------------------------------------------------------------ linhas */

const nomeDe = (lista: ItemTaxonomia[] | undefined, id: string | null | undefined) => (id ? (lista?.find((x) => x.id === id)?.nome ?? id) : "");

/** Nome curto para a cor: "Pérola (sintética / shell pearl)" → "Pérola"; "Esmalte branco / perolado" → "Esmalte branco". */
export const nomeCurto = (nome: string) => limpar(nome.replace(/\([^)]*\)/g, " ").split(" / ")[0]);

/** Frases unidas com ponto final, sem pontuação duplicada. */
function frases(partes: (string | null | undefined | false)[]): string {
  return partes
    .map((p) => limpar(p || "").replace(/[\s.;,]+$/, ""))
    .filter(Boolean)
    .map((p) => `${p}.`)
    .join(" ");
}

/**
 * Imagem principal e adicional:
 *  - a foto com IA aprovada pela loja (fila de fotos) vem primeiro; a enviada pela loja (ou, sem ela, a do catálogo) vira a adicional;
 *  - sem IA aprovada, a foto enviada pela loja;
 *  - sem nenhuma das duas, a foto do catálogo, mas a peça não entra no feed (`aprovada` falso; só no "todas" para conferir).
 */
export function imagensDoProduto(p: Pick<ProdutoFeed, "id" | "imagemId">, ctx: Pick<ContextoFeed, "urlBase" | "fotos" | "fotosLoja">) {
  const url = (id: string | null | undefined) => (id ? `${ctx.urlBase}/api/imagens/${encodeURIComponent(id)}` : "");
  const foto = ctx.fotos[p.id];
  const ia = foto?.publicavel ? foto.id : null;
  const loja = ctx.fotosLoja?.[p.id] ?? null;
  const principal = p.imagemId ?? null;
  const imagemId = ia ?? loja ?? principal;
  const adicionalId = ia ? (loja ?? principal) : null;
  return { imagem: url(imagemId), adicional: adicionalId && adicionalId !== imagemId ? url(adicionalId) : "", aprovada: !!(ia || loja) };
}

/** Identificador único no catálogo: o EAN; sem EAN, a referência + o id interno. */
export function idMeta(p: Pick<ProdutoFeed, "id" | "codigoBarras" | "referencia">): string {
  const ean = limpar(p.codigoBarras);
  if (ean) return ean;
  return cortar([limpar(p.referencia), p.id].filter(Boolean).join("_"), 100);
}

export function linhaMeta(p: ProdutoFeed, ctx: ContextoFeed): LinhaMeta {
  const tax = ctx.taxonomia;
  // Do nome de cadastro sai a sigla interna do material: "BRINCO (SJ) ARGOLA" → "Brinco Argola".
  const nomeCadastro = limpar(p.nome).replace(/\(\s*[A-Z0-9]{1,4}\s*\)/g, " ");
  const titulo = cortar(limpar(p.nomeComercial) || emTitulo(nomeCadastro) || limpar(p.referencia), 150);
  const material = nomeDe(tax.materiais, p.material);
  const banho = p.banho && p.banho !== "sem_banho" ? nomeDe(tax.banhos, p.banho) : "";
  const legenda = limpar(p.legenda).replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ");
  const texto = limpar(p.avaliacao) || limpar(legenda) || limpar(p.traducao);
  const descricao = frases([texto || titulo, material && `Material: ${material}`, banho && `Banho: ${banho}`]);
  // Cor: até 3 cores das pedras separadas por "/" (padrão do catálogo); sem pedra, a cor do banho.
  const cores = [...new Set((p.corPedra ?? []).filter((c) => c && c !== "sem_pedra").map((c) => nomeCurto(nomeDe(tax.cores_pedra, c))))].filter(Boolean).slice(0, 3);
  const doSku = ctx.estoque?.[p.id];
  const quantidade = doSku ? Math.max(0, Math.floor(Number(doSku.estoque) || 0)) : p.chegou === false ? 0 : estoqueEntrada(p);
  const { imagem, adicional } = imagensDoProduto(p, ctx);
  return {
    id: idMeta(p),
    title: titulo,
    description: cortar(descricao, 9999),
    availability: quantidade > 0 ? "in stock" : "out of stock",
    condition: "new",
    price: precoMeta(p.precoVenda),
    link: preencherLink(ctx.linkModelo, { whatsapp: ctx.whatsapp, referencia: p.referencia, nome: titulo }),
    image_link: imagem,
    additional_image_link: adicional,
    brand: cortar(ctx.marca, 100),
    google_product_category: CATEGORIA_GOOGLE,
    item_group_id: cortar(limpar(p.grupo) || limpar(p.referencia) || idMeta(p), 100),
    color: cortar(cores.length ? cores.join("/") : nomeCurto(banho), 200),
    material: cortar(material, 200),
    size: cortar(limpar(p.tamanho), 100),
    inventory: String(quantidade),
    custom_label_0: cortar(nomeDe(tax.tipos, p.tipo), 100),
    custom_label_1: cortar(limpar(p.estilo), 100),
  };
}

/** Por padrão, só peças aprovadas, com preço e com foto aprovada (IA aprovada pela loja) ou enviada pela loja. */
export function entraNoFeed(p: ProdutoFeed, linha: LinhaMeta, fotoAprovada = true): boolean {
  return p.status === "aprovado" && !!linha.price && !!linha.image_link && fotoAprovada;
}

/**
 * Mesmo SKU em mais de uma linha (recompra): a linha mais nova vale (o id do catálogo continua o da primeira).
 * O estoque do SKU (saldo do UP ou entrada − vendidas) é o mesmo nas duas; sem ele, soma o de cada linha.
 */
function juntar(antiga: LinhaMeta, nova: LinhaMeta, estoqueDoSku: boolean): LinhaMeta {
  const out = { ...antiga };
  for (const c of COLUNAS_META) if (c !== "id" && nova[c]) out[c] = nova[c];
  const estoque = estoqueDoSku ? Math.max(Number(antiga.inventory) || 0, Number(nova.inventory) || 0) : (Number(antiga.inventory) || 0) + (Number(nova.inventory) || 0);
  out.inventory = String(estoque);
  out.availability = estoque > 0 ? "in stock" : "out of stock";
  return out;
}

/* ------------------------------------------------------------- serialização */

/** Campo CSV (RFC 4180): entre aspas quando tem vírgula, aspas, quebra de linha ou espaço nas pontas. */
export function campoCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Campo TSV: tab e quebras de linha viram espaço (o TSV não usa aspas). */
export function campoTsv(v: unknown): string {
  return (v == null ? "" : String(v)).replace(/[\t\r\n]+/g, " ");
}

export function serializarFeed(linhas: LinhaMeta[], formato: FormatoFeed = "csv"): string {
  const sep = formato === "tsv" ? "\t" : ",";
  const campo = formato === "tsv" ? campoTsv : campoCsv;
  return [COLUNAS_META.join(sep), ...linhas.map((l) => COLUNAS_META.map((c) => campo(l[c])).join(sep))].join("\r\n") + "\r\n";
}

/**
 * Gera o arquivo do feed. `todos` inclui também peças não aprovadas, sem preço ou sem foto aprovada (para conferir).
 * `semFotoAprovada`: peças aprovadas e com preço que ficaram de fora só pela foto (para o aviso em Configurações).
 */
export function montarFeedMeta(produtos: ProdutoFeed[], ctx: ContextoFeed, opts: { formato?: FormatoFeed; todos?: boolean } = {}) {
  const porGrupo = new Map<string, LinhaMeta>();
  let ignorados = 0;
  let semFotoAprovada = 0;
  for (const p of produtos) {
    const linha = linhaMeta(p, ctx);
    const { aprovada } = imagensDoProduto(p, ctx);
    if (!opts.todos && !entraNoFeed(p, linha, aprovada)) {
      ignorados++;
      if (entraNoFeed(p, linha, true)) semFotoAprovada++;
      continue;
    }
    const doSku = ctx.estoque?.[p.id];
    const grupo = doSku?.chave ?? linha.id;
    const existente = porGrupo.get(grupo);
    porGrupo.set(grupo, existente ? juntar(existente, linha, !!doSku) : linha);
  }
  const linhas = [...porGrupo.values()];
  return { texto: serializarFeed(linhas, opts.formato ?? "csv"), itens: linhas.length, ignorados, semFotoAprovada, total: produtos.length };
}
