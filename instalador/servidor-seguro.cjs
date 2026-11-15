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
 * Acesso de fora da loja pelo Cloudflare Tunnel (docs/acesso-de-fora.md): o cloudflared roda NESTE
 * computador e entrega cada acesso da internet por 127.0.0.1, com o IP de quem acessou em
 * CF-Connecting-IP e o protocolo em X-Forwarded-Proto/CF-Visitor. Só nesse caso (conexão do próprio
 * computador + CF-Connecting-IP com um IP válido) o invólucro grava X-Forwarded-For = esse IP e
 * X-Forwarded-Proto = https: o login por IP continua valendo, o acesso pela internet nunca passa por
 * "este computador" e o cookie do login vai com Secure. Um aparelho da rede que mande CF-Connecting-IP
 * não vem de 127.0.0.1: o cabeçalho é apagado como os outros.
 *
 * Teste: tests/infra-servidor-seguro.test.ts (com um server.js de mentira).
 */
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
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

/** 127.0.0.0/8, ::1 e ::ffff:127.x.x.x: a conexão veio deste mesmo computador. */
function ehLoopback(ip) {
  const s = String(ip || "")
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  return s === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

/** Primeiro valor de um cabeçalho (rawHeaders, sem diferenciar maiúsculas; senão req.headers). */
function valorDe(req, nome) {
  const bruto = req.rawHeaders;
  if (Array.isArray(bruto)) {
    for (let i = 0; i + 1 < bruto.length; i += 2) if (String(bruto[i]).toLowerCase() === nome) return String(bruto[i + 1]);
    return "";
  }
  const v = req.headers && req.headers[nome];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

/**
 * Acesso pela internet entregue pelo cloudflared deste computador: { ip de quem acessou, protocolo }.
 * null quando a conexão não é do próprio computador ou não traz CF-Connecting-IP com um IP válido.
 */
function acessoPeloTunel(req) {
  const ipSocket = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
  if (!ehLoopback(ipSocket)) return null;
  const cliente = valorDe(req, "cf-connecting-ip").trim();
  if (!net.isIP(cliente)) return null;
  const proto = valorDe(req, "x-forwarded-proto");
  const visitante = valorDe(req, "cf-visitor");
  const seguro = /(^|,)\s*https\s*(,|$)/i.test(proto) || /"scheme"\s*:\s*"https"/i.test(visitante);
  return { ip: cliente, proto: seguro ? "https" : "http" };
}

/** Troca os cabeçalhos de IP de uma requisição recebida pelo IP real da conexão (ou o do túnel). */
function limparCabecalhos(req) {
  if (!req || typeof req !== "object") return req;
  const tunel = acessoPeloTunel(req);
  const ip = tunel ? tunel.ip : req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
  const novos = [];
  if (ip) novos.push(["X-Forwarded-For", ip]);
  if (tunel) novos.push(["X-Forwarded-Proto", tunel.proto]);
  // rawHeaders primeiro, sem mudar o tamanho da lista: o Node monta req.headers a partir dela na primeira
  // leitura, contando os itens originais. Os cabeçalhos proibidos viram, em ordem, os valores reais; os outros, um nome inofensivo.
  const bruto = req.rawHeaders;
  if (Array.isArray(bruto)) {
    let k = 0;
    for (let i = 0; i + 1 < bruto.length; i += 2) {
      if (!PROIBIDOS.has(String(bruto[i]).toLowerCase())) continue;
      if (k < novos.length) {
        bruto[i] = novos[k][0];
        bruto[i + 1] = novos[k][1];
        k++;
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
    for (const [nome, valor] of novos) cab[nome.toLowerCase()] = valor;
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

module.exports = { CABECALHOS_DE_PROXY, limparCabecalhos, acessoPeloTunel, ehLoopback, proteger, iniciar };

if (require.main === module) iniciar();
