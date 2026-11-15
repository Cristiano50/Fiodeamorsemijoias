"use client";
import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";
import { NomeFornecedor } from "@/components/Fornecedor";

type PedidoLista = {
  id: string;
  numero: string | null;
  fornecedor: string | null;
  fornecedorApelido: string | null;
  dataCompra: string | null;
  moeda: string;
  cotacao: number;
  status: string;
  linhas: number;
  pecas: number;
  custo: number;
  venda: number;
  criadoEm: string;
  recebimento?: string | null; // em_transito | recebido | conferido (vazio = não informado)
  dataChegada?: string | null; // AAAA-MM-DD
};

type CorSelo = NonNullable<ComponentProps<typeof Selo>["cor"]>;

const STATUS: Record<string, { rotulo: string; cor: CorSelo }> = {
  importando: { rotulo: "Importação incompleta", cor: "amarelo" },
  extraido: { rotulo: "Extraído", cor: "rose" },
  analisado: { rotulo: "Analisado", cor: "verde" },
  concluido: { rotulo: "Concluído", cor: "verde" },
};

const RECEBIMENTO: Record<string, { rotulo: string; cor: CorSelo }> = {
  em_transito: { rotulo: "Em trânsito", cor: "amarelo" },
  recebido: { rotulo: "Recebido", cor: "rose" },
  conferido: { rotulo: "Conferido", cor: "verde" },
};

const dataBr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");

/** Status do pedido; a importação incompleta leva para a tela de importar, onde dá para continuar. */
function StatusPedido({ status }: { status: string }) {
  const s = STATUS[status] ?? { rotulo: status, cor: "rose" as const };
  if (status === "importando") {
    return (
      <Link href="/importar" title="A importação não terminou: abra Importar pedido para continuar" className="inline-flex">
        <Selo cor={s.cor}>{s.rotulo} →</Selo>
      </Link>
    );
  }
  return <Selo cor={s.cor}>{s.rotulo}</Selo>;
}

/** Situação do recebimento (em trânsito, recebido, conferido) e a data de chegada. */
function Recebimento({ p }: { p: PedidoLista }) {
  const r = p.recebimento ? (RECEBIMENTO[p.recebimento] ?? { rotulo: p.recebimento, cor: "cinza" as const }) : null;
  if (!r && !p.dataChegada) return <span className="text-[#9a8089]">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {r && <Selo cor={r.cor}>{r.rotulo}</Selo>}
      {p.dataChegada && <span className="whitespace-nowrap text-xs text-[#6b5560]">chegada {dataBr(p.dataChegada)}</span>}
    </span>
  );
}

export default function PedidosPage() {
  const avisar = useAviso();
  const [lista, setLista] = useState<PedidoLista[] | null>(null);
  useEffect(() => {
    api<PedidoLista[]>("/api/pedidos")
      .then(setLista)
      .catch((e) => {
        setLista([]);
        avisar(e instanceof Error ? e.message : String(e), "erro");
      });
  }, [avisar]);
  if (!lista) return <Carregando />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-semibold">Pedidos</h1>
        <Link href="/importar">
          <Botao>⇪ Importar pedido</Botao>
        </Link>
      </div>
      {lista.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[#8a6d78]">Nenhum pedido importado.</p>
        </Cartao>
      ) : (
        <>
          {/* Celular: um cartão por pedido (a tabela não cabe em 390 px). */}
          <div className="flex flex-col gap-3 md:hidden">
            {lista.map((x) => (
              <Cartao key={x.id}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/pedidos/${x.id}`} className="min-w-0 break-words font-medium text-rose-escuro underline-offset-2 hover:underline">
                    {x.numero ?? "sem número"}
                  </Link>
                  <span className="shrink-0">
                    <StatusPedido status={x.status} />
                  </span>
                </div>
                <div className="mt-0.5 truncate text-sm">
                  <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="—" />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div>
                    <dt className="text-[#9a8089]">Compra</dt>
                    <dd>{dataBr(x.dataCompra)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9a8089]">Cotação</dt>
                    <dd>
                      {moedaSimbolo(x.moeda)} 1 = R$ {num(x.cotacao, 4)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#9a8089]">Linhas / peças</dt>
                    <dd>
                      {x.linhas} / {x.pecas}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#9a8089]">Custo</dt>
                    <dd>{brl(x.custo)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9a8089]">Venda potencial</dt>
                    <dd>{brl(x.venda)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9a8089]">Recebimento</dt>
                    <dd>
                      <Recebimento p={x} />
                    </dd>
                  </div>
                </dl>
              </Cartao>
            ))}
          </div>

          {/* Computador e tablet: tabela (rola de lado dentro do quadro se a janela for estreita). */}
          <Cartao className="hidden md:block">
            <div className="overflow-x-auto">
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
                    <th>Recebimento</th>
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
                      <td className="whitespace-nowrap">{dataBr(x.dataCompra)}</td>
                      <td className="whitespace-nowrap">
                        {moedaSimbolo(x.moeda)} 1 = R$ {num(x.cotacao, 4)}
                      </td>
                      <td>
                        {x.linhas} / {x.pecas}
                      </td>
                      <td className="whitespace-nowrap">{brl(x.custo)}</td>
                      <td className="whitespace-nowrap">{brl(x.venda)}</td>
                      <td>
                        <Recebimento p={x} />
                      </td>
                      <td>
                        <StatusPedido status={x.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      )}
    </div>
  );
}
