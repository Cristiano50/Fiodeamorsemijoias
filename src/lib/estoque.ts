/**
 * Quantidade que efetivamente entrou na loja por linha de pedido (regra única do app).
 * Conferida: recebida − com defeito. Ainda não conferida: a quantidade pedida.
 * Sem "server-only": usado em telas, rotas, planilha do UP, etiquetas, catálogo, vendas e maleta.
 */
export function estoqueEntrada(p: { quantidade: number; quantidadeRecebida?: number | null; quantidadeDefeito?: number | null }): number {
  if (p.quantidadeRecebida == null) return Math.max(0, Math.floor(Number(p.quantidade) || 0));
  return Math.max(0, Math.floor(Number(p.quantidadeRecebida) || 0) - Math.max(0, Math.floor(Number(p.quantidadeDefeito) || 0)));
}

/** A linha já foi conferida na chegada? */
export const conferida = (p: { quantidadeRecebida?: number | null }) => p.quantidadeRecebida != null;
