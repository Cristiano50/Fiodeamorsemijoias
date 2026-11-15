import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MB,
  MENSAGEM_ABERTO_REMOTO,
  caminhoInterno,
  corpoGrandeDemais,
  decisaoAberto,
  decisaoInicial,
  decisaoSemConferencia,
  decisaoSessao,
  ehPublico,
  exigeGestora,
  imagemPublica,
  limiteCorpo,
  origemProibida,
  paginaAviso,
} from "../src/lib/acesso";

const h = (c: Record<string, string>) => new Headers(c);
const doApp = { host: "192.168.0.10:3000", origin: "http://192.168.0.10:3000", "sec-fetch-site": "same-origin" };

test("rotas públicas: entrada, login, sessão, feed, skill e GET de imagens", () => {
  for (const c of ["/entrar", "/api/login", "/api/sessao", "/api/feed/meta", "/api/skill/contexto", "/api/skill/cadastro"]) assert.equal(ehPublico(c, "GET"), true, c);
  assert.equal(ehPublico("/api/imagens/abc", "GET"), true);
  assert.equal(ehPublico("/api/imagens/abc", "HEAD"), true);
  assert.equal(ehPublico("/api/imagens/abc", "DELETE"), false);
  for (const c of ["/", "/pedidos", "/api/pedidos", "/api/skill/info", "/api/skill/baixar", "/entrar/x", "/api/sessao/x"]) assert.equal(ehPublico(c, "GET"), false, c);
});

test("só a gestora: listas antigas e as áreas novas (fornecedores, créditos, pagamento, excluir foto, testar UP)", () => {
  const sim: [string, string][] = [
    ["/configuracoes", "GET"],
    ["/historico", "GET"],
    ["/gastos", "GET"],
    ["/fornecedores", "GET"],
    ["/fornecedores/abc", "GET"],
    ["/api/usuarios", "GET"],
    ["/api/backup", "POST"],
    ["/api/creditos", "GET"],
    ["/api/creditos/abc", "PATCH"],
    ["/api/pedidos/p1/pagamento", "PUT"],
    ["/api/pedidos/p1/pagamento", "GET"],
    ["/api/pedidos/p1", "DELETE"],
    ["/api/produtos/x", "DELETE"],
    ["/api/imagens/x", "DELETE"],
    ["/api/upvendas/testar", "POST"],
    ["/api/upvendas/enviar", "POST"],
    ["/api/config", "PUT"],
    ["/api/skill/info", "GET"],
    ["/api/consignado/lotes/l1", "DELETE"],
    ["/api/rede", "POST"],
  ];
  for (const [c, m] of sim) assert.equal(exigeGestora(c, m), true, `${m} ${c}`);
  const nao: [string, string][] = [
    ["/api/config", "GET"],
    ["/api/pedidos/p1", "GET"],
    ["/api/pedidos/p1/itens", "POST"],
    ["/api/imagens/x", "GET"],
    ["/api/fornecedores", "GET"],
    ["/fornecedoresx", "GET"],
    ["/api/creditosx", "GET"],
    ["/produtos", "GET"],
    ["/api/consignado/lotes/l1", "GET"],
    ["/api/consignado/importar", "POST"],
    ["/api/pedidos/p1/recebimento", "PATCH"],
    ["/api/rede", "GET"],
  ];
  for (const [c, m] of nao) assert.equal(exigeGestora(c, m), false, `${m} ${c}`);
});

