"use client";
import Link from "next/link";
import { useState } from "react";
import { Botao, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, img, num } from "@/lib/cliente";

export interface CustoMudou {
  produtoId: string;
  linha: number | null;
  referencia: string | null;
  nome: string | null;
  imagemId: string | null;
  originalId: string;
  vigente: number;
  calculado: number;
  diferencaPct: number;
  custo: number;
}

interface Reetiquetar {
  referencia: string;
  antes: number | null;
  novo: number;
  pecasNaReferencia: number;
  reetiquetar: { id: string; referencia: string | null; nome: string | null; variacao: string | null; pedido: string | null; linha: number | null; pecas: number; fonte: string }[];
}

/**
 * Bloco "Custo mudou" da tela do pedido (GET /api/pedidos/:id → custoMudou).
 * A recompra mantém o preço vigente do original (mesma referência/código = um preço só no UP). Quando o preço pelo custo
 * novo difere mais de 10%, a gestora pode "Usar o preço novo para todas": muda o original e toda a cadeia e mostra
 * as peças com estoque para reetiquetar.
 */
export function PrecoVigente({ itens, ehGestora, aoMudar }: { itens: CustoMudou[]; ehGestora: boolean; aoMudar: () => void }) {
  const avisar = useAviso();
  const [ocupado, setOcupado] = useState("");
  const [feito, setFeito] = useState<Reetiquetar | null>(null);
  if (!itens.length && !feito) return null;

  async function usarNovo(it: CustoMudou) {
    if (
      !confirm(
        `Usar ${brl(it.calculado)} para todas as peças da referência ${it.referencia}?\n\nO original e todas as recompras passam a ${brl(it.calculado)} (hoje ${brl(it.vigente)}). Atualize o preço no UP e reetiquete as peças que estão em estoque.`,
      )
    )
      return;
    setOcupado(it.produtoId);
    try {
      const r = await api<Reetiquetar>(`/api/produtos/${it.produtoId}/preco-novo`, { method: "POST" });
      setFeito(r);
      avisar(`Preço novo de ${r.referencia}: ${brl(r.novo)} em ${r.pecasNaReferencia} peça(s). Atualize no UP.`);
      aoMudar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const totalPecas = feito?.reetiquetar.reduce((s, x) => s + x.pecas, 0) ?? 0;
  return (
    <Cartao titulo={`Custo mudou${itens.length ? ` (${itens.length})` : ""}`}>
      <p className="mb-3 text-sm text-[#6b5560]">
        A recompra continua com o preço do original (mesma referência e código de barras = um preço só no UP). Pelo custo deste pedido, o preço destas
        peças mudaria mais de 10%.{ehGestora ? "" : " Só a gestora pode trocar o preço de todas."}
      </p>
      {itens.length > 0 && (
        <div className="overflow-auto">
          <table className="tabela w-full text-sm">
            <thead>
              <tr>
                <th>Peça</th>
                <th>Preço vigente</th>
                <th>Pelo custo novo</th>
                <th>Diferença</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => (
                <tr key={it.produtoId}>
                  <td>
                    <div className="flex items-center gap-2">
                      {it.imagemId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img(it.imagemId, 120)!} alt="" loading="lazy" decoding="async" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-rose-claro" />
                      )}
                      <div className="text-xs">
                        <Link href={`/produtos/${it.originalId}`} className="font-mono font-semibold text-rose-escuro underline">
                          {it.referencia}
                        </Link>
                        <div className="uppercase">{it.nome ?? "—"}</div>
                        <div className="text-[#9a8089]">
                          linha {it.linha ?? "?"} · custo {brl(it.custo)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap font-titulo text-lg font-semibold">{brl(it.vigente)}</td>
                  <td className="whitespace-nowrap font-titulo text-lg font-semibold text-rose-escuro">{brl(it.calculado)}</td>
                  <td>
                    <Selo cor={it.diferencaPct > 0 ? "amarelo" : "verde"}>
                      {it.diferencaPct > 0 ? "+" : ""}
                      {num(it.diferencaPct, 0)}%
                    </Selo>
                  </td>
                  <td>
                    <Botao variante="secundario" disabled={!ehGestora} carregando={ocupado === it.produtoId} onClick={() => usarNovo(it)}>
                      Usar o preço novo para todas
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {feito && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>
              Reetiquetar {feito.referencia}: {brl(feito.antes)} → {brl(feito.novo)}
            </b>
            <Botao variante="fantasma" onClick={() => setFeito(null)}>
              Fechar
            </Botao>
          </div>
          {feito.reetiquetar.length ? (
            <>
              <p className="text-[#6b5560]">
                {totalPecas} peça(s) com estoque para trocar a etiqueta. Atualize também o preço no UP Vendas.
              </p>
              <ul className="mt-1 list-disc pl-5 text-[#6b5560]">
                {feito.reetiquetar.map((x) => (
                  <li key={x.id}>
                    {x.pecas} × {x.nome ?? x.referencia}
                    {x.variacao ? ` (${x.variacao})` : ""} — pedido {x.pedido ?? "avulso"}
                    {x.linha ? `, linha ${x.linha}` : ""} <span className="text-xs text-[#9a8089]">({x.fonte})</span>
                  </li>
                ))}
              </ul>
              <Link href={`/etiquetas?ids=${feito.reetiquetar.map((x) => x.id).join(",")}`} className="mt-2 inline-block">
                <Botao variante="secundario">Imprimir as etiquetas novas</Botao>
              </Link>
            </>
          ) : (
            <p className="text-[#6b5560]">Nenhuma peça desta referência em estoque: não precisa reetiquetar. Atualize o preço no UP Vendas.</p>
          )}
        </div>
      )}
    </Cartao>
  );
}
