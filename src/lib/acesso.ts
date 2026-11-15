/**
 * Regras de acesso do proxy e das imagens, em funções puras (sem banco, sem "server-only"):
 * o proxy (src/proxy.ts) só busca o modo e a sessão e aplica estas decisões.
 * Testes: tests/seguranca-acesso.test.ts.
 *
 * Modos de acesso:
 *  - "aberto" (sem usuários e sem APP_SENHA): livre, mas SÓ no próprio computador do servidor;
 *  - "senha" (APP_SENHA): senha única da equipe;
 *  - "usuarios": login individual; algumas áreas só para a gestora.
 */

export interface Cabecalhos {
  get(nome: string): string | null;
}

export type Papel = "gestora" | "funcionario";

export const MENSAGEM_ABERTO_REMOTO =
  "Para usar pelo celular ou outro computador, crie usuários (Configurações → Usuários) ou defina uma senha no computador do servidor.";
export const MENSAGEM_LOGIN = "Faça login para continuar.";
export const MENSAGEM_GESTORA = "Somente a gestora pode fazer isso.";
export const MENSAGEM_OUTRO_SITE = "Pedido bloqueado por segurança: ele veio de outro site. Abra o app pelo endereço da loja e tente de novo.";
export const MENSAGEM_SEM_CONFERENCIA = "Não consegui conferir o seu login agora. Espere alguns segundos e tente de novo.";

// /api/skill/contexto e /api/skill/cadastro conferem sozinhas a chave da skill (ou a sessão).
export const PUBLICO = [/^\/entrar$/, /^\/api\/login$/, /^\/api\/sessao$/, /^\/api\/feed\//, /^\/api\/skill\/(contexto|cadastro)$/];

/** Áreas exclusivas da gestora (método "*" = qualquer). As rotas também conferem o papel nelas mesmas. */
export const SO_GESTORA: { caminho: RegExp; metodos: string[] }[] = [
  { caminho: /^\/configuracoes/, metodos: ["*"] },
  { caminho: /^\/historico/, metodos: ["*"] },
  { caminho: /^\/gastos/, metodos: ["*"] },
  { caminho: /^\/fornecedores(\/|$)/, metodos: ["*"] },
  { caminho: /^\/api\/historico/, metodos: ["*"] },
  { caminho: /^\/api\/gastos/, metodos: ["*"] },
  { caminho: /^\/api\/usuarios/, metodos: ["*"] },
  { caminho: /^\/api\/backup/, metodos: ["*"] },
  { caminho: /^\/api\/creditos(\/|$)/, metodos: ["*"] },
  { caminho: /^\/api\/skill\/(info|baixar)/, metodos: ["*"] },
  { caminho: /^\/api\/config$/, metodos: ["PUT", "DELETE", "POST", "PATCH"] },
  { caminho: /^\/api\/referencias/, metodos: ["POST", "PATCH", "DELETE"] },
  { caminho: /^\/api\/pedidos\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/pedidos\/[^/]+\/pagamento(\/|$)/, metodos: ["*"] },
  { caminho: /^\/api\/produtos\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/imagens\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/upvendas\/enviar/, metodos: ["POST"] },
  { caminho: /^\/api\/upvendas\/testar/, metodos: ["POST"] },
  { caminho: /^\/api\/vendas\/lotes\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/consignado\/lotes\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/rede$/, metodos: ["POST"] },
];

const LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);
const ehApi = (caminho: string) => caminho.startsWith("/api/");

export function ehPublico(caminho: string, metodo: string): boolean {
  if (PUBLICO.some((r) => r.test(caminho))) return true;
  // Imagens: o UP Vendas e o catálogo da Meta baixam a foto pelo link; a rota decide quais são públicas.
  return caminho.startsWith("/api/imagens/") && (metodo === "GET" || metodo === "HEAD");
}

export function exigeGestora(caminho: string, metodo: string): boolean {
  return SO_GESTORA.some((r) => r.caminho.test(caminho) && (r.metodos.includes("*") || r.metodos.includes(metodo)));
}

/* ------------------------------------------------------------ tamanho do envio */

export const MB = 1024 * 1024;
/** Planilhas do UP (vendas, códigos, consignado): bem abaixo do geral. */
const PLANILHAS = /^\/api\/(vendas\/(importar|previa)|upvendas\/codigos|consignado)(\/|$)/;

/**
 * Limite do corpo da requisição em /api. O geral (20 MB) acompanha experimental.proxyClientMaxBodySize
 * do next.config.ts: acima dele o Next entregaria o corpo cortado à rota, sem erro.
 */
export function limiteCorpo(caminho: string): number {
  return PLANILHAS.test(caminho) ? 15 * MB : 20 * MB;
}

/** Mensagem de erro (413) quando o Content-Length passa do limite; senão null. */
export function corpoGrandeDemais(caminho: string, metodo: string, contentLength: string | null): string | null {
  if (!ehApi(caminho) || metodo === "GET" || metodo === "HEAD" || !contentLength) return null;
  const tamanho = Number(contentLength);
  const limite = limiteCorpo(caminho);
  if (!Number.isFinite(tamanho) || tamanho <= limite) return null;
  return `Arquivo muito grande (${(tamanho / MB).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB). O limite é de ${limite / MB} MB por envio: divida em partes menores ou diminua o arquivo.`;
}

/* ------------------------------------------------------------ origem (CSRF) */

