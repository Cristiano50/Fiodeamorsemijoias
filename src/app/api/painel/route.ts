import { NextRequest } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { estadoBackup } from "@/lib/backup";
import { analisarVendas, ligarVenda } from "@/lib/vendas-calculo";
import { avisoBackup, indicadoresEstoque, sellThroughPorPedido, vendasDaSemana, vendasDoMes, type VendaResumo } from "@/lib/painel-calculo";
import { contextoAnalise } from "@/lib/vendas";
import { apelidoDe } from "@/lib/fornecedores";

type Contagem = { n: number; pedidoId: string | null };

/** Pendência do Painel: quantas e para onde ir. */
interface Pendencia {
  chave: string;
  rotulo: string;
  n: number;
  link: string;
  dica: string;
}

// Produtos de pedidos "importando" (importação incompleta) ficam fora de todas as contas do Painel.
const PRODUTOS = sql`select p.* from produtos p left join pedidos pe on pe.id = p.pedido_id where pe.id is null or pe.status <> 'importando'`;
const PEDIDOS = sql`select * from pedidos where status <> 'importando'`;

/**
 * GET /api/painel → números do cadastro, o bloco semanal (vendas da semana e do mês × período anterior,
 * sell-through por pedido aos 30/60/90 dias da chegada, estoque parado, capital, cobertura), o backup
 * fora do computador e as pendências com o link de cada uma.
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const db = await getDb();
    const ctx = await contextoAnalise(null);
    const hoje = ctx.hoje;
    const modoApp = ctx.sistema.origemCodigoBarras === "app";

    const [r] = await db.all<{
      produtos: number;
      pecas: number;
      custo: number;
      venda: number;
      pedidos: number;
      aprovados: number;
      semCodigo: number;
      noUp: number;
      comFotoIa: number;
      fotosPendentes: number;
      gastoIaMes: number;
      ultimaImportacao: string | null;
    }>(sql`
      with prod as (${PRODUTOS}), ped as (${PEDIDOS})
      select
        (select count(*) from prod) as produtos,
        (select coalesce(sum(quantidade),0) from prod) as pecas,
        (select coalesce(sum(custo_total_brl*quantidade),0) from prod) as custo,
        (select coalesce(sum(preco_venda*quantidade),0) from prod) as venda,
        (select count(*) from ped) as pedidos,
        (select count(*) from prod where status='aprovado') as aprovados,
        (select count(*) from prod where ${modoApp ? sql`codigo_barras is null` : sql`codigo_barras is null or (coalesce(codigo_barras_origem, '') <> 'up' and coalesce(up_status, '') <> 'enviado')`}) as semCodigo,
        (select count(*) from prod where up_status='enviado') as noUp,
        (select count(distinct i.produto_id) from imagens i join prod on prod.id = i.produto_id where i.origem in ('ia','arte')) as comFotoIa,
        (select count(*) from imagens i join prod on prod.id = i.produto_id where i.origem = 'ia' and json_extract(i.meta, '$.decisao') is null) as fotosPendentes,
        (select coalesce(sum(custo_usd),0) from gastos_ia where criado_em >= strftime('%Y-%m-01T00:00:00','now')) as gastoIaMes,
        (select max(criado_em) from lotes_vendas) as ultimaImportacao
    `);
    const porTipo = await db.all<{ tipo: string; pecas: number; venda: number }>(sql`
      with prod as (${PRODUTOS})
      select coalesce(tipo,'sem tipo') as tipo, sum(quantidade) as pecas, coalesce(sum(preco_venda*quantidade),0) as venda
      from prod group by tipo order by pecas desc`);

    // Pendências: contagem e, quando dá, o pedido mais recente para abrir direto.
    const contar = async (consulta: SQL): Promise<Contagem> => {
      const [x] = await db.all<Contagem>(consulta);
      return { n: Number(x?.n) || 0, pedidoId: x?.pedidoId ?? null };
    };
    const [semChegada, conferencia, recompras, precos] = await Promise.all([
      contar(sql`with ped as (${PEDIDOS}) select count(*) as n, (select id from ped where data_chegada is null order by criado_em desc limit 1) as pedidoId from ped where data_chegada is null`),
      contar(sql`with ped as (${PEDIDOS}), alvo as (select * from ped where coalesce(recebimento, '') not in ('conferido', 'em_transito') and (data_chegada is null or data_chegada <= ${hoje}))
        select count(*) as n, (select id from alvo order by criado_em desc limit 1) as pedidoId from alvo`),
      contar(sql`with prod as (${PRODUTOS}), alvo as (select * from prod where (case when json_valid(recompra_candidatas) then json_array_length(recompra_candidatas) else 0 end) > 0)
        select count(*) as n, (select pedido_id from alvo order by criado_em desc limit 1) as pedidoId from alvo`),
      contar(sql`with prod as (${PRODUTOS}), alvo as (select * from prod where preco_venda is null)
        select count(*) as n, (select pedido_id from alvo order by criado_em desc limit 1) as pedidoId from alvo`),
    ]);
    const paraPedido = (c: Contagem, lista: string) => (c.n === 1 && c.pedidoId ? `/pedidos/${c.pedidoId}` : lista);
    const pendencias: Pendencia[] = [
      { chave: "semChegada", rotulo: "Pedidos sem data de chegada", n: semChegada.n, link: paraPedido(semChegada, "/pedidos"), dica: "giro e “parado” contam da chegada" },
      { chave: "conferencia", rotulo: "Conferência pendente", n: conferencia.n, link: paraPedido(conferencia, "/pedidos"), dica: "contar o que chegou e os defeitos" },
      { chave: "recompras", rotulo: "Recompras a confirmar", n: recompras.n, link: recompras.pedidoId ? `/pedidos/${recompras.pedidoId}` : "/pedidos", dica: "a peça casou com mais de um original" },
      { chave: "precos", rotulo: "Preços pendentes", n: precos.n, link: precos.pedidoId ? `/pedidos/${precos.pedidoId}` : "/produtos", dica: "peças sem preço de venda" },
      { chave: "semCodigoUp", rotulo: "Peças sem código do UP", n: Number(r.semCodigo) || 0, link: "/up-vendas", dica: "cadastre no UP e traga o código" },
      { chave: "fotos", rotulo: "Fotos a aprovar", n: Number(r.fotosPendentes) || 0, link: "/fotos", dica: "fotos com IA esperando a loja" },
    ];

    // Bloco semanal: vendas, sell-through por pedido e estoque.
    const analise = analisarVendas(ctx.produtos, ctx.vendas, ctx.params);
    const resumo: VendaResumo[] = ctx.vendas.map((v) => ({
      data: v.data,
      quantidade: v.quantidade,
      receita: v.valorTotal ?? (ligarVenda(v, ctx.idx).produto?.precoVenda ?? 0) * v.quantidade,
    }));
    const ultimaVenda = resumo.reduce<string | null>((m, v) => (v.data && v.data <= hoje && (!m || v.data > m) ? v.data : m), null);
    const fim = ultimaVenda ?? hoje;
    const backup = avisoBackup(await estadoBackup(), hoje);

    return ok({
      ...r,
      porTipo,
      hoje,
      vendas: {
        temVendas: ctx.vendas.length > 0,
        ultimaVenda,
        ultimaImportacao: r.ultimaImportacao,
        semana: ctx.vendas.length ? vendasDaSemana(resumo, fim) : null,
        mes: ctx.vendas.length ? vendasDoMes(resumo, fim) : null,
      },
      sellThrough: sellThroughPorPedido(ctx.idx, ctx.vendas, hoje, { limite: 6 }).map((x) => ({ ...x, fornecedorApelido: apelidoDe(ctx.apelidos, x.fornecedor) })),
      estoque: indicadoresEstoque(analise.skus, resumo, ultimaVenda),
      aCaminho: analise.aCaminho,
      backup,
      pendencias,
    });
  } catch (e) {
    return erro(e);
  }
}
