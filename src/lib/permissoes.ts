import "server-only";
import { getConfig } from "./config";
import { SemPermissao, usuarioDaRequisicao } from "./auth";

/** Funcionário não pode usar fator abaixo do mínimo da loja (a gestora pode). */
export async function checarFator(req: Request, fator: number | null | undefined) {
  if (fator == null || !(fator > 0)) return;
  const u = await usuarioDaRequisicao(req);
  if (u?.p === "gestora") return;
  const pol = await getConfig("precificacao");
  const minimo = Number((pol as { fator_minimo?: number }).fator_minimo ?? 0);
  if (minimo && fator < minimo) throw new SemPermissao(`Fator ×${fator} abaixo do mínimo da loja (×${minimo}). Somente a gestora pode usar.`);
}

/** Funcionário não pode fixar preço que dê fator abaixo do mínimo. */
export async function checarPrecoManual(req: Request, preco: number | null | undefined, custo: number | null | undefined) {
  if (!preco || !custo || custo <= 0) return;
  await checarFator(req, Math.round((preco / custo) * 100) / 100);
}
