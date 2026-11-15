/**
 * Funções do empacotador do Windows (instalador/empacotar.mjs), separadas para os testes
 * (tests/infra-empacotar.test.ts) poderem usar sem montar o pacote inteiro.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Copia a pasta (ou o arquivo) `de` para `para` trocando TODO link simbólico pelo conteúdo de verdade,
 * em qualquer profundidade. (O fs.cpSync com `dereference: true` só resolve o link do topo: os links
 * absolutos que o Next cria em .next/standalone/.next/node_modules iam parar no pacote apontando para
 * /home/…/.next/standalone, que não existe no computador da loja.)
 * Link quebrado ou em ciclo interrompe com mensagem.
 * @param {string} de
 * @param {string} para
 * @param {{ filtro?: (origem: string, destino: string) => boolean }} [opcoes]
 */
export function copiarReal(de, para, opcoes = {}) {
  const { filtro } = opcoes;
  /** @param {string} origem @param {string} destino @param {Set<string>} pilha */
  const visitar = (origem, destino, pilha) => {
    if (filtro && !filtro(origem, destino)) return;
    const lst = fs.lstatSync(origem);
    let st = lst;
    if (lst.isSymbolicLink()) {
      try {
        st = fs.statSync(origem);
      } catch {
        throw new Error(`Link simbólico quebrado (o destino não existe): ${origem} → ${fs.readlinkSync(origem)}`);
      }
    }
    if (st.isDirectory()) {
      const real = fs.realpathSync(origem);
      if (pilha.has(real)) throw new Error(`Link simbólico em ciclo (aponta para uma pasta acima dele): ${origem} → ${real}`);
      pilha.add(real);
      fs.mkdirSync(destino, { recursive: true });
      for (const nome of fs.readdirSync(origem)) visitar(path.join(origem, nome), path.join(destino, nome), pilha);
      pilha.delete(real);
    } else if (st.isFile()) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(origem, destino); // copyFileSync segue o link: grava o conteúdo
    }
    // soquetes e afins (não existem num build) ficam de fora
  };
  visitar(de, para, new Set());
}

/**
 * Links simbólicos dentro da pasta (sem segui-los), com o caminho relativo a ela.
 * @param {string} dir
 * @returns {string[]}
 */
export function procurarLinks(dir) {
  /** @type {string[]} */
  const achados = [];
  /** @param {string} p */
  const varrer = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const caminho = path.join(p, e.name);
      if (e.isSymbolicLink()) achados.push(path.relative(dir, caminho));
      else if (e.isDirectory()) varrer(caminho);
    }
  };
  if (fs.existsSync(dir)) varrer(dir);
  return achados;
}

const OUTROS_SISTEMAS = /linux|musl|wasm32|darwin|freebsd|android/;

/**
 * Apaga os módulos nativos de outros sistemas (@img/sharp-linux-x64, @libsql/linux-x64-gnu…) em qualquer
 * node_modules da pasta, inclusive as cópias em .next/node_modules. Devolve o que foi apagado (relativo).
 * @param {string} dir
 * @returns {string[]}
 */
export function removerNativosDeOutrosSistemas(dir) {
  /** @type {string[]} */
  const apagados = [];
  /** @param {string} p */
  const varrer = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const caminho = path.join(p, e.name);
      if (e.name === "@img" || e.name === "@libsql") {
        for (const n of fs.readdirSync(caminho, { withFileTypes: true })) {
          if (n.isDirectory() && OUTROS_SISTEMAS.test(n.name)) {
            fs.rmSync(path.join(caminho, n.name), { recursive: true, force: true });
            apagados.push(path.relative(dir, path.join(caminho, n.name)));
          }
        }
      }
      varrer(caminho);
    }
  };
  if (fs.existsSync(dir)) varrer(dir);
  return apagados;
}

