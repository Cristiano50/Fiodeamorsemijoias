import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { conferirEstrutura, copiarReal, procurarLinks, removerNativosDeOutrosSistemas, testeDeFumaca } from "../instalador/empacotar-funcoes.mjs";

/** Funções do empacotador do Windows (instalador/empacotar-funcoes.mjs), sem montar o pacote de verdade. */

const temp = (nome: string) => fs.mkdtempSync(path.join(os.tmpdir(), `fda-${nome}-`));
const escrever = (arquivo: string, texto = "x") => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, texto);
};

test("copiarReal: troca links simbólicos (absolutos, relativos, de pasta e de arquivo, em qualquer nível) pelo conteúdo", () => {
  const base = temp("copia");
  try {
    // Como o Next deixa em .next/standalone/.next/node_modules: links absolutos para node_modules/<pacote>.
    escrever(path.join(base, "real", "sharp", "lib", "index.js"), "module.exports = 1");
    escrever(path.join(base, "real", "sharp", "package.json"), '{"name":"sharp"}');
    escrever(path.join(base, "real", "client", "index.js"), "cliente");
    escrever(path.join(base, "origem", "server.js"), "servidor");
    fs.mkdirSync(path.join(base, "origem", ".next", "node_modules", "@libsql"), { recursive: true });
    fs.symlinkSync(path.join(base, "real", "sharp"), path.join(base, "origem", ".next", "node_modules", "sharp-20c6a5da84e2135f"));
    fs.symlinkSync(path.join("..", "..", "..", "..", "real", "client"), path.join(base, "origem", ".next", "node_modules", "@libsql", "client-6da938047d5fc1cd"));
    fs.symlinkSync(path.join(base, "real", "client", "index.js"), path.join(base, "origem", "atalho.js"));
    assert.equal(procurarLinks(path.join(base, "origem")).length, 3);

    copiarReal(path.join(base, "origem"), path.join(base, "destino"));
    const destino = path.join(base, "destino");
    assert.deepEqual(procurarLinks(destino), []);
    const sharp = path.join(destino, ".next", "node_modules", "sharp-20c6a5da84e2135f");
    assert.ok(fs.lstatSync(sharp).isDirectory() && !fs.lstatSync(sharp).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(sharp, "lib", "index.js"), "utf8"), "module.exports = 1");
    assert.equal(fs.readFileSync(path.join(destino, ".next", "node_modules", "@libsql", "client-6da938047d5fc1cd", "index.js"), "utf8"), "cliente");
    assert.ok(fs.lstatSync(path.join(destino, "atalho.js")).isFile());
    assert.equal(fs.readFileSync(path.join(destino, "server.js"), "utf8"), "servidor");
    // Arquivo sozinho também (server.js, package.json do standalone).
    copiarReal(path.join(base, "origem", "atalho.js"), path.join(base, "so-arquivo", "atalho.js"));
    assert.ok(fs.lstatSync(path.join(base, "so-arquivo", "atalho.js")).isFile());
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("copiarReal: link quebrado ou em ciclo interrompe com mensagem; o filtro deixa coisas de fora", () => {
  const base = temp("copia-erro");
  try {
    escrever(path.join(base, "a", "ok.txt"));
    fs.symlinkSync(path.join(base, "nao-existe"), path.join(base, "a", "quebrado"));
    assert.throws(() => copiarReal(path.join(base, "a"), path.join(base, "b")), /quebrado/);

    escrever(path.join(base, "c", "d", "ok.txt"));
    fs.symlinkSync(path.join(base, "c"), path.join(base, "c", "d", "volta"));
    assert.throws(() => copiarReal(path.join(base, "c"), path.join(base, "e")), /ciclo/);

    escrever(path.join(base, "skill", "scripts", "x.py"));
    escrever(path.join(base, "skill", "scripts", "__pycache__", "x.pyc"));
    copiarReal(path.join(base, "skill"), path.join(base, "skill-copia"), { filtro: (f) => !/__pycache__/.test(f) });
    assert.ok(fs.existsSync(path.join(base, "skill-copia", "scripts", "x.py")));
    assert.ok(!fs.existsSync(path.join(base, "skill-copia", "scripts", "__pycache__")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("removerNativosDeOutrosSistemas: tira linux/musl/darwin em qualquer node_modules e mantém os do Windows", () => {
  const base = temp("nativos");
  try {
    for (const p of [
      "node_modules/@img/sharp-linux-x64/lib/sharp.node",
      "node_modules/@img/sharp-libvips-linuxmusl-x64/lib/x.so",
      "node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node",
      "node_modules/@img/colour/index.js",
      "node_modules/@libsql/linux-x64-gnu/index.node",
      "node_modules/@libsql/darwin-arm64/index.node",
      "node_modules/@libsql/win32-x64-msvc/index.node",
      "node_modules/@libsql/client/index.js",
      ".next/node_modules/sharp-20c6/node_modules/@img/sharp-linux-x64/x.node",
      ".next/node_modules/@libsql/client-6da9/index.js",
    ]) {
      escrever(path.join(base, p));
    }
    const apagados = removerNativosDeOutrosSistemas(base).sort();
    assert.equal(apagados.length, 5);
    const ficou = (p: string) => fs.existsSync(path.join(base, p));
    assert.ok(!ficou("node_modules/@img/sharp-linux-x64") && !ficou("node_modules/@libsql/linux-x64-gnu") && !ficou("node_modules/@libsql/darwin-arm64"));
    assert.ok(!ficou(".next/node_modules/sharp-20c6/node_modules/@img/sharp-linux-x64"));
    assert.ok(ficou("node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node") && ficou("node_modules/@libsql/win32-x64-msvc/index.node"));
    assert.ok(ficou("node_modules/@img/colour/index.js") && ficou("node_modules/@libsql/client/index.js") && ficou(".next/node_modules/@libsql/client-6da9/index.js"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/** Pacote do Windows de mentira, completo. */
function montarPacote(base: string) {
  const s = path.join(base, "FioDeAmor");
  for (const p of [
    "app/server.js",
    "app/servidor-seguro.cjs",
    "app/package.json",
    "app/.next/BUILD_ID",
    "app/.next/server/app/entrar.html",
    "app/.next/static/chunks/a.js",
    "app/public/marca/logo.png",
    "app/node_modules/@libsql/win32-x64-msvc/index.node",
    "app/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node",
    "node/node.exe",
    "abrir.ps1",
    "LEIA-ME.txt",
    "fiodeamor.ico",
  ]) {
    escrever(path.join(s, p));
  }
  escrever(path.join(s, "servidor.cmd"), '"%BASE%node\\node.exe" servidor-seguro.cjs');
  const xml = '<?xml version="1.0" encoding="UTF-16"?><Task><Principals><Principal><UserId>S-1-5-19</UserId></Principal></Principals></Task>';
  fs.writeFileSync(path.join(s, "tarefa.xml"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
  return s;
}

test("conferirEstrutura: pacote completo passa; o que falta aparece explicado", () => {
  const base = temp("estrutura");
  try {
    const s = montarPacote(base);
    assert.deepEqual(conferirEstrutura(s, { windows: true }), []);

    fs.rmSync(path.join(s, "app", "servidor-seguro.cjs"));
    fs.rmSync(path.join(s, "node", "node.exe"));
    fs.rmSync(path.join(s, "app", "node_modules", "@libsql", "win32-x64-msvc", "index.node"));
    escrever(path.join(s, "app", "node_modules", "@img", "sharp-linux-x64", "lib", "x.node"));
    fs.symlinkSync(path.join(base, "fora"), path.join(s, "app", "link-solto"));
    fs.writeFileSync(path.join(s, "tarefa.xml"), "<UserId>S-1-5-18</UserId>"); // UTF-8 e SYSTEM
    const problemas = conferirEstrutura(s, { windows: true }).join("\n");
    assert.match(problemas, /servidor-seguro\.cjs/);
    assert.match(problemas, /node\.exe/);
    assert.match(problemas, /win32-x64-msvc/);
    assert.match(problemas, /sharp-linux-x64/);
    assert.match(problemas, /links simbólicos.*link-solto/);
    assert.match(problemas, /UTF-16/);
    // No teste do Linux (--linux) não se exige node.exe nem módulos do Windows.
    assert.doesNotMatch(conferirEstrutura(s, { windows: false }).join("\n"), /node\.exe|win32/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

const SERVIDOR_FALSO = (statusSessao: number) => `
const http = require("node:http");
// O teste de fumaça nunca pode levar o banco de verdade: sem DATABASE_URL e com FDA_DADOS temporária.
const ambienteLimpo = !process.env.DATABASE_URL && !process.env.ANTHROPIC_API_KEY && !!process.env.FDA_DADOS && process.env.HOSTNAME === "127.0.0.1";
http.createServer((req, res) => {
  if (!ambienteLimpo) { res.statusCode = 500; return res.end("ambiente sujo"); }
  if (req.url === "/entrar") { res.statusCode = 200; return res.end("<html>entrar</html>"); }
  if (req.url === "/api/sessao?modo=1") { res.statusCode = ${statusSessao}; return res.end('{"modo":"aberto"}'); }
  res.statusCode = 404; res.end();
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

test("testeDeFumaca: sobe o servidor numa porta livre com dados temporários e confere as respostas 200", async () => {
  const base = temp("fumaca");
  const antes = { url: process.env.DATABASE_URL, chave: process.env.ANTHROPIC_API_KEY };
  process.env.DATABASE_URL = "libsql://banco-de-verdade.turso.io";
  process.env.ANTHROPIC_API_KEY = "sk-nao-pode-vazar";
  try {
    escrever(path.join(base, "ok", "server.js"), SERVIDOR_FALSO(200));
    const r = await testeDeFumaca({ servidor: path.join(base, "ok", "server.js"), tempoMaximo: 15000 });
    assert.deepEqual(r.respostas, { "/entrar": 200, "/api/sessao?modo=1": 200 });

    escrever(path.join(base, "erro", "server.js"), SERVIDOR_FALSO(500));
    await assert.rejects(testeDeFumaca({ servidor: path.join(base, "erro", "server.js"), tempoMaximo: 15000 }), /diferente de 200.*\/api\/sessao/);

    escrever(path.join(base, "cai", "server.js"), 'console.error("Error: Cannot find module \'@libsql/linux-x64-gnu\'"); process.exit(3);');
    await assert.rejects(testeDeFumaca({ servidor: path.join(base, "cai", "server.js"), tempoMaximo: 15000 }), /parou sozinho \(código 3\)[\s\S]*linux-x64-gnu/);
  } finally {
    if (antes.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = antes.url;
    if (antes.chave === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = antes.chave;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
