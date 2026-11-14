"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Botao, Carregando, Cartao, Selo } from "@/components/ui";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";
import { NomeFornecedor } from "@/components/Fornecedor";

type PedidoLista = { id: string; numero: string | null; fornecedor: string | null; fornecedorApelido: string | null; dataCompra: string | null; moeda: string; cotacao: number; status: string; linhas: number; pecas: number; custo: number; venda: number; criadoEm: string };

export default function PedidosPage() {
  const [lista, setLista] = useState<PedidoLista[] | null>(null);
  useEffect(() => {
    api<PedidoLista[]>("/api/pedidos").then(setLista);
  }, []);
  if (!lista) return <Carregando />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between">
        <h1 className="text-4xl font-semibold">Pedidos</h1>
        <Link href="/importar">
          <Botao>⇪ Importar pedido</Botao>
        </Link>
      </div>
      <Cartao>
        {lista.length === 0 ? (
          <p className="text-sm text-[#8a6d78]">Nenhum pedido importado.</p>
        ) : (
          <table className="tabela w-full">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fornecedor</th>
                <th>Compra</th>
                <th>Cotação</th>
                <th>Linhas / peças</th>
                <th>Custo</th>
                <th>Venda potencial</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link href={`/pedidos/${x.id}`} className="font-medium text-rose-escuro underline-offset-2 hover:underline">
                      {x.numero ?? "sem número"}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate">
                    <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="—" />
                  </td>
                  <td>{x.dataCompra?.split("-").reverse().join("/")}</td>
                  <td>
                    {moedaSimbolo(x.moeda)} 1 = R$ {num(x.cotacao, 4)}
                  </td>
                  <td>
                    {x.linhas} / {x.pecas}
                  </td>
                  <td>{brl(x.custo)}</td>
                  <td>{brl(x.venda)}</td>
                  <td>
                    <Selo cor={x.status === "analisado" ? "verde" : "rose"}>{x.status}</Selo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
    </div>
  );
}