/** @param {string} p */
const ehArquivo = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
/** @param {string} p */
const ehPasta = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
/** @param {string} dir @param {RegExp} padrao */
const temArquivo = (dir, padrao) => ehPasta(dir) && fs.readdirSync(dir).some((n) => padrao.test(n) && ehArquivo(path.join(dir, n)));

/**
 * Teste de fumaça da estrutura do pacote (antes do makensis). Devolve a lista de problemas (vazia = tudo certo).
 * @param {string} stage pasta FioDeAmor montada (com app\, node\, servidor.cmd…)
 * @param {{ windows?: boolean }} [opcoes]
 * @returns {string[]}
 */
export function conferirEstrutura(stage, opcoes = {}) {
  const windows = opcoes.windows ?? true;
  const app = path.join(stage, "app");
  /** @type {string[]} */
  const problemas = [];
  /** @param {boolean} ok @param {string} texto */
  const exigir = (ok, texto) => {
    if (!ok) problemas.push(texto);
  };
  exigir(ehArquivo(path.join(app, "server.js")), "falta app/server.js (servidor do Next)");
  exigir(ehArquivo(path.join(app, "servidor-seguro.cjs")), "falta app/servidor-seguro.cjs (invólucro que grava o IP real)");
  exigir(ehArquivo(path.join(app, "package.json")), "falta app/package.json");
  exigir(ehArquivo(path.join(app, ".next", "BUILD_ID")), "falta app/.next/BUILD_ID (build incompleto)");
  exigir(ehPasta(path.join(app, ".next", "server")), "falta app/.next/server");
  exigir(ehPasta(path.join(app, ".next", "static")) && fs.readdirSync(path.join(app, ".next", "static")).length > 0, "falta app/.next/static (CSS e JavaScript das telas)");
  exigir(ehPasta(path.join(app, "public")), "falta app/public (logo e ícones)");
  for (const f of ["servidor.cmd", "abrir.ps1", "tarefa.xml", "LEIA-ME.txt", "fiodeamor.ico"]) exigir(ehArquivo(path.join(stage, f)), `falta ${f}`);
  if (ehArquivo(path.join(stage, "servidor.cmd"))) {
    exigir(fs.readFileSync(path.join(stage, "servidor.cmd"), "utf8").includes("servidor-seguro.cjs"), "servidor.cmd não inicia pelo servidor-seguro.cjs");
  }
  if (ehArquivo(path.join(stage, "tarefa.xml"))) {
    const bruto = fs.readFileSync(path.join(stage, "tarefa.xml"));
    const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
    exigir(utf16, "tarefa.xml precisa estar em UTF-16 com BOM (o Agendador de Tarefas não lê de outro jeito)");
    if (utf16) exigir(bruto.subarray(2).toString("utf16le").includes("<UserId>S-1-5-19</UserId>"), "tarefa.xml não roda como LocalService (S-1-5-19)");
  }
  if (windows) {
    exigir(ehArquivo(path.join(stage, "node", "node.exe")), "falta node/node.exe (Node.js para Windows)");
    exigir(temArquivo(path.join(app, "node_modules", "@libsql", "win32-x64-msvc"), /\.node$/), "falta o módulo nativo do banco para Windows (@libsql/win32-x64-msvc)");
    exigir(temArquivo(path.join(app, "node_modules", "@img", "sharp-win32-x64", "lib"), /\.node$/), "falta o módulo nativo das imagens para Windows (@img/sharp-win32-x64)");
    const sobras = [];
    for (const escopo of ["@libsql", "@img"]) {
      const dir = path.join(app, "node_modules", escopo);
      if (ehPasta(dir)) sobras.push(...fs.readdirSync(dir).filter((n) => OUTROS_SISTEMAS.test(n)).map((n) => `${escopo}/${n}`));
    }
    exigir(!sobras.length, `módulos nativos de outro sistema no pacote do Windows: ${sobras.join(", ")}`);
  }
  const links = procurarLinks(stage);
  exigir(!links.length, `links simbólicos no pacote (não funcionam no Windows): ${links.slice(0, 5).join(", ")}${links.length > 5 ? "…" : ""}`);
  return problemas;
}