/** Host de uma origem ("http://192.168.0.10:3000" → "192.168.0.10:3000"); inválida → null. */
function hostDaOrigem(origem: string): string | null {
  try {
    const u = new URL(origem);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Pedido que altera dados (POST/PUT/PATCH/DELETE em /api) vindo de outro site → mensagem de erro (403).
 * O navegador sempre manda Origin nesses pedidos; scripts (a skill, curl) não mandam e seguem as regras
 * normais. A skill usa a própria chave (Authorization: Bearer), que nenhum site consegue enviar.
 */
export function origemProibida(caminho: string, metodo: string, headers: Cabecalhos): string | null {
  if (!ehApi(caminho) || LEITURA.has(metodo)) return null;
  if (/^\/api\/skill\/(contexto|cadastro)$/.test(caminho) && /^Bearer\s/i.test(headers.get("authorization") ?? "")) return null;
  if ((headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") return MENSAGEM_OUTRO_SITE;
  const origem = headers.get("origin");
  if (origem === null) return null;
  const host = hostDaOrigem(origem);
  // Atrás de um proxy reverso o Host pode ser o interno; x-forwarded-host traz o que o navegador usou
  // (um site de fora não consegue mandar esse cabeçalho sem a permissão de CORS, que o app não dá).
  const aceitos = [headers.get("host"), headers.get("x-forwarded-host")?.split(",")[0]]
    .map((h) => h?.trim().toLowerCase())
    .filter(Boolean);
  return host && aceitos.includes(host) ? null : MENSAGEM_OUTRO_SITE;
}

/* ------------------------------------------------------------ decisões */

export type Decisao =
  | { tipo: "seguir" }
  | { tipo: "json"; status: number; erro: string }
  | { tipo: "pagina"; status: number; titulo: string; mensagem: string }
  | { tipo: "redirecionar"; para: string };

const SEGUIR: Decisao = { tipo: "seguir" };

/** Antes de saber o modo: tamanho do envio, origem e rotas públicas. null = continuar. */
export function decisaoInicial(caminho: string, metodo: string, headers: Cabecalhos): Decisao | null {
  const grande = corpoGrandeDemais(caminho, metodo, headers.get("content-length"));
  if (grande) return { tipo: "json", status: 413, erro: grande };
  const origem = origemProibida(caminho, metodo, headers);
  if (origem) return { tipo: "json", status: 403, erro: origem };
  return ehPublico(caminho, metodo) ? SEGUIR : null;
}

/** Modo aberto: só o computador do servidor entra. */
export function decisaoAberto(caminho: string, local: boolean): Decisao {
  if (local) return SEGUIR;
  if (ehApi(caminho)) return { tipo: "json", status: 403, erro: MENSAGEM_ABERTO_REMOTO };
  return { tipo: "pagina", status: 403, titulo: "Este aparelho ainda não pode abrir o app", mensagem: MENSAGEM_ABERTO_REMOTO };
}

/** Modos senha/usuários, com a sessão já conferida pelo servidor (null = sem login válido). */
export function decisaoSessao(caminho: string, metodo: string, usuario: { papel: Papel } | null): Decisao {
  const api = ehApi(caminho);
  if (!usuario) return api ? { tipo: "json", status: 401, erro: MENSAGEM_LOGIN } : { tipo: "redirecionar", para: `/entrar?voltar=${encodeURIComponent(caminho)}` };
  if (exigeGestora(caminho, metodo) && usuario.papel !== "gestora") return api ? { tipo: "json", status: 403, erro: MENSAGEM_GESTORA } : { tipo: "redirecionar", para: "/" };
  return SEGUIR;
}

/** Não deu para conferir a sessão (servidor sem resposta): nega, sem apagar o login. */
export function decisaoSemConferencia(caminho: string): Decisao {
  if (ehApi(caminho)) return { tipo: "json", status: 503, erro: MENSAGEM_SEM_CONFERENCIA };
  return { tipo: "pagina", status: 503, titulo: "Só um instante", mensagem: MENSAGEM_SEM_CONFERENCIA };
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Página simples de aviso (o proxy não renderiza React). */
export function paginaAviso(titulo: string, mensagem: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fio de Amor</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:#fbf3f6;color:#3d2a33;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:26rem;background:#fff;border-radius:1.5rem;padding:2rem;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}img{width:12rem;max-width:100%;margin-bottom:1rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{line-height:1.5;margin:0 0 1rem}a{color:#8e5b6f}</style></head><body><main><img src="/marca/logo-fiodeamor.png" alt="Fio de Amor Semijoias"><h1>${escapar(titulo)}</h1><p>${escapar(mensagem)}</p><a href="/">Tentar de novo</a></main></body></html>`;
}

/* ------------------------------------------------------------ outros */

/**
 * "voltar" da tela de entrada: só caminho interno do app ("/pedidos?x=1").
 * Recusa "//site", "/\site", endereços completos e caracteres de controle (o navegador apaga tab e
 * quebra de linha: "/\t/site" viraria "//site").
 */
export function caminhoInterno(voltar: string | null | undefined): string {
  const v = voltar ?? "";
  if (!v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(v)) return "/";
  return v;
}

/** Origens de foto que qualquer um pode abrir pelo link (feed da Meta, UP Vendas, catálogo). */
export const ORIGENS_PUBLICAS = ["catalogo", "upload", "arte"];

/**
 * Foto pública sem login? catalogo, upload e arte sim; foto da IA só aprovada (pelo marketing ou pela
 * loja na fila de fotos) ou escolhida como foto principal de um produto, e nunca a recusada pela loja.
 * Páginas do pedido, referências de estilo, peças com defeito e o resto exigem login.
 */
export function imagemPublica(img: { origem: string; meta?: unknown }, principalDeProduto = false): boolean {
  if (ORIGENS_PUBLICAS.includes(img.origem)) return true;
  if (img.origem !== "ia") return false;
  const m = (img.meta && typeof img.meta === "object" ? img.meta : {}) as { aprovada?: unknown; decisao?: unknown };
  if (m.decisao === "recusada") return false;
  return m.decisao === "aprovada" || m.aprovada === true || principalDeProduto;
}
