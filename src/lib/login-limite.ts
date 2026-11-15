/**
 * Limite de tentativas de login (por IP e por login), em funções puras.
 * O estado fica na tabela tentativas_login (src/app/api/login/route.ts lê e grava).
 * Testes: tests/seguranca-login.test.ts.
 *
 * Bloqueio progressivo: 5 falhas → 1 min, 10 → 15 min, 20 ou mais → 1 h. Zera ao entrar com sucesso
 * e depois de 24 h sem nenhuma falha.
 */

const MINUTO = 60_000;
export const DEGRAUS = [
  { falhas: 20, ms: 60 * MINUTO },
  { falhas: 10, ms: 15 * MINUTO },
  { falhas: 5, ms: MINUTO },
] as const;
export const ESQUECER_APOS_MS = 24 * 60 * MINUTO;

export interface Tentativa {
  falhas: number;
  bloqueadoAte: string | null;
  atualizadoEm: string | null;
}

/** Tempo de bloqueio depois de N falhas seguidas (0 = sem bloqueio). */
export function bloqueioMs(falhas: number): number {
  return DEGRAUS.find((d) => falhas >= d.falhas)?.ms ?? 0;
}

const quando = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Quanto falta do bloqueio (0 = liberado). */
export function restanteMs(t: Pick<Tentativa, "bloqueadoAte"> | null | undefined, agora: number): number {
  const ate = quando(t?.bloqueadoAte);
  return ate && ate > agora ? ate - agora : 0;
}

/** Estado depois de mais uma falha (o contador recomeça se a última falha foi há mais de 24 h). */
export function aposFalha(t: Tentativa | null | undefined, agora: number): { falhas: number; bloqueadoAte: string | null; atualizadoEm: string } {
  const ultima = quando(t?.atualizadoEm);
  const anteriores = t && ultima !== null && agora - ultima < ESQUECER_APOS_MS ? Math.max(0, Math.floor(t.falhas) || 0) : 0;
  const falhas = anteriores + 1;
  const ms = bloqueioMs(falhas);
  return { falhas, bloqueadoAte: ms ? new Date(agora + ms).toISOString() : null, atualizadoEm: new Date(agora).toISOString() };
}

export function mensagemBloqueio(ms: number): string {
  const minutos = Math.max(1, Math.ceil(ms / MINUTO));
  return `Muitas tentativas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`;
}

/** Chaves da tabela: "ip:192.168.0.5" e "login:ana". */
export function chavesTentativa(ip: string | null | undefined, login: string): string[] {
  return [`ip:${(ip || "desconhecido").slice(0, 64)}`, `login:${login.trim().toLowerCase().slice(0, 100) || "(vazio)"}`];
}
