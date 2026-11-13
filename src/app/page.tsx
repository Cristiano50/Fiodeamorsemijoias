"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Botao, Carregando, Cartao, Numero, Selo } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";

type Painel = { produtos: number; pecas: number; custo: number; venda: number; pedidos: number; aprovados: number; semCodigo: number; noUp: number; comFotoIa: number; porTipo: { tipo: string; pecas: number; venda: number }[] };
type PedidoLista = { id: string; numero: string | null; fornecedor: string | null; dataCompra: string | null; moeda: string; status: string; linhas: number; pecas: number; custo: number; venda: number };

export default function Painel() {
  const [p, setP] = useState<Painel | null>(null);
  const [pedidos, setPedidos] = useState<PedidoLista[]>([]);
  const { config } = useConfig();
  useEffect(() => {
    api<Painel>("/api/painel").then(setP);
    api<PedidoLista[]>("/api/pedidos").then(setPedidos);
  }, []);
  if (!p) return <Carregando />;
  const maxPecas = Math.max(1, ...p.porTipo.map((t) => t.pecas));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-gradient-to-r from-rose-claro to-creme px-6 py-6">
        <div>
          <p className="font-script text-3xl text-rose-escuro">bem-vinda de volta</p>
          <h1 className="text-4xl font-semibold">Cadastro de semijoias</h1>
          <p className="mt-1 max-w-xl text-sm text-[#6b5560]">
            Importe o pedido do fornecedor, revise preços e nomes, gere códigos de barras e etiquetas, crie fotos de publicidade e
            envie tudo para o UP Vendas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/importar">
            <Botao>⇪ Importar pedido</Botao>
          </Link>
          <Link href="/produtos?novo=1">
            <Botao variante="secundario">+ Produto avulso</Botao>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero rotulo="Produtos cadastrados" valor={p.produtos} detalhe={`${p.pecas} peças · ${p.aprovados} aprovados`} />
        <Numero rotulo="Investimento (custo)" valor={brl(p.custo)} />
        <Numero rotulo="Valor em etiqueta" valor={brl(p.venda)} detalhe={p.custo ? `markup × ${num(p.venda / p.custo)}` : ""} />
        <Numero rotulo="No UP Vendas" valor={p.noUp} detalhe={`${p.semCodigo} sem código · ${p.comFotoIa} com arte/foto IA`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Cartao titulo="Últimos pedidos" className="lg:col-span-2" acoes={<Link href="/pedidos" className="text-sm text-rose-escuro">ver todos →</Link>}>
          {pedidos.length === 0 ? (
            <p className="text-sm text-[#8a6d78]">
              Nenhum pedido ainda. <Link href="/importar" className="text-rose-escuro underline">Importe o primeiro</Link>.
            </p>
          ) : (
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Compra</th>
                  <th>Peças</th>
                  <th>Custo</th>
                  <th>Venda</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pedidos.slice(0, 8).map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/pedidos/${x.id}`} className="font-medium text-rose-escuro">
                        {x.numero ?? "sem número"}
                      </Link>
                      <div className="text-xs text-[#9a8089]">{x.fornecedor}</div>
                    </td>
                    <td>{x.dataCompra?.split("-").reverse().join("/")}</td>
                    <td>
                      {x.linhas} / {x.pecas}
                    </td>
                    <td>{brl(x.custo)}</td>
                    <td>{brl(x.venda)}</td>
                    <td>
                      <Selo cor={x.status === "analisado" ? "verde" : "rose"}>{x.status}</Selo> <Selo cor="cinza">{moedaSimbolo(x.moeda)}</Selo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Cartao>
        <Cartao titulo="Mix por tipo">
          <div className="flex flex-col gap-2">
            {p.porTipo.map((t) => (
              <div key={t.tipo}>
                <div className="flex justify-between text-sm">
                  <span>{nomeDe(config?.taxonomia.tipos, t.tipo)}</span>
                  <span className="text-[#8a6d78]">{t.pecas} pç</span>
                </div>
                <div className="h-2 rounded-full bg-rose-claro">
                  <div className="h-2 rounded-full bg-rose" style={{ width: `${(t.pecas / maxPecas) * 100}%` }} />
                </div>
              </div>
            ))}
            {!p.porTipo.length && <p className="text-sm text-[#8a6d78]">Sem dados.</p>}
          </div>
        </Cartao>
      </div>
    </div>
  );
}
