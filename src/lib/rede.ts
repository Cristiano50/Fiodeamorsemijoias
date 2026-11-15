/**
 * De onde veio a requisição: o IP do aparelho e se ele é o próprio computador do servidor.
 * Funções puras (sem banco, sem "server-only"): usadas pelo proxy, pelas rotas e pelos testes
 * (tests/seguranca-rede.test.ts).
 *
 * Por que não basta ler x-forwarded-for: o Next só preenche esse cabeçalho com o IP do socket quando o
 * cliente NÃO manda o cabeçalho (next/dist/server/base-server.js, `??=`). No `next start` puro, qualquer
 * aparelho da rede pode mandar "x-forwarded-for: 127.0.0.1" e se passar pelo servidor. Por isso o valor
 * só vale como IP do cliente quando há uma fonte confiável na frente do app:
 *  - FDA_IP_CONFIAVEL=1: o instalador do Windows sobe o servidor por um invólucro que apaga o cabeçalho
 *    recebido e grava o IP real do socket;
 *  - VERCEL: a Vercel sobrescreve o cabeçalho com o IP de quem acessou.
 */

export interface Cabecalhos {
  get(nome: string): string | null;
}

export interface AmbienteRede {
  FDA_IP_CONFIAVEL?: string;
  VERCEL?: string;
  [nome: string]: string | undefined;
}

/** Endereços com que o próprio computador do servidor abre o app (o atalho usa http://localhost:3000). */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function ipConfiavel(env: AmbienteRede = process.env): boolean {
  return env.FDA_IP_CONFIAVEL === "1" || !!env.VERCEL;
}

const ipv4 = (s: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const partes = m.slice(1).map(Number);
  return partes.every((n) => n <= 255) ? partes : null;
};

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::" e IPv4 no fim, como em ::ffff:127.0.0.1). */
function ipv6Grupos(s: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  let texto = s;
  const extra: number[] = [];
  const ultimo = texto.lastIndexOf(":");
  if (texto.slice(ultimo + 1).includes(".")) {
    const v4 = ipv4(texto.slice(ultimo + 1));
    if (!v4) return null;
    extra.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    texto = texto.slice(0, ultimo + 1) + "0"; // marcador, trocado pelos dois grupos acima
  }
  const metades = texto.split("::");
  if (metades.length > 2) return null;
  const ler = (parte: string) => (parte ? parte.split(":") : []);
  const esquerda = ler(metades[0]);
  const direita = metades.length === 2 ? ler(metades[1]) : [];
  if (extra.length) (direita.length ? direita : esquerda).pop();
  const total = esquerda.length + direita.length + extra.length;
  if (metades.length === 1 ? total !== 8 : total > 7) return null;
  const meio = metades.length === 2 ? Array(8 - total).fill("0") : [];
  const grupos = [...esquerda, ...meio, ...direita].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const todos = [...grupos, ...extra];
  return todos.length === 8 && todos.every((n) => Number.isInteger(n)) ? todos : null;
}

/**
 * IP limpo: sem colchetes, porta ou zona; IPv4 dentro de IPv6 (::ffff:127.0.0.1) vira IPv4.
 * Valor que não é IP → null.
 */
export function normalizarIp(valor: string | null | undefined): string | null {
  let s = (valor ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("[")) {
    const fim = s.indexOf("]");
    if (fim < 0) return null;
    s = s.slice(1, fim);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(":")); // 192.168.0.5:51234
  }
  s = s.replace(/%[0-9a-z._-]+$/, ""); // zona do IPv6 (fe80::1%eth0)
  const v4 = ipv4(s);
  if (v4) return v4.join(".");
  const g = ipv6Grupos(s);
  if (!g) return null;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
  return s;
}

/** 127.0.0.0/8, ::1 e ::ffff:127.x.x.x. */
export function ehLoopback(valor: string | null | undefined): boolean {
  const ip = normalizarIp(valor);
  if (!ip) return false;
  const v4 = ipv4(ip);
  if (v4) return v4[0] === 127;
  const g = ipv6Grupos(ip);
  return !!g && g.slice(0, 7).every((n) => n === 0) && g[7] === 1;
}

const entradas = (cabecalho: string | null) =>
  (cabecalho ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * IP do aparelho, só quando há fonte confiável (FDA_IP_CONFIAVEL=1 ou Vercel); senão null.
 * Numa lista ("a, b"), vale o último: é o que a fonte confiável escreveu; os anteriores vêm do aparelho.
 */
export function ipDoCliente(headers: Cabecalhos, env: AmbienteRede = process.env): string | null {
  if (!ipConfiavel(env)) return null;
  const lista = entradas(headers.get("x-forwarded-for"));
  return normalizarIp(lista[lista.length - 1]);
}

/** IP como chegou, mesmo sem confirmação: serve só para o limite de tentativas e para o histórico. */
export function ipInformado(headers: Cabecalhos, env: AmbienteRede = process.env): string | null {
  const confirmado = ipDoCliente(headers, env);
  if (confirmado) return confirmado;
  const lista = entradas(headers.get("x-forwarded-for"));
  return normalizarIp(lista[lista.length - 1]);
}

/** "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]". */
export function hostSemPorta(host: string | null | undefined): string {
  const h = (host ?? "").trim().toLowerCase();
  if (h.startsWith("[")) {
    const fim = h.indexOf("]");
    return fim < 0 ? h : h.slice(0, fim + 1);
  }
  return h.split(":").length === 2 ? h.split(":")[0] : h;
}

/**
 * A requisição veio do próprio computador do servidor (aberto por localhost)?
 * Exige o endereço localhost/127.0.0.1/[::1] no Host — um site de fora que aponte o próprio nome para
 * 127.0.0.1 (DNS rebinding) chega com outro Host e não passa — e o IP do aparelho de loopback.
 */
export function ehLocal(headers: Cabecalhos, env: AmbienteRede = process.env): boolean {
  if (!HOSTS_LOCAIS.has(hostSemPorta(headers.get("host")))) return false;
  if (ipConfiavel(env)) return ehLoopback(ipDoCliente(headers, env));
  // Sem fonte confiável (serve para desenvolvimento: `next dev`/`next start` direto no computador):
  // o cabeçalho ausente ou só com loopback é o que o Next preenche para quem abriu por localhost.
  // Um aparelho da rede consegue imitar isso (Host e x-forwarded-for inventados): no computador da
  // loja, o instalador liga FDA_IP_CONFIAVEL=1.
  return entradas(headers.get("x-forwarded-for")).every((ip) => ehLoopback(ip));
}
