"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Botao, Cartao, Selo, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";
import { dataBr } from "@/lib/recebimento";
import { apiSeGestora, mensagemDe, valorMoeda, type CreditoTela } from "./comum";

/**
 * Créditos com o fornecedor (item 30), só para a gestora:
 *  - em aberto, do mesmo fornecedor (nascidos em outros pedidos): [Abater neste pedido] e [Cancelar];
 *  - abatidos neste pedido (entram na cotação efetiva): [Desfazer];
 *  - gerados pela conferência deste pedido (o que o fornecedor ficou devendo).
 * Sem nenhum crédito, o quadro não aparece.
 *
 * Uso na tela do pedido: <CreditosFornecedor pedidoId={id} aoMudar={carregar} versao={d} />
 * `aoMudar`: um crédito foi abatido/desfeito (a cotação efetiva e os preços podem ter mudado).
 */

interface DadosCreditos {
  pedido: { id: string; numero: string | null; moeda: string; fornecedor: string | null; fornecedorApelido: string | null; chave: string };
  disponiveis: CreditoTela[];
  abatidos: CreditoTela[];
  gerados: CreditoTela[];
  totalAbatido: number;
}

const somar = (lista: CreditoTela[], moeda: string) => lista.filter((c) => c.moeda === moeda).reduce((s, c) => s + c.valorMoeda, 0);

export function CreditosFornecedor({ pedidoId, aoMudar, versao }: { pedidoId: string; aoMudar?: () => void; versao?: unknown }) {
  const avisar = useAviso();
  const [d, setD] = useState<DadosCreditos | null | undefined>(undefined); // null = não é gestora
  const [ocupado, setOcupado] = useState("");

  const carregar = useCallback(() => apiSeGestora<DadosCreditos>(`/api/creditos?pedido=${encodeURIComponent(pedidoId)}`).then(setD), [pedidoId]);
  useEffect(() => {
    carregar().catch((e) => avisar(mensagemDe(e), "erro"));
  }, [carregar, versao, avisar]);

  async function alterar(c: CreditoTela, acao: "abater" | "cancelar" | "reabrir", sucesso: string, pergunta?: string) {
    if (pergunta && !confirm(pergunta)) return;
    setOcupado(`${c.id}:${acao}`);
    try {
      const r = await api<{ recalculados: string[] }>(`/api/creditos/${c.id}`, { method: "PATCH", json: { acao, pedidoId } });
      await carregar();
      avisar(r.recalculados?.includes(pedidoId) ? `${sucesso} A cotação efetiva e os preços foram recalculados.` : sucesso);
      aoMudar?.();
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  if (!d) return null;
  const { pedido } = d;
  const geradosVisiveis = d.gerados.filter((c) => c.status !== "cancelado" || c.quantidade > 0);
  if (!d.disponiveis.length && !d.abatidos.length && !geradosVisiveis.length) return null;
  const nome = pedido.fornecedorApelido ?? pedido.fornecedor ?? "o fornecedor";
  const disponivelNaMoeda = somar(
    d.disponiveis.filter((c) => !c.motivoNaoAbater),
    pedido.moeda,
  );

  return (
    <Cartao
      titulo="Créditos com o fornecedor"
      acoes={
        <Link href="/fornecedores" className="text-sm text-rose-escuro underline">
          conta do fornecedor →
        </Link>
      }
    >
      {d.disponiveis.length > 0 && (
        <section>
          <p className="text-sm text-[#6b5560]">
            {nome} deve <b>{valorMoeda(disponivelNaMoeda, pedido.moeda)}</b> de pedidos anteriores (faltas e defeitos). Quando ele descontar no valor deste pedido, toque em <b>Abater neste pedido</b>: o
            desconto entra na cotação efetiva.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {d.disponiveis.map((c) => (
              <LinhaCredito key={c.id} c={c} origem={`pedido ${c.pedidoNumero ?? "—"}`}>
                {c.motivoNaoAbater ? (
                  <span title={c.motivoNaoAbater}>
                    <Selo cor="cinza">não dá para abater aqui</Selo>
                  </span>
                ) : (
                  <Botao carregando={ocupado === `${c.id}:abater`} disabled={!!ocupado} onClick={() => alterar(c, "abater", "Crédito abatido neste pedido.")}>
                    Abater neste pedido
                  </Botao>
                )}
                <Botao
                  variante="fantasma"
                  carregando={ocupado === `${c.id}:cancelar`}
                  disabled={!!ocupado}
                  onClick={() => alterar(c, "cancelar", "Crédito cancelado.", "Cancelar este crédito? Use quando o fornecedor não vai pagar nem repor.")}
                >
                  Cancelar crédito
                </Botao>
              </LinhaCredito>
            ))}
          </ul>
        </section>
      )}

      {d.abatidos.length > 0 && (
        <section className={d.disponiveis.length ? "mt-4 border-t border-borda pt-3" : ""}>
          <div className="text-sm font-medium">
            Abatido neste pedido: <span className="text-rose-escuro">{valorMoeda(d.totalAbatido, pedido.moeda)}</span>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {d.abatidos.map((c) => (
              <LinhaCredito key={c.id} c={c} origem={`do pedido ${c.pedidoNumero ?? "—"}`}>
                <Botao variante="secundario" carregando={ocupado === `${c.id}:reabrir`} disabled={!!ocupado} onClick={() => alterar(c, "reabrir", "Abatimento desfeito: o crédito voltou a ficar em aberto.")}>
                  Desfazer
                </Botao>
              </LinhaCredito>
            ))}
          </ul>
        </section>
      )}

      {geradosVisiveis.length > 0 && (
        <section className={d.disponiveis.length || d.abatidos.length ? "mt-4 border-t border-borda pt-3" : ""}>
          <div className="text-sm font-medium">Gerados na conferência deste pedido</div>
          <ul className="mt-2 flex flex-col gap-2">
            {geradosVisiveis.map((c) => (
              <LinhaCredito key={c.id} c={c} origem={c.status === "abatido" ? `abatido no pedido ${c.abatidoPedidoNumero ?? "—"}` : c.status === "cancelado" ? "cancelado" : "em aberto"}>
                {c.status === "aberto" && (
                  <Botao
                    variante="fantasma"
                    carregando={ocupado === `${c.id}:cancelar`}
                    disabled={!!ocupado}
                    onClick={() => alterar(c, "cancelar", "Crédito cancelado.", "Cancelar este crédito? Use quando o fornecedor não vai pagar nem repor.")}
                  >
                    Cancelar crédito
                  </Botao>
                )}
                {c.status === "cancelado" && (
                  <Botao variante="fantasma" carregando={ocupado === `${c.id}:reabrir`} disabled={!!ocupado} onClick={() => alterar(c, "reabrir", "Crédito reaberto.")}>
                    Reabrir
                  </Botao>
                )}
              </LinhaCredito>
            ))}
          </ul>
        </section>
      )}
    </Cartao>
  );
}

function LinhaCredito({ c, origem, children }: { c: CreditoTela; origem: string; children?: React.ReactNode }) {
  return (
    <li className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${c.status === "cancelado" ? "border-borda bg-stone-50 text-[#9a8089]" : "border-borda"}`}>
      <div className="min-w-0">
        <div className="text-sm">{c.descricao}</div>
        <div className="text-xs text-[#9a8089]">
          {origem} · {c.quantidade} peça(s) · {dataBr(c.criadoEm)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <b className="whitespace-nowrap font-titulo text-lg text-rose-escuro">{valorMoeda(c.valorMoeda, c.moeda)}</b>
        {children}
      </div>
    </li>
  );
}
