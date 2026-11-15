"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Botao, Campo, Carregando, Cartao, Numero, useAviso } from "@/components/ui";
import { useConfig } from "@/components/hooks";
import { api, brl, num } from "@/lib/cliente";

type Linha = { chave: string | null; chamadas: number; imagens: number; custo: number };
type Dados = {
  mes: string;
  total: number;
  limite: number;
  dolar: { valor: number; data: string } | null;
  precos: Record<string, { entradaPorMilhao?: number; saidaPorMilhao?: number; porImagem?: number }>;
  porFinalidade: Linha[];
  porModelo: Linha[];
  porServico: Linha[];
  porPedido: { pedidoId: string | null; numero: string | null; chamadas: number; imagens: number; custo: number; pecas: number }[];
  porDia: { dia: string; custo: number }[];
};

const FINALIDADE: Record<string, string> = {
  analise: "Análise das peças (classificação, nomes)",
  deteccao: "Localizar peças em fotos de catálogo",
  parecer: "Parecer dos especialistas",
  textos: "Legendas e hashtags",
  foto: "Fotos com IA",
  avaliacao_foto: "Avaliação das fotos pelo marketing",
};

const usd = (v: number) => `US$ ${num(v, 2)}`;

export default function GastosPage() {
  const avisar = useAviso();
  const { config, recarregar } = useConfig();
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [d, setD] = useState<Dados | null>(null);
  const [limite, setLimite] = useState<string>("");
  const [precos, setPrecos] = useState<Dados["precos"]>({});
  const carregar = useCallback(
    () =>
      api<Dados>(`/api/gastos?mes=${mes}`).then((r) => {
        setD(r);
        setPrecos(r.precos ?? {});
      }),
    [mes],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  async function salvarLimite() {
    if (!config) return;
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { ...config.sistema, limiteMensalIaUsd: Number(limite.replace(",", ".")) || 0 } } });
      await recarregar();
      await carregar();
      avisar("Limite mensal salvo.");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  async function salvarPrecos() {
    if (!config) return;
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { ...config.sistema, precosIa: precos } } });
      await recarregar();
      avisar("Tabela de preços salva. Vale para as próximas chamadas.");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  if (!d) return <Carregando />;
  const real = (v: number) => (d.dolar ? brl(v * d.dolar.valor) : "—");
  const fotos = d.porFinalidade.find((f) => f.chave === "foto");
  const maxDia = Math.max(0.0001, ...d.porDia.map((x) => x.custo));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Gastos com IA</h1>
          <p className="text-sm text-[#8a6d78]">Estimativa pelos tokens e imagens de cada chamada, com a tabela de preços abaixo. Confira a fatura de cada serviço.</p>
        </div>
        <Campo rotulo="Mês">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </Campo>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero rotulo="Total do mês" valor={usd(d.total)} detalhe={d.dolar ? `≈ ${real(d.total)} (dólar PTAX ${num(d.dolar.valor, 4)})` : "sem cotação do dólar"} />
        <Numero rotulo="Fotos geradas" valor={fotos?.imagens ?? 0} detalhe={fotos ? `${usd(fotos.custo)} · média ${usd(fotos.custo / Math.max(1, fotos.imagens))}/foto` : "—"} />
        <Numero rotulo="Chamadas" valor={d.porServico.reduce((s, r) => s + r.chamadas, 0)} detalhe={d.porServico.map((s) => `${s.chave}: ${s.chamadas}`).join(" · ") || "—"} />
        <Numero
          rotulo="Limite mensal"
          valor={d.limite ? usd(d.limite) : "sem limite"}
          detalhe={d.limite ? `${num((d.total / d.limite) * 100, 0)}% usado` : "defina abaixo"}
        />
      </div>

      {d.limite > 0 && (
        <div className="h-3 rounded-full bg-rose-claro">
          <div className={`h-3 rounded-full ${d.total >= d.limite ? "bg-red-600" : "bg-rose-escuro"}`} style={{ width: `${Math.min(100, (d.total / d.limite) * 100)}%` }} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Por finalidade" className="min-w-0">
          <div className="overflow-x-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Uso</th>
                  <th>Chamadas</th>
                  <th>Custo</th>
                </tr>
              </thead>
              <tbody>
                {d.porFinalidade.map((r) => (
                  <tr key={r.chave}>
                    <td>{FINALIDADE[r.chave ?? ""] ?? r.chave}</td>
                    <td>
                      {r.chamadas}
                      {r.imagens ? ` · ${r.imagens} img` : ""}
                    </td>
                    <td className="whitespace-nowrap">
                      {usd(r.custo)} <span className="text-xs text-[#9a8089]">{real(r.custo)}</span>
                    </td>
                  </tr>
                ))}
                {!d.porFinalidade.length && (
                  <tr>
                    <td colSpan={3} className="text-[#8a6d78]">
                      Nenhum uso neste mês.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Cartao>
        <Cartao titulo="Por pedido" className="min-w-0">
          <div className="overflow-x-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Peças</th>
                  <th>Custo</th>
                  <th>Por peça</th>
                </tr>
              </thead>
              <tbody>
                {d.porPedido.map((r) => (
                  <tr key={r.pedidoId ?? "avulso"}>
                    <td>{r.pedidoId ? <Link href={`/pedidos/${r.pedidoId}`} className="text-rose-escuro hover:underline">{r.numero ?? r.pedidoId.slice(0, 8)}</Link> : "Avulso"}</td>
                    <td>{r.pecas}</td>
                    <td className="whitespace-nowrap">{usd(r.custo)}</td>
                    <td className="whitespace-nowrap">{r.pecas ? usd(r.custo / r.pecas) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      </div>

      <Cartao titulo="Por dia">
        {/* Até 31 barras: no celular o gráfico rola de lado dentro do quadro em vez de alargar a página. */}
        <div className="overflow-x-auto">
          <div className="flex h-32 items-end gap-1">
            {d.porDia.map((x) => (
              <div key={x.dia} className="flex h-full min-w-[14px] flex-1 flex-col items-center gap-1" title={`${x.dia.split("-").reverse().join("/")}: ${usd(x.custo)}`}>
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t bg-rose" style={{ height: `${(x.custo / maxDia) * 100}%`, minHeight: 2 }} />
                </div>
                <span className="text-[0.6rem] text-[#9a8089]">{x.dia.slice(8)}</span>
              </div>
            ))}
            {!d.porDia.length && <p className="text-sm text-[#8a6d78]">Sem uso no período.</p>}
          </div>
        </div>
      </Cartao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Limite mensal" className="min-w-0">
          <p className="mb-3 text-sm text-[#6b5560]">Ao atingir o limite, o app para de chamar a IA até o mês seguinte (ou até você aumentar). 0 = sem limite.</p>
          <div className="flex flex-wrap gap-2">
            <input inputMode="decimal" placeholder={d.limite ? String(d.limite) : "ex.: 30"} value={limite} onChange={(e) => setLimite(e.target.value)} className="w-40" />
            <Botao onClick={salvarLimite}>Salvar limite (US$)</Botao>
          </div>
        </Cartao>
        <Cartao titulo="Tabela de preços usada (US$)" className="min-w-0" acoes={<Botao variante="secundario" onClick={salvarPrecos}>Salvar preços</Botao>}>
          <div className="overflow-x-auto">
            <table className="tabela w-full text-xs">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Entrada / 1M tokens</th>
                  <th>Saída / 1M tokens</th>
                  <th>Por imagem</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(precos).map(([m, p]) => (
                  <tr key={m}>
                    <td className="font-mono">{m}</td>
                    {(["entradaPorMilhao", "saidaPorMilhao", "porImagem"] as const).map((k) => (
                      <td key={k}>
                        <input
                          inputMode="decimal"
                          className="w-20"
                          value={p[k] ?? ""}
                          onChange={(e) => setPrecos((x) => ({ ...x, [m]: { ...x[m], [k]: e.target.value === "" ? undefined : Number(e.target.value.replace(",", ".")) } }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#9a8089]">Valores de referência. Confira os preços atuais nas páginas da Anthropic, do Google e da OpenAI.</p>
        </Cartao>
      </div>
    </div>
  );
}
