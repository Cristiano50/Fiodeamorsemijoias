"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS de propósito: roda direto no node.exe da loja e carrega o server.js (CommonJS) do Next */
/**
 * Invólucro do servidor do app no computador da loja (instalador do Windows): servidor.cmd roda
 * `node servidor-seguro.cjs` na pasta app\, e este arquivo carrega o ./server.js do Next (saída "standalone").
 *
 * Não há proxy na frente do servidor da loja: os celulares falam direto com ele. Então qualquer
 * X-Forwarded-For, X-Real-IP ou Forwarded que chegue foi escrito pelo próprio aparelho e pode ser falso.
 * Antes de o Next ver cada requisição, este invólucro apaga esses cabeçalhos e grava
 * X-Forwarded-For = IP real da conexão (req.socket.remoteAddress). Por isso pode definir
 * FDA_IP_CONFIAVEL=1: o app passa a confiar no X-Forwarded-For (limite de tentativas de login por IP
 * e "acesso sem senha só neste computador").
 *
 * Teste: tests/infra-servidor-seguro.test.ts (com um server.js de mentira).
 */
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

/** Cabeçalhos com IP ou endereço "de origem" que só um proxy confiável poderia escrever. */
const CABECALHOS_DE_PROXY = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
  "x-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "x-cluster-client-ip",
];
const PROIBIDOS = new Set(CABECALHOS_DE_PROXY);
const IGNORADO = "x-fda-ignorado";

/** Troca os cabeçalhos de IP de uma requisição recebida pelo IP real da conexão. */
function limparCabecalhos(req) {
  if (!req || typeof req !== "object") return req;
  const ip = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
  // rawHeaders primeiro, sem mudar o tamanho da lista: o Node monta req.headers a partir dela na primeira
  // leitura, contando os itens originais. O primeiro cabeçalho proibido vira o X-Forwarded-For real; os outros, um nome inofensivo.
  const bruto = req.rawHeaders;
  if (Array.isArray(bruto)) {
    let gravou = false;
    for (let i = 0; i + 1 < bruto.length; i += 2) {
      if (!PROIBIDOS.has(String(bruto[i]).toLowerCase())) continue;
      if (!gravou && ip) {
        bruto[i] = "X-Forwarded-For";
        bruto[i + 1] = ip;
        gravou = true;
      } else {
        bruto[i] = IGNORADO;
        bruto[i + 1] = "";
      }
    }
  }
  const cab = req.headers;
  if (cab && typeof cab === "object") {
    for (const nome of CABECALHOS_DE_PROXY) delete cab[nome];
    delete cab[IGNORADO];
    if (ip) cab["x-forwarded-for"] = ip;
  }
  return req;
}

const EVENTOS = new Set(["request", "checkContinue", "checkExpectation", "upgrade", "connect"]);

/** Intercepta os eventos de requisição de um tipo de servidor (http.Server, https.Server). */
function proteger(Classe) {
  const original = Classe.prototype.emit;
  if (original && original.__fdaSeguro) return;
  function emit(evento, req) {
    if (EVENTOS.has(evento)) limparCabecalhos(req);
    return original.apply(this, arguments);
  }
  emit.__fdaSeguro = true;
  Classe.prototype.emit = emit;
}

function iniciar() {
  proteger(http.Server);
  proteger(https.Server);
  process.env.FDA_IP_CONFIAVEL = "1";
  require(path.join(__dirname, "server.js"));
}

module.exports = { CABECALHOS_DE_PROXY, limparCabecalhos, proteger, iniciar };

if (require.main === module) iniciar();
