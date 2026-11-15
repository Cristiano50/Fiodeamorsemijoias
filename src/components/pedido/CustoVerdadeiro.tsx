"use client";
import { useEffect, useRef, useState } from "react";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, num } from "@/lib/cliente";
import { dataLocal, dataValida } from "@/lib/recebimento";
import type { EstadoEfetiva } from "@/lib/custo-real";
import { CampoNumero, apiSeGestora, mensagemDe, valorMoeda } from "./comum";

/**
 * Custo verdadeiro do pedido (item 27), só para a gestora (para a funcionária o quadro não aparece):
 *  - quanto foi pago de verdade (R$, cartão/agente) e quando → cotação efetiva = pago ÷ (total − créditos abatidos);
 *  - PTAX × efetiva, com a diferença em R$ e %; "Usar a cotação efetiva" (a PTAX fica guardada) e "Voltar para a PTAX";
 *  - perdas e defeitos (%) e embalagem e etiqueta (R$ por peça) deste pedido;
 *  - "Pagou imposto na chegada?": troca o cenário (mercadoria + frete ↔ remessa expressa com imposto).
 *
 * Uso na tela do pedido: <CustoVerdadeiro pedidoId={id} aoMudar={carregar} versao={d} />
 * `aoMudar`: os custos e preços mudaram (recarregar o pedido). `versao`: muda quando o pedido recarrega
 * (ex.: o objeto de dados da tela), para o quadro acompanhar cotação, total e créditos.
 */

interface DadosPagamento {
  pedido: { id: string; numero: string | null; moeda: string; cotacao: number; cotacaoFonte: string | null; cotacaoData: string | null; pagoEm: string | null; valorPagoBrl: number | null };
  totalMoeda: number;
  abatidosMoeda: number;
  baseMoeda: number;
  ptax: number;
  efetiva: number | null;
  estado: EstadoEfetiva;
  diferencaPct: number | null;
  diferencaBrl: number | null;
  cenario: { id: string; nome: string; comImposto: boolean };
  podeTrocarImposto: boolean;
  nomeCenarioComImposto: string;
  perdasPct: number;
  embalagemPorPeca: number;
  padroes: { perdasPct: number; embalagemPorPeca: number };
  pecas: number;
  custoTotal: number;
  fatorCusto: number;
  linhasCusto: { id: string; nome: string; valor: number }[];
}

const ESTADO: Record<EstadoEfetiva, { texto: string; cor: "verde" | "amarelo" | "cinza" | "rose" }> = {
  compra_em_reais: { texto: "compra em reais", cor: "cinza" },
  sem_pagamento: { texto: "falta o valor pago", cor: "cinza" },
  sem_base: { texto: "sem total para calcular", cor: "amarelo" },
  nao_aplicada: { texto: "usando a PTAX", cor: "rose" },
  aplicada: { texto: "✓ usando a cotação efetiva", cor: "verde" },
  desatualizada: { texto: "cotação efetiva desatualizada", cor: "amarelo" },
};

const cot = (v: number | null | undefined) => (v == null ? "—" : `R$ ${num(v, 4)}`);

