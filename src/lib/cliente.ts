"use client";

/** fetch JSON com mensagem de erro em português. */
export async function api<T = unknown>(url: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...resto } = opts;
  const res = await fetch(url, {
    ...resto,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(resto.headers ?? {}) } : resto.headers,
    body: json !== undefined ? JSON.stringify(json) : resto.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/entrar")) {
    window.location.href = `/entrar?voltar=${encodeURIComponent(window.location.pathname)}`;
  }
  const tipo = res.headers.get("content-type") ?? "";
  const dados = tipo.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((dados as { erro?: string })?.erro ?? `Erro ${res.status}`);
  return dados as T;
}

export const brl = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (v: number | null | undefined, casas = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const moedaSimbolo = (m: string) => ({ CNY: "¥", BRL: "R$", USD: "US$" })[m] ?? m;

export const img = (id: string | null | undefined, w?: number) => (id ? `/api/imagens/${id}${w ? `?w=${w}` : ""}` : null);
