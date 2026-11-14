import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { apelidosFornecedores, apelidoDe, listarFornecedores, salvarApelido } from "@/lib/fornecedores";

/** GET /api/fornecedores → fornecedores dos pedidos, com o nome original e o apelido. */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    return ok(await listarFornecedores());
  } catch (e) {
    return erro(e);
  }
}

/**
 * PUT /api/fornecedores { nome, apelido } — renomeia o fornecedor só na exibição.
 * `nome` é o nome original (como veio no pedido); ele continua guardado e é o que a recompra usa.
 * Apelido vazio volta a mostrar só o nome original.
 */
export async function PUT(req: NextRequest) {
  try {
    await exigirPapel(req);
    const { nome, apelido } = (await req.json()) as { nome?: string; apelido?: string | null };
    if (!nome?.trim()) return erro("Informe o nome original do fornecedor.", 400);
    const antes = apelidoDe(await apelidosFornecedores(), nome);
    const novo = await salvarApelido(nome, apelido);
    if (antes !== novo) {
      await registrar(req, {
        acao: "fornecedor.renomear",
        entidade: "fornecedor",
        entidadeId: nome.trim(),
        resumo: `Fornecedor ${nome.trim()}: ${antes ?? "sem apelido"} → ${novo ?? "sem apelido"}`,
      });
    }
    return ok({ nome: nome.trim(), apelido: novo });
  } catch (e) {
    return erro(e);
  }
}
