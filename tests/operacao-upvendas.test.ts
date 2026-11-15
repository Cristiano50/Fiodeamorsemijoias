import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUNAS_NOVOS,
  COLUNAS_RECOMPRAS,
  linhaUp,
  linhasRecompraUp,
  montarCsv,
  nomeArquivoUp,
  separarParaUp,
  tipoPlanilhaUp,
  valorCelulaXlsx,
  type ContextoUp,
} from "../src/lib/upvendas-planilha";
import { EnderecoUpInvalido, urlNoServidorUp } from "../src/lib/upvendas-url";
import type { Produto } from "../src/lib/db/schema";
import type { Taxonomia, UpVendasConfig } from "../src/lib/config";
import type { PoliticaPreco } from "../src/lib/precos";
import taxonomia from "../src/config/taxonomia.json";
import precificacao from "../src/config/precificacao.json";

function produto(over: Partial<Produto>): Produto {
  return {
    id: "p1",
    pedidoId: "ped1",
    linha: 1,
    codigoFornecedor: "ABC123A",
    textoOriginal: null,
    descricaoOriginal: null,
    traducao: null,
    nome: "Brinco teste",
    nomeComercial: null,
    nomesSugeridos: null,
    avaliacao: null,
    legenda: null,
    hashtags: null,
    destaque: false,
    tipo: "brinco",
    subtipo: null,
    material: null,
    banho: null,
    corPedra: null,
    tamanho: null,
    variacao: null,
    especificacao: null,
    recompraCandidatas: null,
    grupo: null,
    recompraDe: null,
    ehConjunto: false,
    componentes: null,
    estilo: null,
    quantidade: 13,
    quantidadeRecebida: null,
    quantidadeDefeito: 0,
    defeitoImagemId: null,
    defeitoObs: null,
    precoOrigem: 4.5,
    moeda: "CNY",
    custoProdutoBrl: 3.5,
    custoAdicionalBrl: 0.5,
    custoTotalBrl: 4,
    fator: null,
    precoManual: null,
    fatorAplicado: 10,
    precoVenda: 39.99,
    precos: null,
    referencia: "BR_2611001",
    codigoBarras: null,
    codigoBarrasOrigem: null,
    ncm: "71171900",
    unidade: "UN",
    imagemId: null,
    status: "aprovado",
    confianca: null,
    alertas: null,
    upId: null,
    upStatus: null,
    upMensagem: null,
    upSincronizadoEm: null,
    criadoEm: "2026-11-15T10:00:00.000Z",
    atualizadoEm: "2026-11-15T10:00:00.000Z",
    ...over,
  };
}

const ctx: ContextoUp = {
  tax: taxonomia as unknown as Taxonomia,
  pol: precificacao as unknown as PoliticaPreco,
  up: { mapaCampos: {} } as unknown as UpVendasConfig,
  marca: "FIO DE AMOR",
  codigoNoUp: "ean13",
  origemCodigoBarras: "upvendas",
  urlBase: "http://loja.local:3000",
  fotos: {},
};

test("Planilha de produtos novos: saldo = o que entrou na conferência", () => {
  assert.equal(linhaUp(produto({}), ctx).estoque, 13); // sem conferência: a pedida
  assert.equal(linhaUp(produto({ quantidadeRecebida: 11, quantidadeDefeito: 2 }), ctx).estoque, 9);
  assert.equal(linhaUp(produto({ quantidadeRecebida: 0 }), ctx).estoque, 0);
});

test("Novos × recompras", () => {
  const lista = [produto({ id: "n1" }), produto({ id: "r1", recompraDe: "orig1" }), produto({ id: "n2" })];
  const { novos, recompras } = separarParaUp(lista);
  assert.deepEqual(novos.map((p) => p.id), ["n1", "n2"]);
  assert.deepEqual(recompras.map((p) => p.id), ["r1"]);
  assert.equal(tipoPlanilhaUp("recompras"), "recompras");
  assert.equal(tipoPlanilhaUp(null), "novos");
  assert.equal(tipoPlanilhaUp("qualquer"), "novos");
  assert.equal(nomeArquivoUp("recompras", "2026-11-15"), "fiodeamor-recompras-2026-11-15");
});

test("Planilha de recompras: código do UP + quantidade que entrou, somando o mesmo código", () => {
  const { linhas, semCodigo, semEntrada } = linhasRecompraUp(
    [
      produto({ id: "r1", recompraDe: "o1", codigoBarras: "9000023019929", codigoBarrasOrigem: "up", quantidade: 13, quantidadeRecebida: 12, quantidadeDefeito: 1, custoTotalBrl: 4 }),
      produto({ id: "r2", recompraDe: "o1", codigoBarras: "9000023019929", codigoBarrasOrigem: "up", quantidade: 6, custoTotalBrl: 5 }),
      produto({ id: "r3", recompraDe: "o2", referencia: "BR_2611002", codigoBarras: null, quantidade: 4 }),
      produto({ id: "r4", recompraDe: "o3", codigoBarras: "9000000000017", codigoBarrasOrigem: "up", quantidadeRecebida: 0 }),
    ],
    ctx,
  );
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[0], { codigoBarras: "9000023019929", quantidade: 17, referencia: "BR_2611001", nome: "BRINCO TESTE", custoUnitario: 4.35 });
  assert.equal(linhas[1].codigoBarras, "");
  assert.equal(linhas[1].quantidade, 4);
  assert.equal(semCodigo, 1);
  assert.equal(semEntrada, 1); // nada entrou: fica de fora
});

test("Planilhas seguras: CSV com ; e texto que não vira fórmula", () => {
  const csv = montarCsv(COLUNAS_RECOMPRAS, [{ codigoBarras: "9000023019929", quantidade: 3, referencia: "=HYPERLINK(1)", nome: "ANEL; DOURADO", custoUnitario: 4.35 }]);
  const [cab, linha] = csv.split("\r\n");
  assert.equal(cab, "Cód. Barras;Quantidade;Referência;Nome do produto;Custo unitário");
  assert.equal(linha, `9000023019929;3;'=HYPERLINK(1);"ANEL; DOURADO";4,35`);
  assert.equal(valorCelulaXlsx("+55 11"), "'+55 11");
  assert.equal(valorCelulaXlsx(true), "Sim");
  assert.equal(valorCelulaXlsx(4.5), 4.5);
  assert.equal(valorCelulaXlsx(null), "");
  assert.equal(COLUNAS_NOVOS.find(([k]) => k === "estoque")?.[1], "Saldo Estoque");
});

test("Login do UP: a senha só vai para o servidor configurado", () => {
  assert.equal(urlNoServidorUp("/auth/login", "https://ms.upvendas.app"), "https://ms.upvendas.app/auth/login");
  assert.equal(urlNoServidorUp("/produtos?referencia=X", "https://ms.upvendas.app/api/"), "https://ms.upvendas.app/produtos?referencia=X");
  for (const ruim of ["https://outro.exemplo/login", "//outro.exemplo/login", "/\\outro.exemplo/login", "/\t/outro.exemplo", "auth/login", "", "javascript:alert(1)"])
    assert.throws(() => urlNoServidorUp(ruim, "https://ms.upvendas.app"), EnderecoUpInvalido, ruim);
  assert.throws(() => urlNoServidorUp("/auth/login", "ftp://ms.upvendas.app"), EnderecoUpInvalido);
  assert.throws(() => urlNoServidorUp("/auth/login", "não é endereço"), EnderecoUpInvalido);
  assert.throws(() => urlNoServidorUp("/auth/login", "https://user:senha@ms.upvendas.app"), EnderecoUpInvalido);
});