test("tamanho do envio: 20 MB em /api, 15 MB nas planilhas, 413 com mensagem em português", () => {
  assert.equal(limiteCorpo("/api/pedidos"), 20 * MB);
  for (const c of ["/api/vendas/importar", "/api/vendas/previa", "/api/upvendas/codigos", "/api/consignado/importar", "/api/consignado"]) assert.equal(limiteCorpo(c), 15 * MB, c);
  assert.equal(corpoGrandeDemais("/api/pedidos", "POST", String(12 * MB)), null, "PDF de 12 MB do pedido passa");
  assert.equal(corpoGrandeDemais("/api/pedidos/p1/itens", "POST", String(20 * MB)), null);
  assert.match(corpoGrandeDemais("/api/pedidos", "POST", String(20 * MB + 1)) ?? "", /limite é de 20 MB/);
  assert.match(corpoGrandeDemais("/api/vendas/importar", "POST", String(16 * MB)) ?? "", /limite é de 15 MB/);
  assert.equal(corpoGrandeDemais("/api/pedidos", "POST", null), null, "sem Content-Length segue (o Next limita)");
  assert.equal(corpoGrandeDemais("/importar", "POST", String(50 * MB)), null, "fora de /api");
  assert.equal(corpoGrandeDemais("/api/pedidos", "GET", String(50 * MB)), null);
  const d = decisaoInicial("/api/login", "POST", h({ ...doApp, "content-length": String(30 * MB) }));
  assert.deepEqual(d && d.tipo === "json" ? d.status : null, 413, "vale também nas rotas públicas");
});

test("origem: pedido do próprio app passa; de outro site é bloqueado", () => {
  assert.equal(origemProibida("/api/produtos", "POST", h(doApp)), null);
  assert.equal(origemProibida("/api/produtos", "DELETE", h({ host: "localhost:3000", origin: "http://localhost:3000" })), null);
  assert.equal(origemProibida("/api/produtos", "PATCH", h({ host: "[::1]:3000", origin: "http://[::1]:3000" })), null);
  // Atrás de proxy reverso: Host interno, x-forwarded-host com o endereço que o navegador usou.
  assert.equal(origemProibida("/api/produtos", "POST", h({ host: "127.0.0.1:3000", "x-forwarded-host": "loja.exemplo.com", origin: "https://loja.exemplo.com" })), null);
  assert.ok(origemProibida("/api/produtos", "POST", h({ host: "192.168.0.10:3000", origin: "http://site-de-fora.com" })));
  assert.ok(origemProibida("/api/produtos", "POST", h({ host: "192.168.0.10:3000", origin: "http://192.168.0.10:4000" })), "outra porta");
  assert.ok(origemProibida("/api/produtos", "POST", h({ host: "192.168.0.10:3000", origin: "null" })));
  assert.ok(origemProibida("/api/login", "DELETE", h({ host: "192.168.0.10:3000", origin: "https://192.168.0.10:3000.site.com" })));
  assert.ok(origemProibida("/api/produtos", "PUT", h({ host: "192.168.0.10:3000", "sec-fetch-site": "cross-site" })), "Sec-Fetch-Site cross-site sem Origin");
  assert.ok(origemProibida("/api/produtos", "POST", h({ ...doApp, "sec-fetch-site": "cross-site" })));
});

test("origem: leitura e scripts sem Origin seguem; a skill com chave funciona de fora", () => {
  assert.equal(origemProibida("/api/imagens/x", "GET", h({ host: "a", origin: "https://www.facebook.com", "sec-fetch-site": "cross-site" })), null);
  assert.equal(origemProibida("/api/produtos", "POST", h({ host: "192.168.0.10:3000" })), null, "curl/script sem Origin");
  assert.equal(origemProibida("/api/skill/cadastro", "POST", h({ host: "loja", authorization: "Bearer fda_x", origin: "https://claude.ai" })), null);
  assert.ok(origemProibida("/api/skill/cadastro", "POST", h({ host: "loja", origin: "https://claude.ai" })), "sem a chave, conta como site de fora");
  assert.ok(origemProibida("/api/produtos", "POST", h({ host: "loja", authorization: "Bearer x", origin: "https://site-de-fora.com" })), "Bearer só vale na skill");
  assert.equal(origemProibida("/pedidos", "POST", h({ host: "loja", origin: "https://site-de-fora.com" })), null, "fora de /api");
});

test("decisaoInicial: públicas seguem, o resto continua para o modo", () => {
  assert.deepEqual(decisaoInicial("/entrar", "GET", h({})), { tipo: "seguir" });
  assert.deepEqual(decisaoInicial("/api/imagens/x", "GET", h({})), { tipo: "seguir" });
  assert.equal(decisaoInicial("/pedidos", "GET", h({})), null);
  const csrf = decisaoInicial("/api/login", "POST", h({ host: "loja:3000", origin: "http://outro:3000" }));
  assert.ok(csrf && csrf.tipo === "json" && csrf.status === 403);
});

