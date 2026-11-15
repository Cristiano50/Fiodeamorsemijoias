import { test } from "node:test";
import assert from "node:assert/strict";
import { origemDe, prepararSistema, prepararUpvendas, problemaCaminhoUp, problemaEnderecoUp } from "../src/lib/config-seguro";

const UP = "https://ms.upvendas.app";

test("sistema: mescla com o salvo (uma tela não apaga o campo da outra)", () => {
  const salvo = { whatsappNumero: "5511999999999", limiteMensalIaUsd: 20, feedChave: "feed-1" };
  const novo = prepararSistema(salvo, { limiteMensalIaUsd: 35 }, { feedChave: "feed-1", skillChave: "" });
  assert.equal(novo.whatsappNumero, "5511999999999");
  assert.equal(novo.limiteMensalIaUsd, 35);
  assert.equal(novo.feedChave, "feed-1");
});

test("sistema: chaves do feed e da skill nunca vêm da tela", () => {
  const atual = { feedChave: "feed-1", skillChave: "fda_skill" };
  assert.equal(prepararSistema({}, { feedChave: "" }, atual).feedChave, "feed-1", "tela com dados antigos não apaga");
  assert.equal(prepararSistema({}, { feedChave: "chave-inventada" }, atual).feedChave, "feed-1");
  assert.equal(prepararSistema({}, { skillChave: "" }, atual).skillChave, "fda_skill");
  const troca = prepararSistema({ feedChave: "feed-1" }, { trocarFeedChave: true }, atual);
  assert.equal(troca.feedChave, "", "pedido explícito de chave nova");
  assert.ok(!("trocarFeedChave" in troca));
});

test("sistema: validade do login saneada ao salvar", () => {
  assert.equal(prepararSistema({}, { validadeSessaoDias: "7" }, {}).validadeSessaoDias, 7);
  assert.equal(prepararSistema({}, { validadeSessaoDias: 0 }, {}).validadeSessaoDias, 14);
  assert.ok(!("validadeSessaoDias" in prepararSistema({}, { marcaUp: "X" }, {})));
});

test("caminhos do UP: só caminho relativo começando com /", () => {
  assert.equal(problemaCaminhoUp("caminhoLogin", "/auth/login", UP), null);
  assert.equal(problemaCaminhoUp("caminhoProdutoPorReferencia", "/produtos?referencia={referencia}", UP), null);
  for (const ruim of ["https://site-de-fora.com/login", "http://site-de-fora.com", "//site-de-fora.com/x", "\\\\site-de-fora.com", "/\\site-de-fora.com", "auth/login", "/\t/site-de-fora.com", "/ /x", "", 42, null])
    assert.ok(problemaCaminhoUp("caminhoLogin", ruim, UP), String(ruim));
});

test("endereço do UP", () => {
  assert.equal(problemaEnderecoUp(UP), null);
  assert.equal(problemaEnderecoUp("http://192.168.0.50:8080"), null);
  assert.ok(problemaEnderecoUp("ms.upvendas.app"));
  assert.ok(problemaEnderecoUp("javascript:alert(1)"));
  assert.ok(problemaEnderecoUp("https://usuario:senha@ms.upvendas.app"));
  assert.equal(origemDe("https://ms.upvendas.app/api/"), "https://ms.upvendas.app");
  assert.equal(origemDe("lixo"), null);
});

test("upvendas: mescla, nunca guarda a senha e avisa quando o endereço muda", () => {
  const salvo = { baseUrl: UP, dominio: "loja", usuario: "fda" };
  const mesmo = prepararUpvendas(salvo, { usuario: "outro", senha: "nao-guardar" }, { baseUrl: UP });
  assert.ok(!("erro" in mesmo));
  if ("erro" in mesmo) return;
  assert.equal(mesmo.valor.dominio, "loja");
  assert.equal(mesmo.valor.usuario, "outro");
  assert.ok(!("senha" in mesmo.valor));
  assert.equal(mesmo.trocouEndereco, false);

  const outro = prepararUpvendas(salvo, { baseUrl: "https://outro-servidor.com" }, { baseUrl: UP });
  assert.ok(!("erro" in outro) && outro.trocouEndereco, "endereço novo → apagar a senha salva");
  const http = prepararUpvendas(salvo, { baseUrl: "http://ms.upvendas.app" }, { baseUrl: UP });
  assert.ok(!("erro" in http) && http.trocouEndereco, "trocar https por http também conta");
  const barra = prepararUpvendas(salvo, { baseUrl: "https://ms.upvendas.app/" }, { baseUrl: UP });
  assert.ok(!("erro" in barra) && !barra.trocouEndereco, "barra no fim não é endereço novo");
});

test("upvendas: caminho que leva a senha para outro site é recusado", () => {
  const r = prepararUpvendas({}, { caminhoLogin: "//site-de-fora.com/pegar-senha" }, { baseUrl: UP });
  assert.ok("erro" in r && /caminho do login/.test(r.erro));
  const r2 = prepararUpvendas({}, { baseUrl: "ftp://x" }, { baseUrl: UP });
  assert.ok("erro" in r2);
});
