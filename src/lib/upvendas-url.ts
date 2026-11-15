/**
 * Endereço das chamadas ao UP Vendas (item 26 da revisão): a senha e o token só vão para o servidor
 * configurado. O caminho (Configurações → UP Vendas) precisa ser relativo, começando com "/", e a URL
 * final precisa ficar no mesmo endereço (protocolo, host e porta) do servidor; senão, erro.
 *
 * Função pura (sem banco e sem "server-only"), testada em tests/operacao-upvendas.test.ts.
 */
export class EnderecoUpInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EnderecoUpInvalido";
  }
}

export function urlNoServidorUp(caminho: string | null | undefined, servidor: string | null | undefined): string {
  let base: URL;
  try {
    base = new URL(String(servidor ?? "").trim());
  } catch {
    throw new EnderecoUpInvalido("Endereço do servidor do UP Vendas inválido. Confira em UP Vendas → Conexão com a API (ex.: https://ms.upvendas.app).");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new EnderecoUpInvalido("O servidor do UP Vendas precisa começar com https://.");
  if (base.username || base.password) throw new EnderecoUpInvalido("O endereço do servidor do UP Vendas não pode ter usuário ou senha.");

  const c = String(caminho ?? "").trim();
  // Só caminho relativo ao servidor: "//outro.host", "/\outro.host" ou "https://…" levariam a senha para fora.
  if (!c.startsWith("/") || c.startsWith("//") || /[\\\s]/.test(c))
    throw new EnderecoUpInvalido(`Caminho "${c.slice(0, 60)}" inválido: use um caminho do próprio servidor do UP, começando com "/" (ex.: /auth/login).`);
  let final: URL;
  try {
    final = new URL(c, base);
  } catch {
    throw new EnderecoUpInvalido(`Caminho "${c.slice(0, 60)}" inválido.`);
  }
  if (final.origin !== base.origin) throw new EnderecoUpInvalido("O caminho levaria a outro servidor. Por segurança, a senha do UP não foi enviada.");
  return final.toString();
}