/** Porta TCP livre em 127.0.0.1. @returns {Promise<number>} */
export function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const endereco = s.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      s.close(() => (porta ? resolve(porta) : reject(new Error("sem porta livre"))));
    });
  });
}

/** @param {number} ms */
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sobe o servidor (node <servidor>) numa porta livre, com uma pasta de dados temporária e um ambiente limpo
 * (sem DATABASE_URL nem chaves: nunca toca no banco de verdade), e confere que os caminhos respondem 200.
 * Lança erro com o fim do registro do servidor quando algo falha.
 * @param {{ servidor: string, cwd?: string, caminhos?: string[], tempoMaximo?: number, dados?: string }} opcoes
 * @returns {Promise<{ porta: number, respostas: Record<string, number> }>}
 */
export async function testeDeFumaca(opcoes) {
  const caminhos = opcoes.caminhos ?? ["/entrar", "/api/sessao?modo=1"];
  const tempoMaximo = opcoes.tempoMaximo ?? 60000;
  const dados = opcoes.dados ?? fs.mkdtempSync(path.join(os.tmpdir(), "fda-fumaca-"));
  const apagarDados = !opcoes.dados;
  const porta = await portaLivre();
  /** @type {Record<string, string>} */
  const env = { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PORT: String(porta), HOSTNAME: "127.0.0.1", FDA_DADOS: dados };
  for (const k of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"]) {
    if (process.env[k]) env[k] = /** @type {string} */ (process.env[k]);
  }
  /** @type {string[]} */
  const registro = [];
  const filho = spawn(process.execPath, [opcoes.servidor], { cwd: opcoes.cwd ?? path.dirname(opcoes.servidor), env, stdio: ["ignore", "pipe", "pipe"] });
  /** @param {Buffer} b */
  const guardar = (b) => {
    registro.push(...String(b).split(/\r?\n/).filter(Boolean));
    if (registro.length > 60) registro.splice(0, registro.length - 60);
  };
  filho.stdout.on("data", guardar);
  filho.stderr.on("data", guardar);
  /** @type {number | null} */
  let saiu = null;
  filho.once("exit", (c) => (saiu = c ?? -1));
  const falha = (/** @type {string} */ texto) => new Error(`${texto}\n--- fim do registro do servidor ---\n${registro.slice(-25).join("\n")}`);
  try {
    const base = `http://127.0.0.1:${porta}`;
    const limite = Date.now() + tempoMaximo;
    /** @type {Record<string, number>} */
    const respostas = {};
    for (;;) {
      if (saiu !== null) throw falha(`o servidor parou sozinho (código ${saiu}) antes de responder`);
      try {
        const r = await fetch(base + caminhos[0], { signal: AbortSignal.timeout(5000), redirect: "manual" });
        respostas[caminhos[0]] = r.status;
        await r.arrayBuffer().catch(() => {});
        break;
      } catch {
        if (Date.now() > limite) throw falha(`o servidor não respondeu em ${Math.round(tempoMaximo / 1000)} s`);
        await esperar(500);
      }
    }
    for (const c of caminhos.slice(1)) {
      const r = await fetch(base + c, { signal: AbortSignal.timeout(15000), redirect: "manual" });
      respostas[c] = r.status;
      await r.arrayBuffer().catch(() => {});
    }
    const ruins = Object.entries(respostas).filter(([, s]) => s !== 200);
    if (ruins.length) throw falha(`resposta diferente de 200: ${ruins.map(([c, s]) => `${c} → ${s}`).join(", ")}`);
    return { porta, respostas };
  } finally {
    if (saiu === null) {
      filho.kill("SIGTERM");
      for (let i = 0; i < 50 && saiu === null; i++) await esperar(100);
      if (saiu === null) filho.kill("SIGKILL");
    }
    if (apagarDados) fs.rmSync(dados, { recursive: true, force: true });
  }
}
