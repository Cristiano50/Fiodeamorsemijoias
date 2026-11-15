"use client";
import Link from "next/link";
import { useState } from "react";
import { Botao, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, img } from "@/lib/cliente";

export interface CandidatoRecompra {
  id: string;
  referencia: string | null;
  nome: string | null;
  variacao: string | null;
  especificacao: string | null;
  imagemId: string | null;
  precoVenda: number | null;
  codigoBarras: string | null;
  codigoBarrasOrigem: string | null;
  pedidoId: string | null;
  pedidoNumero: string | null;
  dataCompra: string | null;
}

export interface RecompraAConfirmar {
  produtoId: string;
  linha: number | null;
  codigoFornecedor: string | null;
  especificacao: string | null;
  nome: string | null;
  imagemId: string | null;
  candidatos: CandidatoRecompra[];
}

function Foto({ id }: { id: string | null }) {
  const src = img(id, 160);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-rose-claro" />;
}

/**
 * Bloco "Recompra a confirmar" da tela do pedido (GET /api/pedidos/:id → recompraConfirmar).
 * Para cada peça, os originais possíveis com foto, referência e preço: [É esta] vira recompra (mesma referência,
 * código de barras, código do UP e preço vigente); [Não é recompra] vira peça nova. A decisão não é desfeita depois.
 */
export function ConfirmarRecompra({ itens, aoMudar }: { itens: RecompraAConfirmar[]; aoMudar: () => void }) {
  const avisar = useAviso();
  const [ocupado, setOcupado] = useState("");
  if (!itens.length) return null;

  async function decidir(produtoId: string, corpo: { original?: string; nova?: boolean }, msg: string) {
    setOcupado(produtoId);
    try {
      await api(`/api/produtos/${produtoId}/recompra`, { method: "POST", json: corpo });
      avisar(msg);
      aoMudar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  return (
    <Cartao titulo={`Recompra a confirmar (${itens.length})`}>
      <p className="mb-3 text-sm text-[#6b5560]">
        Estas peças podem ser recompra de mais de uma peça já cadastrada (ou o pedido está sem fornecedor). Escolha a peça original: a recompra fica com a
        mesma referência, o mesmo código de barras e o mesmo preço. Se for uma peça diferente, toque em <b>Não é recompra</b>.
      </p>
      <div className="flex flex-col divide-y divide-borda">
        {itens.map((it) => (
          <div key={it.produtoId} className="flex flex-col gap-3 py-3 lg:flex-row">
            <div className="flex gap-3 lg:w-72 lg:shrink-0">
              <Foto id={it.imagemId} />
              <div className="min-w-0 text-sm">
                <div className="text-xs text-[#9a8089]">
                  linha {it.linha ?? "?"} · <span className="font-mono">{it.codigoFornecedor}</span>
                  {it.especificacao ? ` · ${it.especificacao}` : ""}
                </div>
                <div className="font-medium uppercase">{it.nome ?? "Peça deste pedido"}</div>
                <Botao
                  variante="secundario"
                  className="mt-1"
                  carregando={ocupado === it.produtoId}
                  onClick={() => decidir(it.produtoId, { nova: true }, "Marcada como peça nova: ganha referência própria.")}
                >
                  Não é recompra
                </Botao>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {it.candidatos.map((c) => (
                <div key={c.id} className="flex gap-2 rounded-xl border border-borda p-2">
                  <Foto id={c.imagemId} />
                  <div className="min-w-0 flex-1 text-xs">
                    <Link href={`/produtos/${c.id}`} className="font-mono font-semibold text-rose-escuro underline">
                      {c.referencia ?? "sem referência"}
                    </Link>
                    <div className="truncate uppercase">{c.nome ?? "—"}</div>
                    <div className="text-[#9a8089]">{[c.especificacao, c.variacao].filter(Boolean).join(" · ") || "sem especificação"}</div>
                    <div className="text-[#9a8089]">
                      pedido {c.pedidoNumero ?? "?"}
                      {c.dataCompra ? ` de ${c.dataCompra.split("-").reverse().join("/")}` : ""}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-titulo text-base font-semibold text-rose-escuro">{brl(c.precoVenda)}</span>
                      {c.codigoBarrasOrigem === "up" && <Selo cor="verde">código do UP</Selo>}
                    </div>
                    <Botao
                      className="mt-1"
                      carregando={ocupado === it.produtoId}
                      onClick={() => decidir(it.produtoId, { original: c.id }, `Recompra de ${c.referencia} confirmada.`)}
                    >
                      É esta
                    </Botao>
                  </div>
                </div>
              ))}
              {!it.candidatos.length && <p className="text-xs text-[#9a8089]">As peças originais não existem mais: marque como peça nova.</p>}
            </div>
          </div>
        ))}
      </div>
    </Cartao>
  );
}
