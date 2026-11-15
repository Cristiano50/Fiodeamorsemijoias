import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { apelidosFornecedores, apelidoDe, chaveFornecedor, listarFornecedores, listarFornecedoresComConta, lotesMinimosFornecedores, salvarApelido, salvarLoteMinimo } from "@/lib/fornecedores";
import { lerLoteMinimo } from "@/lib/conta-fornecedor";

/**
 * GET /api/fornecedores → fornecedores dos pedidos, com o nome original e o apelido ({ nome, apelido, pedidos, ultimo }).
 * Para a gestora, cada um vem também com a conta: chave, lote mínimo, total pago, pedidos e créditos
 * (tela /fornecedores). Com ?conta=1 a resposta é { fornecedores, loteMinimoPadrao }.
 */
export async function GET(req: NextRequest) {
  try {
    const u = await exigirPapel(req);
    const conta = req.nextUrl.searchParams.get("conta");
    if (u.p !== "gestora") {
      if (conta) await exigirPapel(req, "gestora");
      return ok(await listarFornecedores());
    }
    const dados = await listarFornecedoresComConta();
    return ok(conta ? dados : dados.fornecedores);
  } catch (e) {
    return erro(e);
  }
}

/**
 * PUT /api/fornecedores { nome, apelido?, loteMinimo? }
 *  - apelido: renomeia o fornecedor só na exibição (vazio volta a mostrar só o nome original);
 *  - loteMinimo (só a gestora): múltiplo de peças que o fornecedor aceita na recompra (vazio = padrão da loja).
 * `nome` é o nome original (como veio no pedido); ele continua guardado e é o que a recompra usa.
 */
export async function PUT(req: NextRequest) {
  try {
    await exigirPapel(req);
    const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown; apelido?: unknown; loteMinimo?: unknown };
    const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
    if (!nome || !chaveFornecedor(nome)) return erro("Informe o nome original do fornecedor.", 400);
    const resposta: { nome: string; apelido?: string | null; loteMinimo?: number | null } = { nome };

    if ("loteMinimo" in corpo) {
      await exigirPapel(req, "gestora");
      const lote = lerLoteMinimo(corpo.loteMinimo);
      if (lote === undefined) return erro("Lote mínimo inválido: use um número inteiro de peças (1, 2, 3…), ou deixe vazio para usar o padrão da loja.", 400);
      const antes = (await lotesMinimosFornecedores()).get(chaveFornecedor(nome)) ?? null;
      resposta.loteMinimo = await salvarLoteMinimo(nome, lote);
      if (antes !== lote)
        await registrar(req, {
          acao: "fornecedor.lote_minimo",
          entidade: "fornecedor",
          entidadeId: nome,
          resumo: `Fornecedor ${nome}: lote mínimo ${antes ?? "padrão"} → ${lote ?? "padrão"}`,
        });
    }

    if ("apelido" in corpo) {
      const apelido = typeof corpo.apelido === "string" ? corpo.apelido : null;
      const antes = apelidoDe(await apelidosFornecedores(), nome);
      const novo = await salvarApelido(nome, apelido);
      resposta.apelido = novo;
      if (antes !== novo) {
        await registrar(req, {
          acao: "fornecedor.renomear",
          entidade: "fornecedor",
          entidadeId: nome,
          resumo: `Fornecedor ${nome}: ${antes ?? "sem apelido"} → ${novo ?? "sem apelido"}`,
        });
      }
    }
    return ok(resposta);
  } catch (e) {
    return erro(e);
  }
}