export function CustoVerdadeiro({ pedidoId, aoMudar, versao }: { pedidoId: string; aoMudar?: () => void; versao?: unknown }) {
  const avisar = useAviso();
  const [d, setD] = useState<DadosPagamento | null | undefined>(undefined); // null = não é gestora
  const [ocupado, setOcupado] = useState("");
  const [hoje] = useState(() => dataLocal());

  useEffect(() => {
    apiSeGestora<DadosPagamento>(`/api/pedidos/${pedidoId}/pagamento`)
      .then(setD)
      .catch((e) => avisar(mensagemDe(e), "erro"));
  }, [pedidoId, versao, avisar]);

  async function salvar(corpo: Record<string, unknown>, rotulo: string, sucesso?: string) {
    setOcupado(rotulo);
    try {
      const r = await api<DadosPagamento>(`/api/pedidos/${pedidoId}/pagamento`, { method: "PATCH", json: corpo });
      setD(r);
      if (sucesso) avisar(sucesso);
      aoMudar?.();
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  if (d === null) return null;
  if (d === undefined)
    return (
      <Cartao titulo="Custo verdadeiro">
        <Carregando />
      </Cartao>
    );

  const moeda = d.pedido.moeda;
  const emReais = moeda === "BRL";
  const estado = ESTADO[d.estado];
  const usando = d.estado === "aplicada" || d.estado === "desatualizada";

  return (
    <Cartao titulo="Custo verdadeiro" acoes={<Selo cor={estado.cor}>{estado.texto}</Selo>}>
      <p className="mb-3 text-sm text-[#6b5560]">O que a loja pagou de verdade pela mercadoria, as perdas, a embalagem e o imposto. Só a gestora vê este quadro.</p>

      {emReais ? (
        <p className="rounded-xl bg-stone-50 p-3 text-sm text-[#6b5560]">Compra nacional em reais: o custo é o valor da nota, não há cotação a ajustar.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="Pago em">
              <DataPagamento valor={d.pedido.pagoEm} hoje={hoje} aoSalvar={(v) => salvar({ pagoEm: v }, "data")} />
            </Campo>
            <Campo rotulo="Valor pago (R$)" dica="O total que saiu do cartão ou foi pago ao agente pela mercadoria (sem o frete).">
              <CampoNumero valor={d.pedido.valorPagoBrl} placeholder="ex.: 6.543,21" rotulo="Valor pago em reais" disabled={!!ocupado} aoSalvar={(v) => salvar({ valorPagoBrl: v }, "valor")} />
            </Campo>
            <div className="flex flex-col gap-1 text-sm">
              <span className="rotulo">Total do pedido</span>
              <span>
                <b>{valorMoeda(d.totalMoeda, moeda)}</b>
                {d.abatidosMoeda > 0 && (
                  <>
                    {" "}
                    − créditos abatidos {valorMoeda(d.abatidosMoeda, moeda)} = <b>{valorMoeda(d.baseMoeda, moeda)}</b>
                  </>
                )}
              </span>
              <span className="text-xs text-[#9a8089]">cotação efetiva = valor pago ÷ {d.abatidosMoeda > 0 ? "(total − créditos)" : "total"}</span>
            </div>
          </div>

          {d.efetiva != null ? (
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-rose-claro/50 p-3 text-center">
              <div>
                <div className="rotulo">{usando ? "PTAX guardada" : "Cotação atual"}</div>
                <div className="font-titulo text-xl font-semibold">{cot(d.ptax)}</div>
              </div>
              <div>
                <div className="rotulo">Efetiva</div>
                <div className="font-titulo text-xl font-semibold text-rose-escuro">{cot(d.efetiva)}</div>
              </div>
              <div>
                <div className="rotulo">Diferença</div>
                <div className="font-titulo text-xl font-semibold">
                  {(d.diferencaPct ?? 0) > 0 ? "+" : ""}
                  {num(d.diferencaPct, 1)}%
                </div>
                <div className="text-xs text-[#8a6d78]">
                  {brl(Math.abs(d.diferencaBrl ?? 0))} {(d.diferencaBrl ?? 0) >= 0 ? "a mais" : "a menos"}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#8a6d78]">
              {d.estado === "sem_base" ? "O total do pedido (menos os créditos abatidos) está zerado." : "Informe o valor pago para comparar com a PTAX."}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {(d.estado === "nao_aplicada" || d.estado === "desatualizada") && d.efetiva != null && (
              <Botao className="py-2.5!" carregando={ocupado === "aplicar"} disabled={!!ocupado} onClick={() => salvar({ aplicarEfetiva: true }, "aplicar", "Os custos e preços passaram a usar a cotação efetiva.")}>
                {d.estado === "desatualizada" ? "Atualizar a cotação efetiva" : "Usar a cotação efetiva nos custos"}
              </Botao>
            )}
            {usando && (
              <Botao variante="secundario" className="py-2.5!" carregando={ocupado === "ptax"} disabled={!!ocupado} onClick={() => salvar({ voltarPtax: true }, "ptax", "Voltou para a PTAX.")}>
                Voltar para a PTAX ({cot(d.ptax)})
              </Botao>
            )}
            <span className="text-xs text-[#9a8089]">
              {usando
                ? "Com a cotação efetiva, o spread e o IOF ficam zerados (já estão no valor pago)."
                : d.estado === "nao_aplicada"
                  ? "A PTAX fica guardada: dá para voltar a qualquer momento."
                  : ""}
            </span>
          </div>
        </>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-borda pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Perdas e defeitos (%)" dica={<PadraoDica atual={d.perdasPct} padrao={d.padroes.perdasPct} texto={`${num(d.padroes.perdasPct, 1)}%`} aoUsar={() => salvar({ perdasPct: null }, "perdas")} />}>
          <CampoNumero valor={d.perdasPct} milhar={false} rotulo="Perdas e defeitos em %" disabled={!!ocupado} aoSalvar={(v) => salvar({ perdasPct: v }, "perdas")} />
        </Campo>
        <Campo
          rotulo="Embalagem e etiqueta (R$ por peça)"
          dica={<PadraoDica atual={d.embalagemPorPeca} padrao={d.padroes.embalagemPorPeca} texto={brl(d.padroes.embalagemPorPeca)} aoUsar={() => salvar({ embalagemPorPeca: null }, "embalagem")} />}
        >
          <CampoNumero valor={d.embalagemPorPeca} milhar={false} rotulo="Embalagem e etiqueta por peça" disabled={!!ocupado} aoSalvar={(v) => salvar({ embalagemPorPeca: v }, "embalagem")} />
        </Campo>
        {d.podeTrocarImposto && (
          <div className="flex flex-col gap-1">
            <span className="rotulo">Pagou imposto na chegada?</span>
            <div className="inline-flex w-fit rounded-full border border-rose bg-white p-0.5" role="group" aria-label="Pagou imposto na chegada?">
              {[
                [false, "Não"],
                [true, "Sim"],
              ].map(([valor, rotulo]) => (
                <button
                  key={String(valor)}
                  type="button"
                  disabled={!!ocupado}
                  aria-pressed={d.cenario.comImposto === valor}
                  onClick={() => d.cenario.comImposto !== valor && salvar({ impostoNaChegada: valor }, "imposto", valor ? "Custos com o imposto da chegada." : "Custos sem imposto (mercadoria + frete).")}
                  className={`min-h-10 min-w-16 rounded-full px-4 text-sm font-medium ${d.cenario.comImposto === valor ? "bg-rose-escuro text-white" : "text-rose-escuro"}`}
                >
                  {rotulo as string}
                </button>
              ))}
            </div>
            <span className="text-xs text-[#9a8089]">{d.cenario.comImposto ? `Cenário: ${d.cenario.nome}.` : `Sim = ${d.nomeCenarioComImposto}.`}</span>
          </div>
        )}
      </div>

      <div className="mt-4 text-sm text-[#6b5560]">
        Custo do pedido: <b>{brl(d.custoTotal)}</b> · {d.pecas} peça(s) · fator de custo {num(d.fatorCusto, 3)}
        {d.linhasCusto.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-rose-escuro">o que entra além da mercadoria</summary>
            <ul className="mt-1 grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
              {d.linhasCusto.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 border-b border-[#f3e8ec] py-0.5">
                  <span>{l.nome}</span>
                  <span className="whitespace-nowrap">{brl(l.valor)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Cartao>
  );
}

function PadraoDica({ atual, padrao, texto, aoUsar }: { atual: number; padrao: number; texto: string; aoUsar: () => void }) {
  if (Math.abs(atual - padrao) < 1e-9) return <>padrão da loja: {texto}</>;
  return (
    <>
      padrão da loja: {texto} ·{" "}
      <button type="button" onClick={aoUsar} className="text-rose-escuro underline">
        usar o padrão
      </button>
    </>
  );
}

/** Data do pagamento: grava ao escolher no calendário ou ao sair do campo. */
function DataPagamento({ valor, hoje, aoSalvar }: { valor: string | null; hoje: string; aoSalvar: (v: string | null) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gravar = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!v) {
      if (valor) aoSalvar(null);
      return;
    }
    if (v !== valor && dataValida(v) && v <= hoje) aoSalvar(v);
  };
  return (
    <input
      key={valor ?? ""}
      type="date"
      max={hoje}
      defaultValue={valor ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => gravar(v), 1200);
      }}
      onBlur={(e) => gravar(e.target.value)}
    />
  );
}