test("modo aberto: só o computador do servidor; outro aparelho recebe 403 explicando", () => {
  assert.deepEqual(decisaoAberto("/pedidos", true), { tipo: "seguir" });
  assert.deepEqual(decisaoAberto("/api/produtos", false), { tipo: "json", status: 403, erro: MENSAGEM_ABERTO_REMOTO });
  const p = decisaoAberto("/", false);
  assert.ok(p.tipo === "pagina" && p.status === 403 && p.mensagem === MENSAGEM_ABERTO_REMOTO);
  assert.match(MENSAGEM_ABERTO_REMOTO, /Configurações → Usuários/);
});

test("sessão: sem login → 401 ou tela de entrada; funcionária fora das áreas da gestora", () => {
  assert.deepEqual(decisaoSessao("/api/pedidos", "GET", null), { tipo: "json", status: 401, erro: "Faça login para continuar." });
  assert.deepEqual(decisaoSessao("/pedidos/abc", "GET", null), { tipo: "redirecionar", para: "/entrar?voltar=%2Fpedidos%2Fabc" });
  assert.deepEqual(decisaoSessao("/configuracoes", "GET", { papel: "funcionario" }), { tipo: "redirecionar", para: "/" });
  assert.deepEqual(decisaoSessao("/api/usuarios", "GET", { papel: "funcionario" }), { tipo: "json", status: 403, erro: "Somente a gestora pode fazer isso." });
  assert.deepEqual(decisaoSessao("/api/usuarios", "GET", { papel: "gestora" }), { tipo: "seguir" });
  assert.deepEqual(decisaoSessao("/pedidos", "GET", { papel: "funcionario" }), { tipo: "seguir" });
});

test("sem conferir a sessão (servidor sem resposta): 503, nunca abre", () => {
  const api = decisaoSemConferencia("/api/x");
  assert.ok(api.tipo === "json" && api.status === 503);
  const pag = decisaoSemConferencia("/");
  assert.ok(pag.tipo === "pagina" && pag.status === 503);
});

test("página de aviso escapa o texto", () => {
  const html = paginaAviso("<b>t</b>", `a "b" <script>`);
  assert.ok(!html.includes("<script>") && !html.includes("<b>t</b>"));
  assert.match(html, /&lt;script&gt;/);
});

test("voltar da tela de entrada: só caminho interno", () => {
  assert.equal(caminhoInterno("/pedidos/abc?aba=1"), "/pedidos/abc?aba=1");
  assert.equal(caminhoInterno("/"), "/");
  for (const ruim of ["//site-de-fora.com", "/\\site-de-fora.com", "\\\\site", "https://site-de-fora.com", "javascript:alert(1)", "pedidos", "", null, undefined, "/\t/site.com", "/\n/site.com", "/a\\b"])
    assert.equal(caminhoInterno(ruim), "/", String(ruim));
});

test("imagens públicas sem login: catálogo, upload, arte e IA aprovada; o resto não", () => {
  for (const origem of ["catalogo", "upload", "arte"]) assert.equal(imagemPublica({ origem }), true, origem);
  for (const origem of ["pagina", "referencia", "defeito", "qualquer"]) assert.equal(imagemPublica({ origem }), false, origem);
  assert.equal(imagemPublica({ origem: "defeito" }, true), false, "nem como principal");
  assert.equal(imagemPublica({ origem: "ia", meta: { aprovada: true } }), true, "aprovada pelo marketing");
  assert.equal(imagemPublica({ origem: "ia", meta: { aprovada: false, decisao: "aprovada" } }), true, "aprovada pela loja");
  assert.equal(imagemPublica({ origem: "ia", meta: { aprovada: true, decisao: "recusada" } }), false, "recusada pela loja");
  assert.equal(imagemPublica({ origem: "ia", meta: { aprovada: false } }), false);
  assert.equal(imagemPublica({ origem: "ia", meta: null }), false);
  assert.equal(imagemPublica({ origem: "ia", meta: { aprovada: null } }, true), true, "foto principal do produto");
  assert.equal(imagemPublica({ origem: "ia", meta: { decisao: "recusada" } }, true), false);
});
