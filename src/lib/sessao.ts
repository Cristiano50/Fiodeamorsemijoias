/**
 * Acesso por senha única (opcional). Defina APP_SENHA no ambiente para proteger o app
 * quando ele estiver na internet. Sem APP_SENHA o app fica aberto (uso no computador da loja).
 */
export const COOKIE_SESSAO = "fda_sessao";

export async function assinatura(senha: string): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode("fio-de-amor-sessao-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
