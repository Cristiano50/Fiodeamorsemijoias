import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLocal, ehLoopback, hostSemPorta, ipDoCliente, ipInformado, normalizarIp } from "../src/lib/rede";

const h = (c: Record<string, string>) => new Headers(c);
const CONFIAVEL = { FDA_IP_CONFIAVEL: "1" };
const SEM_FONTE = {};

test("normalizarIp: IPv4, IPv6, IPv4 dentro de IPv6, porta, colchetes e lixo", () => {
  assert.equal(normalizarIp("192.168.0.5"), "192.168.0.5");
  assert.equal(normalizarIp(" 10.0.0.2:51234 "), "10.0.0.2");
  assert.equal(normalizarIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizarIp("::FFFF:7f00:1"), "127.0.0.1");
  assert.equal(normalizarIp("[::1]:3000"), "::1");
  assert.equal(normalizarIp("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizarIp("2001:db8::8a2e:370:7334"), "2001:db8::8a2e:370:7334");
  assert.equal(normalizarIp("999.1.1.1"), null);
  assert.equal(normalizarIp("localhost"), null);
  assert.equal(normalizarIp("1::2::3"), null);
  assert.equal(normalizarIp(""), null);
  assert.equal(normalizarIp(null), null);
});

test("ehLoopback: 127/8, ::1 e ::ffff:127.x", () => {
  for (const ip of ["127.0.0.1", "127.9.9.9", "::1", "0:0:0:0:0:0:0:1", "[::1]", "::ffff:127.0.0.1"]) assert.equal(ehLoopback(ip), true, ip);
  for (const ip of ["192.168.0.10", "10.0.0.1", "::", "::2", "::ffff:192.168.0.5", "fe80::1", "128.0.0.1", "lixo"]) assert.equal(ehLoopback(ip), false, ip);
});

test("ipDoCliente: só confia no cabeçalho com FDA_IP_CONFIAVEL=1 ou na Vercel", () => {
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "192.168.0.7" }), CONFIAVEL), "192.168.0.7");
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "2804:14c::1" }), { VERCEL: "1" }), "2804:14c::1");
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "::ffff:127.0.0.1" }), CONFIAVEL), "127.0.0.1");
  // Cabeçalho falso sem fonte confiável: ignorado.
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "127.0.0.1" }), SEM_FONTE), null);
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "127.0.0.1" }), { FDA_IP_CONFIAVEL: "0" }), null);
  assert.equal(ipDoCliente(h({}), CONFIAVEL), null);
});

test("ipDoCliente: numa lista, vale o último (o que a fonte confiável escreveu)", () => {
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "127.0.0.1, 192.168.0.9" }), CONFIAVEL), "192.168.0.9");
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "1.2.3.4,10.0.0.3 , " }), CONFIAVEL), "10.0.0.3");
});

test("ipInformado: sem fonte confiável devolve o valor recebido (só para limite e histórico)", () => {
  assert.equal(ipInformado(h({ "x-forwarded-for": "192.168.0.50" }), SEM_FONTE), "192.168.0.50");
  assert.equal(ipInformado(h({}), SEM_FONTE), null);
});

test("hostSemPorta", () => {
  assert.equal(hostSemPorta("localhost:3000"), "localhost");
  assert.equal(hostSemPorta("LOCALHOST"), "localhost");
  assert.equal(hostSemPorta("[::1]:3000"), "[::1]");
  assert.equal(hostSemPorta("192.168.0.10:3000"), "192.168.0.10");
  assert.equal(hostSemPorta(null), "");
});

test("ehLocal com fonte confiável: Host localhost e IP de loopback", () => {
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" }), CONFIAVEL), true);
  assert.equal(ehLocal(h({ host: "[::1]:3000", "x-forwarded-for": "::1" }), CONFIAVEL), true);
  assert.equal(ehLocal(h({ host: "127.0.0.1:3000", "x-forwarded-for": "::ffff:127.0.0.1" }), CONFIAVEL), true);
  // Celular na rede da loja, mesmo mandando Host: localhost.
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "192.168.0.23" }), CONFIAVEL), false);
  // Lista: o aparelho inventou 127.0.0.1 e o invólucro acrescentou o IP real.
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 192.168.0.23" }), CONFIAVEL), false);
  // Sem IP nenhum com fonte confiável: não dá para saber → não é local.
  assert.equal(ehLocal(h({ host: "localhost:3000" }), CONFIAVEL), false);
});

test("ehLocal exige o endereço localhost no Host (DNS rebinding e acesso pela rede)", () => {
  assert.equal(ehLocal(h({ host: "192.168.0.10:3000", "x-forwarded-for": "127.0.0.1" }), CONFIAVEL), false);
  assert.equal(ehLocal(h({ host: "site-de-fora.com:3000", "x-forwarded-for": "127.0.0.1" }), CONFIAVEL), false);
  assert.equal(ehLocal(h({ host: "localhost.site-de-fora.com", "x-forwarded-for": "127.0.0.1" }), CONFIAVEL), false);
  assert.equal(ehLocal(h({ "x-forwarded-for": "127.0.0.1" }), CONFIAVEL), false);
});

test("ehLocal sem fonte confiável (desenvolvimento): cabeçalho ausente ou só loopback", () => {
  assert.equal(ehLocal(h({ host: "localhost:3000" }), SEM_FONTE), true);
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "::1" }), SEM_FONTE), true);
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }), SEM_FONTE), true);
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "192.168.0.23" }), SEM_FONTE), false);
  assert.equal(ehLocal(h({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 192.168.0.23" }), SEM_FONTE), false);
  // Cabeçalho falso vindo de outro aparelho pelo endereço da rede: não passa.
  assert.equal(ehLocal(h({ host: "192.168.0.10:3000", "x-forwarded-for": "127.0.0.1" }), SEM_FONTE), false);
});

test("ehLocal na Vercel: nunca é o computador do servidor", () => {
  assert.equal(ehLocal(h({ host: "fiodeamor.vercel.app", "x-forwarded-for": "177.10.20.30" }), { VERCEL: "1" }), false);
});
