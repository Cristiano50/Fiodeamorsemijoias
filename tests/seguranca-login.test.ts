import { test } from "node:test";
import assert from "node:assert/strict";
import { ESQUECER_APOS_MS, aposFalha, bloqueioMs, chavesTentativa, mensagemBloqueio, restanteMs, type Tentativa } from "../src/lib/login-limite";

const MIN = 60_000;
const AGORA = Date.UTC(2026, 10, 15, 12);

/** Simula N falhas seguidas, uma por segundo. */
function falhar(n: number, inicio: Tentativa | null = null, t0 = AGORA) {
  let t: Tentativa | null = inicio;
  for (let i = 0; i < n; i++) t = aposFalha(t, t0 + i * 1000);
  return t!;
}

test("bloqueio progressivo: 5 → 1 min, 10 → 15 min, 20 → 1 h", () => {
  assert.equal(bloqueioMs(0), 0);
  assert.equal(bloqueioMs(4), 0);
  assert.equal(bloqueioMs(5), MIN);
  assert.equal(bloqueioMs(9), MIN);
  assert.equal(bloqueioMs(10), 15 * MIN);
  assert.equal(bloqueioMs(19), 15 * MIN);
  assert.equal(bloqueioMs(20), 60 * MIN);
  assert.equal(bloqueioMs(500), 60 * MIN);
});

test("as 4 primeiras falhas não bloqueiam; a 5ª bloqueia por 1 minuto", () => {
  const quatro = falhar(4);
  assert.equal(quatro.falhas, 4);
  assert.equal(quatro.bloqueadoAte, null);
  const cinco = aposFalha(quatro, AGORA + 10_000);
  assert.equal(cinco.falhas, 5);
  assert.equal(restanteMs(cinco, AGORA + 10_000), MIN);
  assert.equal(restanteMs(cinco, AGORA + 10_000 + MIN), 0, "passou o minuto");
});

test("depois de 10 e de 20 falhas o bloqueio cresce", () => {
  const dez = falhar(10);
  assert.equal(restanteMs(dez, AGORA + 9000), 15 * MIN);
  const vinte = falhar(20);
  assert.equal(restanteMs(vinte, AGORA + 19_000), 60 * MIN);
});

test("o contador recomeça 24 h depois da última falha", () => {
  const nove = falhar(9);
  const depois = aposFalha(nove, AGORA + 9000 + ESQUECER_APOS_MS + 1);
  assert.equal(depois.falhas, 1);
  assert.equal(depois.bloqueadoAte, null);
  const logo = aposFalha(nove, AGORA + 9000 + 60 * MIN);
  assert.equal(logo.falhas, 10, "dentro das 24 h, soma");
});

test("estado estragado na tabela não quebra a conta", () => {
  assert.equal(aposFalha({ falhas: Number.NaN, bloqueadoAte: "lixo", atualizadoEm: "lixo" }, AGORA).falhas, 1);
  assert.equal(restanteMs({ bloqueadoAte: "lixo" }, AGORA), 0);
  assert.equal(restanteMs(null, AGORA), 0);
});

test("mensagem: Muitas tentativas. Tente de novo em X minutos.", () => {
  assert.equal(mensagemBloqueio(MIN), "Muitas tentativas. Tente de novo em 1 minuto.");
  assert.equal(mensagemBloqueio(5000), "Muitas tentativas. Tente de novo em 1 minuto.");
  assert.equal(mensagemBloqueio(14 * MIN + 1), "Muitas tentativas. Tente de novo em 15 minutos.");
  assert.equal(mensagemBloqueio(60 * MIN), "Muitas tentativas. Tente de novo em 60 minutos.");
});

test("chaves por IP e por login", () => {
  assert.deepEqual(chavesTentativa("192.168.0.5", " Ana "), ["ip:192.168.0.5", "login:ana"]);
  assert.deepEqual(chavesTentativa(null, ""), ["ip:desconhecido", "login:(vazio)"]);
  assert.ok(chavesTentativa("1.1.1.1", "x".repeat(500))[1].length <= 106);
});
