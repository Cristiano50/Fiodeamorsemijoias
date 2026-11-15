#!/usr/bin/env node
/**
 * Monta o instalador do Windows do app Fio de Amor (computador-servidor da loja).
 *
 *   node instalador/empacotar.mjs                 # compila, monta, testa e gera dist/FioDeAmor-Instalador-<versão>.exe
 *   node instalador/empacotar.mjs --sem-build     # reaproveita o .next/standalone já compilado
 *   node instalador/empacotar.mjs --linux         # monta a mesma estrutura para teste no Linux (sem .exe)
 *   node instalador/empacotar.mjs --sem-teste     # pula só o teste que sobe o servidor (a conferência da estrutura continua)
 *
 * Precisa de: Node 22, npm (baixa do registro npm o Node.js para Windows e os módulos nativos win32) e makensis (NSIS).
 * O pacote leva SÓ o que o app precisa (lista fechada). Pastas com dados reais — amostras/, dados/ — nunca entram.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conferirEstrutura, copiarReal, procurarLinks, removerNativosDeOutrosSistemas, testeDeFumaca } from "./empacotar-funcoes.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const linux = args.has("--linux");
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
const versao = pkg.version;
const VERSAO_NODE = "22.23.4"; // Node.js para Windows (pacote npm node-win-x64)
const cache = path.join(raiz, "instalador", ".cache");
const dist = path.join(raiz, "dist");
const stage = path.join(dist, linux ? "linux" : "windows", "FioDeAmor");
const app = path.join(stage, "app");
const standalone = path.join(raiz, ".next", "standalone");

const log = (m) => console.log(`» ${m}`);
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: "inherit", cwd: raiz, ...opts });
// Copia o conteúdo de verdade: o Next cria links simbólicos absolutos em .next/standalone/.next/node_modules.
const copiar = (de, para, opcoes) => copiarReal(de, para, opcoes);

// 1. Compilação autônoma (servidor Node sem precisar do npm no computador da loja)
if (!args.has("--sem-build")) {
  log("Compilando o app (modo autônomo)…");
  sh("npx", ["next", "build"], { env: { ...process.env, FDA_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } });
}
if (!fs.existsSync(path.join(standalone, "server.js"))) throw new Error("Falta .next/standalone/server.js: rode sem --sem-build.");

// 2. Lista fechada do que vai no pacote
log(`Montando ${path.relative(raiz, stage)}…`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
for (const item of ["server.js", "package.json", ".next", "node_modules"]) copiar(path.join(standalone, item), path.join(app, item));
copiar(path.join(raiz, ".next", "static"), path.join(app, ".next", "static"));
copiar(path.join(raiz, "public"), path.join(app, "public"));
copiar(path.join(raiz, "docs", "especialistas"), path.join(app, "docs", "especialistas"));
copiar(path.join(raiz, "skill", "fiodeamor-cadastro"), path.join(app, "skill", "fiodeamor-cadastro"), {
  filtro: (f) => !/(__pycache__|[\\/]testes([\\/]|$)|\.pyc$)/.test(f),
});
fs.rmSync(path.join(app, ".next", "cache"), { recursive: true, force: true }); // o instalador cria vazia, com permissão de gravação
// Invólucro que apaga X-Forwarded-For/X-Real-IP falsos e grava o IP real antes do Next (servidor.cmd roda este arquivo).
fs.copyFileSync(path.join(raiz, "instalador", "servidor-seguro.cjs"), path.join(app, "servidor-seguro.cjs"));

// 3. Módulos nativos do Windows no lugar dos do Linux (em todo node_modules, inclusive as cópias em .next/node_modules)
if (!linux) {
  const nm = path.join(app, "node_modules");
  const apagados = removerNativosDeOutrosSistemas(app);
  if (apagados.length) log(`Módulos nativos de outros sistemas removidos: ${apagados.length}`);
  const versaoDe = (p) => JSON.parse(fs.readFileSync(path.join(raiz, "node_modules", p, "package.json"), "utf8")).version;
  const nativos = [
    ["@libsql/win32-x64-msvc", versaoDe("libsql")],
    ["@img/sharp-win32-x64", versaoDe("sharp")],
    ["node-win-x64", VERSAO_NODE],
  ];
  fs.mkdirSync(cache, { recursive: true });
  for (const [nome, v] of nativos) {
    const arquivo = path.join(cache, `${nome.replace("@", "").replace("/", "-")}-${v}.tgz`);
    if (!fs.existsSync(arquivo)) {
      log(`Baixando ${nome}@${v} do registro npm…`);
      const saida = execFileSync("npm", ["pack", `${nome}@${v}`, "--pack-destination", cache, "--silent"], { cwd: cache }).toString().trim().split("\n").pop();
      fs.renameSync(path.join(cache, saida), arquivo);
    }
    const destino = nome === "node-win-x64" ? path.join(stage, ".node-pkg") : path.join(nm, nome);
    fs.mkdirSync(destino, { recursive: true });
    sh("tar", ["xzf", arquivo, "-C", destino, "--strip-components=1"]);
  }
  fs.mkdirSync(path.join(stage, "node"), { recursive: true });
  fs.renameSync(path.join(stage, ".node-pkg", "bin", "node.exe"), path.join(stage, "node", "node.exe"));
  for (const f of ["LICENSE", "LICENSE.md", "README.md"]) {
    const de = path.join(stage, ".node-pkg", f);
    if (fs.existsSync(de)) fs.copyFileSync(de, path.join(stage, "node", f));
  }
  fs.rmSync(path.join(stage, ".node-pkg"), { recursive: true, force: true });
}

// 4. Arquivos do Windows (inicialização, atalho, tarefa agendada)
for (const f of ["servidor.cmd", "abrir.ps1", "LEIA-ME.txt", "fiodeamor.ico"]) fs.copyFileSync(path.join(raiz, "instalador", f), path.join(stage, f));
// O Agendador de Tarefas do Windows lê o XML em UTF-16 com BOM.
const xml = fs.readFileSync(path.join(raiz, "instalador", "tarefa.xml"), "utf8");
fs.writeFileSync(path.join(stage, "tarefa.xml"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml.replace(/\r?\n/g, "\r\n"), "utf16le")]));
for (const f of ["servidor.cmd", "LEIA-ME.txt", "abrir.ps1"]) {
  const p = path.join(stage, f);
  const texto = fs.readFileSync(p, "utf8").replace(/\r?\n/g, "\r\n"); // fim de linha do Windows
  // O PowerShell 5 do Windows só lê acentos de .ps1 em UTF-8 com BOM.
  fs.writeFileSync(p, f.endsWith(".ps1") ? "﻿" + texto : texto);
}

// 5. Conferência de segurança: nada de dados reais no pacote
const proibidos = [];
const varrer = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(stage, p);
    if (/(^|[\\/])(amostras|dados(-[^\\/]*)?|\.env[^\\/]*)([\\/]|$)/.test(rel) || /\.db$/.test(e.name)) proibidos.push(rel);
    else if (e.isDirectory()) varrer(p);
  }
};
varrer(stage);
if (proibidos.length) throw new Error(`Pacote com arquivos que não podem sair do computador: ${proibidos.slice(0, 10).join(", ")}`);

// 6. Nenhum link simbólico pode sobrar (no Windows eles não existem: o programa quebraria na loja)
const links = procurarLinks(stage);
if (links.length) {
  throw new Error(`Sobraram ${links.length} link(s) simbólico(s) em ${path.relative(raiz, stage)}: ${links.slice(0, 10).join(", ")}. Copie o conteúdo de verdade (copiarReal).`);
}

const tamanho = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? tamanho(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
log(`Pasta do programa: ${(tamanho(stage) / 1e6).toFixed(0)} MB`);

// 7. Teste de fumaça antes do makensis: estrutura do pacote e o servidor respondendo /entrar
log("Conferindo a estrutura do pacote…");
const problemas = conferirEstrutura(stage, { windows: !linux });
if (problemas.length) throw new Error(`O pacote está incompleto:\n - ${problemas.join("\n - ")}`);
if (!args.has("--sem-teste")) {
  // No pacote do Windows os módulos nativos são do Windows: o teste sobe o .next/standalone (Linux) pelo mesmo invólucro.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fda-servidor-"));
  try {
    let servidor = path.join(app, "servidor-seguro.cjs");
    if (!linux) {
      fs.copyFileSync(path.join(raiz, "instalador", "servidor-seguro.cjs"), path.join(temp, "servidor-seguro.cjs"));
      fs.writeFileSync(path.join(temp, "server.js"), `require(${JSON.stringify(path.join(standalone, "server.js"))});\n`);
      servidor = path.join(temp, "servidor-seguro.cjs");
    }
    log("Subindo o servidor numa porta livre, com uma pasta de dados vazia…");
    const r = await testeDeFumaca({ servidor });
    log(`Servidor respondeu: ${Object.entries(r.respostas).map(([c, s]) => `${c} ${s}`).join(", ")}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

// 8. Instalador .exe (NSIS)
if (!linux) {
  const saida = path.join(dist, `FioDeAmor-Instalador-${versao}.exe`);
  log("Gerando o instalador com o NSIS…");
  sh("makensis", ["-V2", `-DVERSAO=${versao}`, `-DORIGEM=${stage}`, `-DSAIDA=${saida}`, `-DICONE=${path.join(raiz, "instalador", "fiodeamor.ico")}`, path.join(raiz, "instalador", "fiodeamor.nsi")]);
  log(`Pronto: ${path.relative(raiz, saida)} (${(fs.statSync(saida).size / 1e6).toFixed(0)} MB)`);
}
