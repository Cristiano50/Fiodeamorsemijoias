import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, scryptSync } from "node:crypto";
import {
  conferirSenha,
  conferirToken,
  criarToken,
  hashFicticio,
  hashSenha,
  impressaoSenhaEquipe,
  lerSemConferir,
  problemaSenhaNova,
  textosIguais,
  validadeDias,
} from "../src/lib/sessao";

const CHAVE = "chave-de-teste-com-32-caracteres-ou-mais-0123456789";
const DIA = 86_400_000;
const AGORA = Date.UTC(2026, 10, 15, 12);
const ana = { u: "usr_ana", n: "Ana Teste", p: "funcionario" as const, s: 3 };

test("cookie: ida e volta com id, versão da sessão e data de emissão", () => {
  const token = criarToken(ana, CHAVE, { validadeDias: 14, agora: AGORA });
  const d = conferirToken(token, CHAVE, { validadeDias: 14, agora: AGORA + DIA });
  assert.ok(d);
  assert.equal(d.u, "usr_ana");
  assert.equal(d.s, 3);
  assert.equal(d.i, AGORA);
  assert.equal(d.e, AGORA + 14 * DIA);
  assert.deepEqual(lerSemConferir(token)?.u, "usr_ana");
});

test("cookie: assinatura errada, chave errada, conteúdo trocado e formato antigo não valem", () => {
  const token = criarToken(ana, CHAVE, { validadeDias: 14, agora: AGORA });
  const [dados, sig] = token.split(".");
  assert.equal(conferirToken(token, "outra-chave", { validadeDias: 14, agora: AGORA }), null);
  assert.equal(conferirToken(`${dados}.${sig.slice(0, -2)}xx`, CHAVE, { validadeDias: 14, agora: AGORA }), null);
  // Promover a si mesma a gestora sem a chave: assinatura não bate.
  const falso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(dados, "base64url").toString()), p: "gestora" })).toString("base64url");
  assert.equal(conferirToken(`${falso}.${sig}`, CHAVE, { validadeDias: 14, agora: AGORA }), null);
  // Assinatura com caracteres de vários bytes (mesmo tamanho em letras): não pode derrubar o servidor.
  assert.equal(conferirToken(`${dados}.${"é".repeat(sig.length)}`, CHAVE, { validadeDias: 14, agora: AGORA }), null);
  // Formato antigo { u, n, p, e } assinado com a mesma chave: recusado (todo mundo entra de novo uma vez).
  const antigo = Buffer.from(JSON.stringify({ u: "usr_ana", n: "Ana", p: "gestora", e: AGORA + DIA })).toString("base64url");
  const sigAntiga = createHmac("sha256", CHAVE).update(antigo).digest("base64url");
  assert.equal(conferirToken(`${antigo}.${sigAntiga}`, CHAVE, { validadeDias: 14, agora: AGORA }), null);
  for (const lixo of ["", "a", "a.b.c", "....", undefined, null]) assert.equal(conferirToken(lixo as string, CHAVE, { validadeDias: 14, agora: AGORA }), null);
  assert.equal(conferirToken(token, "", { validadeDias: 14, agora: AGORA }), null, "sem chave nunca vale");
});

test("cookie: validade pela configuração, inclusive quando ela diminui depois do login", () => {
  const token = criarToken(ana, CHAVE, { validadeDias: 14, agora: AGORA });
  assert.ok(conferirToken(token, CHAVE, { validadeDias: 14, agora: AGORA + 13 * DIA }));
  assert.equal(conferirToken(token, CHAVE, { validadeDias: 14, agora: AGORA + 14 * DIA }), null, "venceu");
  assert.equal(conferirToken(token, CHAVE, { validadeDias: 2, agora: AGORA + 3 * DIA }), null, "validade diminuída vale na hora");
  assert.equal(conferirToken(token, CHAVE, { validadeDias: 30, agora: AGORA + 20 * DIA }), null, "aumentar não estica o cookie já emitido");
  assert.equal(conferirToken(token, CHAVE, { validadeDias: 14, agora: AGORA - DIA }), null, "emitido no futuro");
});

test("validadeDias: 1 a 365, padrão 14", () => {
  assert.equal(validadeDias(14), 14);
  assert.equal(validadeDias("7"), 7);
  assert.equal(validadeDias(0), 14);
  assert.equal(validadeDias(-3), 14);
  assert.equal(validadeDias("abc"), 14);
  assert.equal(validadeDias(undefined), 14);
  assert.equal(validadeDias(9999), 365);
});

test("senha da equipe: impressão muda quando a senha muda e não revela a senha", () => {
  const a = impressaoSenhaEquipe("senha-da-loja-1", CHAVE);
  assert.equal(a, impressaoSenhaEquipe("senha-da-loja-1", CHAVE));
  assert.notEqual(a, impressaoSenhaEquipe("senha-da-loja-2", CHAVE));
  assert.notEqual(a, impressaoSenhaEquipe("senha-da-loja-1", "outra-chave"));
  assert.ok(!a.includes("senha"));
});

test("textosIguais", () => {
  assert.equal(textosIguais("abc", "abc"), true);
  assert.equal(textosIguais("abc", "abd"), false);
  assert.equal(textosIguais("abc", "abcd"), false);
  assert.equal(textosIguais("", ""), true);
});

test("senha nova: pelo menos 8 caracteres", () => {
  assert.match(problemaSenhaNova("1234567") ?? "", /pelo menos 8/);
  assert.equal(problemaSenhaNova("12345678"), null);
  assert.ok(problemaSenhaNova(undefined));
  assert.ok(problemaSenhaNova("x".repeat(201)));
});

test("scrypt assíncrono: confere o hash novo e os hashes antigos (scryptSync)", async () => {
  const h = await hashSenha("senha-boa-123");
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await conferirSenha("senha-boa-123", h), true);
  assert.equal(await conferirSenha("senha-errada", h), false);
  // Hash gravado pela versão anterior (scryptSync com o mesmo formato): usuários antigos continuam entrando.
  const sal = "00112233445566778899aabbccddeeff";
  const antigo = `scrypt$${sal}$${scryptSync("curta", sal, 64).toString("hex")}`;
  assert.equal(await conferirSenha("curta", antigo), true, "senha curta antiga continua valendo");
  assert.equal(await conferirSenha("x", "formato-estranho"), false);
  assert.equal(await conferirSenha("qualquer", await hashFicticio()), false);
});

test("scrypt assíncrono não trava o servidor enquanto confere", async () => {
  const h = await hashSenha("outra-senha-1");
  let ticks = 0;
  const relogio = setInterval(() => ticks++, 1);
  await Promise.all([conferirSenha("outra-senha-1", h), conferirSenha("x", h), conferirSenha("y", h)]);
  clearInterval(relogio);
  assert.ok(ticks > 0, "o laço de eventos continuou rodando");
});
