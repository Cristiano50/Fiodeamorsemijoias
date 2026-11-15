import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * instalador/servidor-seguro.cjs: com um server.js de mentira (no lugar do server.js do Next), o cabeçalho
 * X-Forwarded-For/X-Real-IP/Forwarded que o aparelho manda some e o IP real da conexão é gravado.
 */
const INVOLUCRO = path.resolve(__dirname, "..", "instalador", "servidor-seguro.cjs");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { limparCabecalhos, proteger, CABECALHOS_DE_PROXY, acessoPeloTunel } = require(INVOLUCRO) as {
  limparCabecalhos: (req: unknown) => unknown;
  acessoPeloTunel: (req: unknown) => { ip: string; proto: string } | null;
  proteger: (classe: { prototype: { emit: (...a: unknown[]) => unknown } }) => void;
  CABECALHOS_DE_PROXY: string[];
};

const SERVER_FALSO = `
const http = require("node:http");
const s = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ headers: req.headers, raw: req.rawHeaders, confiavel: process.env.FDA_IP_CONFIAVEL ?? null }));
});
s.listen(0, "127.0.0.1", () => console.log("PORTA " + s.address().port));
`;

type Eco = { headers: Record<string, string | string[]>; raw: string[]; confiavel: string | null };

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fda-involucro-"));
  fs.copyFileSync(INVOLUCRO, path.join(dir, "servidor-seguro.cjs"));
  fs.writeFileSync(path.join(dir, "server.js"), SERVER_FALSO);
  const filho = spawn(process.execPath, ["servidor-seguro.cjs"], { cwd: dir, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  const porta = await new Promise<number>((resolve, reject) => {
    let saida = "";
    const t = setTimeout(() => reject(new Error(`o servidor de mentira não subiu: ${saida}`)), 15000);
    filho.stdout.on("data", (b) => {
      saida += String(b);
      const m = /PORTA (\d+)/.exec(saida);
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
    filho.stderr.on("data", (b) => (saida += String(b)));
    filho.once("exit", (c) => reject(new Error(`o servidor de mentira parou (código ${c}): ${saida}`)));
  });
  return {
    porta,
    parar: () => {
      filho.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** GET com cabeçalhos repetidos (dois X-Forwarded-For), como um aparelho mal-intencionado mandaria. */
function pedir(porta: number, cabecalhos: http.OutgoingHttpHeaders): Promise<Eco> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: porta, path: "/entrar", headers: cabecalhos }, (res) => {
      let corpo = "";
      res.on("data", (b) => (corpo += String(b)));
      res.on("end", () => resolve(JSON.parse(corpo) as Eco));
    });
    req.on("error", reject);
    req.end();
  });
}

test("invólucro: apaga X-Forwarded-For/X-Real-IP/Forwarded falsos e grava o IP real; liga FDA_IP_CONFIAVEL", async () => {
  const s = await subir();
  try {
    const r = await pedir(s.porta, {
      "X-Forwarded-For": ["6.6.6.6", "127.0.0.1"],
      "X-Real-IP": "7.7.7.7",
      Forwarded: "for=8.8.8.8",
      "X-Forwarded-Host": "site-falso.com",
      "X-Client-IP": "9.9.9.9",
      "X-Forwarded-Proto": "https",
    });
    assert.equal(r.headers["x-forwarded-for"], "127.0.0.1");
    for (const nome of ["x-real-ip", "forwarded", "x-forwarded-host", "x-client-ip", "x-forwarded-proto", "x-fda-ignorado"]) {
      assert.equal(r.headers[nome], undefined, `${nome} devia ter sido apagado`);
    }
    assert.equal(r.confiavel, "1");
    // rawHeaders também sem os valores falsos (só o IP real aparece).
    const valores = r.raw.filter((_, i) => i % 2 === 1);
    for (const falso of ["6.6.6.6", "7.7.7.7", "for=8.8.8.8", "site-falso.com", "9.9.9.9", "https"]) assert.ok(!valores.includes(falso), `${falso} ficou em rawHeaders`);
    assert.equal(r.raw.filter((v, i) => i % 2 === 0 && v.toLowerCase() === "x-forwarded-for").length, 1);

    const semNada = await pedir(s.porta, { Accept: "application/json" });
    assert.equal(semNada.headers["x-forwarded-for"], "127.0.0.1");
    assert.equal(semNada.headers.accept, "application/json");
  } finally {
    s.parar();
  }
});

test("invólucro: limparCabecalhos não muda o tamanho de rawHeaders e não estraga os outros cabeçalhos", () => {
  const raw = ["Host", "loja:3000", "X-Forwarded-For", "1.2.3.4", "Cookie", "a=1", "X-Real-IP", "4.3.2.1"];
  const req = { socket: { remoteAddress: "192.168.0.20" }, rawHeaders: [...raw], headers: { host: "loja:3000", "x-forwarded-for": "1.2.3.4", cookie: "a=1", "x-real-ip": "4.3.2.1" } as Record<string, string> };
  limparCabecalhos(req);
  assert.equal(req.rawHeaders.length, raw.length);
  assert.deepEqual(req.rawHeaders, ["Host", "loja:3000", "X-Forwarded-For", "192.168.0.20", "Cookie", "a=1", "x-fda-ignorado", ""]);
  assert.deepEqual(req.headers, { host: "loja:3000", cookie: "a=1", "x-forwarded-for": "192.168.0.20" });
  // Sem IP do socket (conexão já fechada): só apaga.
  const semIp = { socket: {}, rawHeaders: ["X-Forwarded-For", "1.1.1.1"], headers: { "x-forwarded-for": "1.1.1.1" } as Record<string, string> };
  limparCabecalhos(semIp);
  assert.deepEqual(semIp.headers, {});
  assert.ok(CABECALHOS_DE_PROXY.includes("x-forwarded-for") && CABECALHOS_DE_PROXY.includes("x-real-ip") && CABECALHOS_DE_PROXY.includes("forwarded"));
});

test("invólucro: proteger() não embrulha duas vezes e repassa os outros eventos sem mexer", () => {
  const vistos: unknown[][] = [];
  class Falso {
    emit(...a: unknown[]) {
      vistos.push(a);
      return true;
    }
  }
  proteger(Falso);
  const emitUmaVez = Falso.prototype.emit;
  proteger(Falso);
  assert.equal(Falso.prototype.emit, emitUmaVez);
  const req = { socket: { remoteAddress: "10.0.0.5" }, rawHeaders: ["X-Real-IP", "1.1.1.1"], headers: { "x-real-ip": "1.1.1.1" } as Record<string, string> };
  new Falso().emit("request", req, "res");
  assert.deepEqual(req.headers, { "x-forwarded-for": "10.0.0.5" });
  new Falso().emit("listening");
  assert.equal(vistos.length, 2);
  assert.deepEqual(vistos[1], ["listening"]);
});

test("invólucro: acesso pela internet (cloudflared neste computador) usa o IP de CF-Connecting-IP e https", async () => {
  const s = await subir();
  try {
    // O cloudflared fala com o app por 127.0.0.1 e manda o IP de quem acessou.
    const r = await pedir(s.porta, {
      Host: "app.loja.com.br",
      "Cf-Connecting-Ip": "200.1.2.3",
      "X-Forwarded-For": "200.1.2.3",
      "X-Forwarded-Proto": "https",
      "Cf-Visitor": '{"scheme":"https"}',
      "X-Real-IP": "7.7.7.7",
    });
    assert.equal(r.headers["x-forwarded-for"], "200.1.2.3");
    assert.equal(r.headers["x-forwarded-proto"], "https");
    assert.equal(r.headers.host, "app.loja.com.br");
    for (const nome of ["cf-connecting-ip", "x-real-ip", "x-fda-ignorado"]) assert.equal(r.headers[nome], undefined, `${nome} devia ter sido apagado`);
  } finally {
    s.parar();
  }
});

test("invólucro: CF-Connecting-IP só vale vindo deste computador e com IP válido", () => {
  // Aparelho da rede da loja tentando se passar por acesso do túnel: ignorado.
  const daRede = {
    socket: { remoteAddress: "192.168.0.20" },
    rawHeaders: ["Cf-Connecting-Ip", "127.0.0.1", "X-Forwarded-Proto", "https"],
    headers: { "cf-connecting-ip": "127.0.0.1", "x-forwarded-proto": "https" } as Record<string, string>,
  };
  assert.equal(acessoPeloTunel(daRede), null);
  limparCabecalhos(daRede);
  assert.deepEqual(daRede.headers, { "x-forwarded-for": "192.168.0.20" });
  // Deste computador, mas sem IP válido: vale o 127.0.0.1 e nada de https.
  const invalido = { socket: { remoteAddress: "127.0.0.1" }, rawHeaders: ["Cf-Connecting-Ip", "x; drop"], headers: { "cf-connecting-ip": "x; drop" } as Record<string, string> };
  limparCabecalhos(invalido);
  assert.deepEqual(invalido.headers, { "x-forwarded-for": "127.0.0.1" });
  // IPv6 do aparelho e o protocolo só pelo CF-Visitor.
  const v6 = { socket: { remoteAddress: "::ffff:127.0.0.1" }, rawHeaders: ["CF-Connecting-IP", "2804:14c::1", "CF-Visitor", '{"scheme":"https"}'], headers: {} as Record<string, string> };
  assert.deepEqual(acessoPeloTunel(v6), { ip: "2804:14c::1", proto: "https" });
  // http (sem https em lugar nenhum) fica http.
  assert.deepEqual(acessoPeloTunel({ socket: { remoteAddress: "127.0.0.1" }, rawHeaders: ["Cf-Connecting-Ip", "200.1.2.3"] }), { ip: "200.1.2.3", proto: "http" });
});
