import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { erro, ok } from "@/lib/api";

export async function GET() {
  try {
    const db = await getDb();
    const [r] = (
      await db.all<{ produtos: number; pecas: number; custo: number; venda: number; pedidos: number; aprovados: number; semCodigo: number; noUp: number; comFotoIa: number; fotosPendentes: number; gastoIaMes: number }>(sql`
      select
        (select count(*) from produtos) as produtos,
        (select coalesce(sum(quantidade),0) from produtos) as pecas,
        (select coalesce(sum(custo_total_brl*quantidade),0) from produtos) as custo,
        (select coalesce(sum(preco_venda*quantidade),0) from produtos) as venda,
        (select count(*) from pedidos) as pedidos,
        (select count(*) from produtos where status='aprovado') as aprovados,
        (select count(*) from produtos where referencia is null or codigo_barras is null) as semCodigo,
        (select count(*) from produtos where up_status='enviado') as noUp,
        (select count(distinct produto_id) from imagens where origem in ('ia','arte')) as comFotoIa,
        (select count(*) from imagens where origem = 'ia' and json_extract(meta, '$.decisao') is null) as fotosPendentes,
        (select coalesce(sum(custo_usd),0) from gastos_ia where criado_em >= strftime('%Y-%m-01T00:00:00','now')) as gastoIaMes
    `)
    );
    const porTipo = await db.all<{ tipo: string; pecas: number; venda: number }>(sql`
      select coalesce(tipo,'sem tipo') as tipo, sum(quantidade) as pecas, coalesce(sum(preco_venda*quantidade),0) as venda
      from produtos group by tipo order by pecas desc`);
    return ok({ ...r, porTipo });
  } catch (e) {
    return erro(e);
  }
}
