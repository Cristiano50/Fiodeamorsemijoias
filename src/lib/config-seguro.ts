/**
 * Regras para salvar configurações (PUT /api/config), em funções puras.
 * Testes: tests/seguranca-config.test.ts.
 */
import { validadeDias } from "./sessao";

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto => (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Objeto) } : {});

/**
 * "sistema": o que a tela mandou por cima do que já está salvo (telas diferentes não apagam os campos
 * umas das outras). As chaves criadas pelo servidor nunca vêm da tela: a do feed da Meta (o link
 * cadastrado na Meta pararia de funcionar) e a da skill do Claude. `trocarFeedChave: true` apaga a do
 * feed, e o servidor cria outra na próxima vez que a tela de canais abrir.
 */
export function prepararSistema(salvo: unknown, valor: unknown, atual: { feedChave?: string; skillChave?: string }): Objeto {
  const { trocarFeedChave, ...resto } = objeto(valor);
  const novo: Objeto = { ...objeto(salvo), ...resto };
  novo.feedChave = trocarFeedChave === true ? "" : (atual.feedChave ?? "");
  novo.skillChave = atual.skillChave ?? "";
  if ("validadeSessaoDias" in resto) novo.validadeSessaoDias = validadeDias(resto.validadeSessaoDias);
  if ("urlPublica" in resto) novo.urlPublica = lerUrlPublica(resto.urlPublica) ?? "";
  return novo;
}

/**
 * Endereço do app na internet (acesso de fora da loja): só protocolo + endereço (+ porta), sem caminho,
 * usuário/senha nem barra no fim. "" (desligar) vale. Inválido → null.
 *   "app.loja.com.br" → "https://app.loja.com.br"   "https://app.loja.com.br/" → "https://app.loja.com.br"
 */
export function lerUrlPublica(valor: unknown): string | null {
  let t = typeof valor === "string" ? valor.trim() : "";
  if (!t) return "";
  if (!/^[a-z]+:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return null;
    if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    if (!/^[a-z0-9.-]+$/i.test(u.hostname) && !/^\[[0-9a-f:.]+\]$/i.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const ERRO_URL_PUBLICA =
  "O endereço na internet precisa ser só o endereço do app, ex.: https://app.minhaloja.com.br (sem /pedidos ou outra coisa depois).";

/** Origem (protocolo + endereço + porta) de uma URL http(s); senão null. */
export function origemDe(url: unknown): string | null {
  try {
    const u = new URL(String(url ?? "").trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? u.origin : null;
  } catch {
    return null;
  }
}

export const CAMINHOS_UP = ["caminhoLogin", "caminhoProdutos", "caminhoProdutoPorReferencia"] as const;
const NOMES: Record<(typeof CAMINHOS_UP)[number], string> = {
  caminhoLogin: "caminho do login",
  caminhoProdutos: "caminho dos produtos",
  caminhoProdutoPorReferencia: "caminho do produto por referência",
};

/**
 * Caminho do UP (login, produtos…): só caminho relativo começando com "/". Recusa endereço completo
 * (http://, https://), "//outro-site", barras invertidas e caracteres de controle — o navegador e o
 * fetch tratam "\" como "/" e apagam tab/quebra de linha, e a senha iria para outro endereço.
 */
export function problemaCaminhoUp(campo: (typeof CAMINHOS_UP)[number], caminho: unknown, baseUrl: string): string | null {
  const c = typeof caminho === "string" ? caminho : "";
  const nome = NOMES[campo];
  if (!c) return `Preencha o ${nome} do UP Vendas (começando com "/").`;
  if (!c.startsWith("/") || c.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(c))
    return `O ${nome} do UP Vendas precisa ser só o caminho, começando com "/" (ex.: /auth/login), sem endereço de site.`;
  const base = origemDe(baseUrl);
  try {
    if (!base || new URL(c, baseUrl).origin !== base) return `O ${nome} do UP Vendas não pode apontar para outro endereço.`;
  } catch {
    return `O ${nome} do UP Vendas não é válido.`;
  }
  return null;
}

/** Endereço do UP: http(s)://servidor, sem usuário e senha embutidos. */
export function problemaEnderecoUp(baseUrl: unknown): string | null {
  const texto = typeof baseUrl === "string" ? baseUrl.trim() : "";
  try {
    const u = new URL(texto);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) throw new Error();
    if (u.username || u.password) return "Tire o usuário e a senha do endereço do UP Vendas (eles têm campos próprios).";
    return null;
  } catch {
    return "O endereço do UP Vendas precisa começar com https:// (ex.: https://ms.upvendas.app).";
  }
}

/**
 * "upvendas": mescla com o salvo, confere endereço e caminhos e diz se o endereço mudou (aí a senha
 * salva precisa ser apagada: ela não pode ir para um endereço novo sem ser digitada de novo).
 */
export function prepararUpvendas(
  salvo: unknown,
  valor: unknown,
  atual: { baseUrl?: string },
): { erro: string } | { valor: Objeto; trocouEndereco: boolean } {
  const novo: Objeto = { ...objeto(salvo), ...objeto(valor) };
  delete novo.senha; // a senha fica só em "segredos"
  const baseUrl = typeof novo.baseUrl === "string" ? novo.baseUrl.trim() : (atual.baseUrl ?? "");
  const problema = problemaEnderecoUp(baseUrl);
  if (problema) return { erro: problema };
  novo.baseUrl = baseUrl;
  for (const campo of CAMINHOS_UP) {
    if (!(campo in novo)) continue; // vale o padrão
    const p = problemaCaminhoUp(campo, novo[campo], baseUrl);
    if (p) return { erro: p };
  }
  return { valor: novo, trocouEndereco: origemDe(baseUrl) !== origemDe(atual.baseUrl) };
}
