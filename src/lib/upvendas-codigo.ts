import type { Produto } from "./db/schema";

/**
 * Código de barras na planilha/API do UP:
 *  - código criado pelo UP (já cadastrado, ou recompra): vai o mesmo, para o UP achar o produto;
 *  - sem código do UP: vai em branco e o UP gera no cadastro (padrão da loja);
 *  - modo "app" (Configurações → Códigos): vai o EAN interno; no Code128 curto, os 8 dígitos da sequência.
 */
export function codigoParaUp(p: Pick<Produto, "codigoBarras" | "codigoBarrasOrigem">, ctx: { codigoNoUp: "ean13" | "code128"; origemCodigoBarras: "upvendas" | "app" }): string {
  if (!p.codigoBarras) return "";
  if (p.codigoBarrasOrigem === "up") return p.codigoBarras;
  if (ctx.origemCodigoBarras !== "app") return "";
  return ctx.codigoNoUp === "code128" ? p.codigoBarras.replace(/^9100/, "").slice(0, -1) : p.codigoBarras;
}
