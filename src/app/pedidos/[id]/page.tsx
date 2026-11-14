"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pedido, Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Numero, Selo, useAviso } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, img, moedaSimbolo, num } from "@/lib/cliente";

interface Cenario {
  nome: string;
  aplica_quando?: string;
  observacao?: string;
  valores: Record<string, number>;
}
interface Dados {
  pedido: Pedido;
  produtos: Produto[];
  linhas: number;
  pecas: number;
  totalOrigem: number;
  totalDocumento: number | null;
  diferencaDocumento: number | null;
  custoTotal: number;
  vendaPotencial: number;
  receitaLiquidaPotencial: number;
  margemBrutaPct: number;
  fatorMedio: number;
  semCodigo: number;
  semAnalise: number;
  comAlerta: number;
  paginasPendentes: number;
  valoresCusto: Record<string, number>;
  detalheCustos: { mercadoriaBrl: number; linhas: { id: string; nome: string; valor: number }[]; adicionaisBrl: number; porPecaBrl: number; fatorCusto: number; custoTotalPedidoBrl: number } | null;
  componentesCusto: { id: string; nome: string; tipo: string; padrao: number; explicacao?: string }[];
  cenarios: { padrao: string; cenarios: Record<string, Cenario> };
  fotosModelo: Record<string, { id: string; aprovada: boolean | null; nota: number | null }>;
}
type Parecer = { resumo: string; estoque: string; contador: string; administrador: string; marketing: string; pendencias: string[]; geradoEm?: string };

export default function PedidoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [d, setD] = useState<Dados | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState("");
  const [progresso, setProgresso] = useState("");
  const [abaParecer, setAbaParecer] = useState<"resumo" | "estoque" | "contador" | "administrador" | "marketing">("resumo");
  const [mostrarCustos, setMostrarCustos] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [fotos, setFotos] = useState<{ rodando: boolean; feitas: number; total: number; aprovadas: number; msg: string } | null>(null);
  const parar = useRef(false);
  const autoIniciou = useRef(false);

  const carregar = useCallback(() => api<Dados>(`/api/pedidos/${id}`).then(setD), [id]);
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  async function acao(rotulo: string, fn: () => Promise<unknown>, sucesso?: string) {
    setOcupado(rotulo);
    try {
      await fn();
      if (sucesso) avisar(sucesso);
      await carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
      setProgresso("");
    }
  }

  const salvarPedido = (campos: Record<string, unknown>) => acao("salvar", () => api(`/api/pedidos/${id}`, { method: "PATCH", json: campos }));

  const analisar = (ids?: string[]) =>
    acao(
      "ia",
      async () => {
        if (d?.paginasPendentes) {
          for (let r = { restantes: 1 }; r.restantes; ) {
            r = await api(`/api/pedidos/${id}/detectar`, { method: "POST", json: {} });
            setProgresso(`Localizando peças nas fotos… faltam ${r.restantes}`);
          }
        }
        if (ids?.length) {
          for (let i = 0; i < ids.length; i += 6) {
            setProgresso(`IA reanalisando ${Math.min(i + 6, ids.length)}/${ids.length}…`);
            await api(`/api/pedidos/${id}/analisar`, { method: "POST", json: { ids: ids.slice(i, i + 6) } });
          }
          return;
        }
        for (let r = { restantes: 1 }; r.restantes; ) {
          r = await api(`/api/pedidos/${id}/analisar`, { method: "POST", json: {} });
          setProgresso(`IA analisando… faltam ${r.restantes}`);
        }
      },
      "Análise da IA concluída.",
    );

  /** Fotos com modelo (IA) aprovadas pelo marketing, uma peça por vez. */
  const gerarFotos = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return avisar("Todas as peças já têm foto com modelo aprovada.", "info");
      parar.current = false;
      let aprovadas = 0;
      setFotos({ rodando: true, feitas: 0, total: ids.length, aprovadas: 0, msg: "Gerando a primeira foto…" });
      for (let i = 0; i < ids.length; i++) {
        if (parar.current) break;
        try {
          const r = await api<{ aprovada: boolean | null; avaliacao: { nota: number } | null; tentativas: unknown[] }>(`/api/produtos/${ids[i]}/ia`, { method: "POST", json: {} });
          if (r.aprovada !== false) aprovadas++;
          setFotos({
            rodando: true,
            feitas: i + 1,
            total: ids.length,
            aprovadas,
            msg:
              r.aprovada === null
                ? `Foto ${i + 1}: gerada (sem avaliação — configure a chave do Claude)`
                : `Foto ${i + 1}: ${r.aprovada ? "aprovada" : "reprovada"} pelo marketing (nota ${r.avaliacao?.nota?.toFixed(1)}, ${r.tentativas.length} tentativa(s))`,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setFotos((f) => (f ? { ...f, feitas: i + 1, msg: `Foto ${i + 1}: erro — ${msg}` } : f));
          if (/chave|Configure|desativad/i.test(msg)) {
            avisar(msg, "erro");
            break;
          }
        }
        await carregar();
      }
      setFotos((f) => (f ? { ...f, rodando: false } : f));
      avisar(`Fotos com modelo: ${aprovadas} aprovada(s).`);
    },
    [avisar, carregar],
  );

  const pendentesFoto = useMemo(() => (d ? d.produtos.filter((p) => !d.fotosModelo[p.id]?.aprovada).map((p) => p.id) : []), [d]);

  useEffect(() => {
    if (!d || autoIniciou.current) return;
    autoIniciou.current = true;
    if (new URLSearchParams(window.location.search).get("fotos") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      // Vindo da importação: começa a gerar as fotos assim que a tela abre.
      const ids = pendentesFoto;
      setTimeout(() => gerarFotos(ids), 0);
    }
  }, [d, gerarFotos, pendentesFoto]);

  const lote = (acaoLote: string, dados?: Record<string, unknown>, msg?: string) =>
    acao(acaoLote, () => api("/api/produtos/lote", { method: "POST", json: { ids: [...sel], acao: acaoLote, dados } }), msg);

  const editar = (p: Produto, campos: Record<string, unknown>) =>
    api<{ produto: Produto }>(`/api/produtos/${p.id}`, { method: "PATCH", json: campos })
      .then(() => carregar())
      .catch((e) => avisar(e.message, "erro"));

  const produtos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (d?.produtos ?? []).filter(
      (p) => !f || [p.nome, p.codigoFornecedor, p.traducao, p.referencia, p.tipo, p.codigoBarras].some((x) => x?.toLowerCase().includes(f)),
    );
  }, [d, filtro]);

  if (!d) return <Carregando />;
  const { pedido } = d;
  const parecer = pedido.parecer as Parecer | null;
  const cenarioAtual = pedido.cenario ?? d.cenarios.padrao;
  const todosSel = produtos.length > 0 && produtos.every((p) => sel.has(p.id));
  const idsSel = [...sel].join(",");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/pedidos" className="text-xs text-[#9a8089]">
            ← Pedidos
          </Link>
          <h1 className="text-4xl font-semibold">Pedido {pedido.numero ?? "sem número"}</h1>
          <p className="text-sm text-[#8a6d78]">
            {pedido.fornecedor ?? "Fornecedor não informado"} · compra em {pedido.dataCompra?.split("-").reverse().join("/")} · {pedido.arquivoNome}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(d.semAnalise > 0 || d.paginasPendentes > 0) && (
            <Botao onClick={() => analisar()} carregando={ocupado === "ia"}>
              ✦ Analisar com IA ({d.semAnalise + d.paginasPendentes})
            </Botao>
          )}
          <Botao variante="secundario" onClick={() => gerarFotos(sel.size ? [...sel] : pendentesFoto)} disabled={!!fotos?.rodando}>
            📷 Fotos com modelo {sel.size ? `(${sel.size})` : pendentesFoto.length ? `(${pendentesFoto.length})` : ""}
          </Botao>
          <Botao variante="secundario" onClick={() => acao("codigos", () => api(`/api/pedidos/${id}/codigos`, { method: "POST", json: {} }), "Referências e códigos de barras gerados.")} carregando={ocupado === "codigos"}>
            Gerar referências e EAN {d.semCodigo ? `(${d.semCodigo})` : ""}
          </Botao>
          <Botao variante="secundario" onClick={() => acao("parecer", () => api(`/api/pedidos/${id}/parecer`, { method: "POST" }), "Parecer dos especialistas pronto.")} carregando={ocupado === "parecer"}>
            ♡ Parecer dos especialistas
          </Botao>
          <Link href={`/etiquetas?pedido=${id}`}>
            <Botao variante="secundario">Etiquetas</Botao>
          </Link>
          <a href={`/api/exportar?formato=xlsx&pedido=${id}`}>
            <Botao variante="secundario">Planilha UP</Botao>
          </a>
          <Link href={`/up-vendas?pedido=${id}`}>
            <Botao variante="secundario">Enviar ao UP</Botao>
          </Link>
        </div>
      </div>

      {progresso && <div className="rounded-xl bg-rose-claro px-4 py-2 text-sm text-rose-escuro">{progresso}</div>}
      {fotos && (
        <div className="rounded-xl border border-rose bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>Fotos com modelo (IA)</b> — {fotos.feitas}/{fotos.total} · {fotos.aprovadas} aprovada(s) pelo marketing · {fotos.msg}
            </span>
            {fotos.rodando ? (
              <Botao variante="perigo" onClick={() => (parar.current = true)}>
                Parar
              </Botao>
            ) : (
              <Botao variante="fantasma" onClick={() => setFotos(null)}>
                Fechar
              </Botao>
            )}
          </div>
          <div className="mt-2 h-2 rounded-full bg-rose-claro">
            <div className="h-2 rounded-full bg-rose-escuro transition-all" style={{ width: `${(fotos.feitas / Math.max(1, fotos.total)) * 100}%` }} />
          </div>
          {fotos.rodando && <p className="mt-1 text-xs text-[#9a8089]">Cada foto leva de 30 s a 2 min (gera, o marketing avalia e, se reprovar, gera de novo). Deixe esta página aberta.</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Numero rotulo="Linhas · peças" valor={`${d.linhas} · ${d.pecas}`} detalhe={d.comAlerta ? `${d.comAlerta} com alerta` : "sem alertas"} />
        <Numero
          rotulo={`Total em ${moedaSimbolo(pedido.moeda)}`}
          valor={num(d.totalOrigem)}
          detalhe={
            d.totalDocumento != null ? (Math.abs(d.diferencaDocumento ?? 0) < 0.05 ? "✓ confere com o documento" : `documento: ${num(d.totalDocumento)}`) : "—"
          }
        />
        <Numero rotulo="Custo total" valor={brl(d.custoTotal)} detalhe={`fator de custo ${num(d.detalheCustos?.fatorCusto ?? 1, 3)}`} />
        <Numero rotulo="Venda potencial" valor={brl(d.vendaPotencial)} detalhe="tabela CONSIGNADO" />
        <Numero rotulo="Margem após comissão" valor={`${num(d.margemBrutaPct, 1)}%`} detalhe={`líquido ${brl(d.receitaLiquidaPotencial)}`} />
        <Numero rotulo="Markup médio" valor={`× ${num(d.fatorMedio)}`} detalhe="preço ÷ custo" />
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-rose bg-white px-5 py-4">
        <div className="min-w-[220px]">
          <div className="rotulo">Fator multiplicador do pedido</div>
          <input
            key={`fator-${pedido.fator ?? ""}`}
            inputMode="decimal"
            placeholder={`padrão × ${num(Number(config?.precificacao.fator_padrao ?? 10), 0)}`}
            defaultValue={pedido.fator ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim().replace(",", ".");
              const novo = v ? Number(v) : null;
              if (novo !== pedido.fator && (novo === null || novo > 0)) salvarPedido({ fator: novo });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="mt-1 w-40 border-rose font-titulo text-3xl font-semibold text-rose-escuro"
          />
        </div>
        <p className="max-w-xl text-sm text-[#6b5560]">
          Digite o fator escolhido para este pedido (ex.: 10, 11, 12). <b>Preço = custo da peça × fator</b>, terminando em ,99. Vale para todas as peças; para uma
          peça específica, use a coluna <b>Fator</b> da tabela (em branco = fator do pedido).
        </p>
        <div className="ml-auto text-right">
          <div className="rotulo">Venda potencial</div>
          <div className="font-titulo text-2xl font-semibold text-rose-escuro">{brl(d.vendaPotencial)}</div>
        </div>
      </div>

      <Cartao
        titulo="Câmbio e custo de aquisição"
        acoes={
          <Botao variante="fantasma" onClick={() => setMostrarCustos((v) => !v)}>
            {mostrarCustos ? "Esconder detalhes" : "Ver componentes de custo"}
          </Botao>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <Campo rotulo="Data da compra">
            <input type="date" defaultValue={pedido.dataCompra ?? ""} onBlur={(e) => e.target.value !== pedido.dataCompra && salvarPedido({ dataCompra: e.target.value })} />
          </Campo>
          <Campo rotulo="Moeda">
            <select value={pedido.moeda} onChange={(e) => salvarPedido({ moeda: e.target.value })}>
              <option value="CNY">Yuan (CNY)</option>
              <option value="BRL">Real (BRL)</option>
              <option value="USD">Dólar (USD)</option>
            </select>
          </Campo>
          <Campo rotulo={`Cotação R$ / ${moedaSimbolo(pedido.moeda)}`} dica={`${pedido.cotacaoFonte ?? "—"}${pedido.cotacaoData ? ` · ${pedido.cotacaoData.split("-").reverse().join("/")}` : ""}`}>
            <div className="flex gap-1">
              <input
                key={pedido.cotacao}
                type="number"
                step="0.0001"
                defaultValue={pedido.cotacao}
                onBlur={(e) => Number(e.target.value) !== pedido.cotacao && salvarPedido({ cotacao: Number(e.target.value), dataCompra: pedido.dataCompra })}
              />
              <Botao variante="secundario" title="Buscar PTAX do dia da compra" onClick={() => acao("ptax", () => api(`/api/pedidos/${id}/cotacao`, { method: "POST" }), "Cotação PTAX atualizada.")} carregando={ocupado === "ptax"}>
                PTAX
              </Botao>
            </div>
          </Campo>
          <Campo rotulo="Cenário de custo" className="md:col-span-2" dica={d.cenarios.cenarios[cenarioAtual]?.aplica_quando}>
            <select value={cenarioAtual} onChange={(e) => salvarPedido({ cenario: e.target.value })}>
              {Object.entries(d.cenarios.cenarios).map(([k, c]) => (
                <option key={k} value={k}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Rateio dos fixos">
            <select value={pedido.rateio} onChange={(e) => salvarPedido({ rateio: e.target.value })}>
              <option value="valor">Por valor (recomendado)</option>
              <option value="peca">Por peça</option>
            </select>
          </Campo>
        </div>
        {d.detalheCustos && (
          <p className="mt-3 text-sm text-[#6b5560]">
            Mercadoria {brl(d.detalheCustos.mercadoriaBrl)} + adicionais {brl(d.detalheCustos.adicionaisBrl)}
            {d.detalheCustos.porPecaBrl ? ` + ${brl(d.detalheCustos.porPecaBrl)}/peça` : ""} = <b>{brl(d.detalheCustos.custoTotalPedidoBrl)}</b> (fator de custo{" "}
            {num(d.detalheCustos.fatorCusto, 3)}). Preço de venda = custo da peça × fator multiplicador (Configurações → Precificação).
          </p>
        )}
        {mostrarCustos && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-borda pt-4 md:grid-cols-3 lg:grid-cols-5">
            {d.componentesCusto.map((c) => (
              <Campo key={c.id} rotulo={`${c.nome} ${c.tipo === "percentual" ? "(%)" : c.tipo === "valor_por_peca" ? "(R$/peça)" : "(R$)"}`} dica={d.detalheCustos?.linhas.find((l) => l.id === c.id) ? brl(d.detalheCustos.linhas.find((l) => l.id === c.id)!.valor) : undefined}>
                <input
                  type="number"
                  step="0.01"
                  key={`${c.id}-${d.valoresCusto[c.id]}`}
                  defaultValue={d.valoresCusto[c.id] ?? c.padrao}
                  title={c.explicacao}
                  onBlur={(e) => Number(e.target.value) !== d.valoresCusto[c.id] && salvarPedido({ custos: { ...d.valoresCusto, [c.id]: Number(e.target.value) } })}
                />
              </Campo>
            ))}
          </div>
        )}
      </Cartao>

      {parecer && (
        <Cartao titulo="Parecer dos especialistas" acoes={<span className="text-xs text-[#9a8089]">{parecer.geradoEm ? new Date(parecer.geradoEm).toLocaleString("pt-BR") : ""}</span>}>
          <div className="mb-3 flex flex-wrap gap-1">
            {(
              [
                ["resumo", "Resumo"],
                ["estoque", "Gestor de estoque"],
                ["contador", "Contador"],
                ["administrador", "Administrador"],
                ["marketing", "Marketing"],
              ] as const
            ).map(([k, r]) => (
              <button key={k} onClick={() => setAbaParecer(k)} className={`rounded-full px-3 py-1 text-sm ${abaParecer === k ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
                {r}
              </button>
            ))}
          </div>
          <Markdown texto={parecer[abaParecer]} />
          {abaParecer === "resumo" && parecer.pendencias?.length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
              <b>Decisões pendentes:</b>
              <ul className="ml-5 list-disc">
                {parecer.pendencias.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </Cartao>
      )}

      <Cartao
        titulo={`Peças (${produtos.length})`}
        acoes={<input placeholder="Filtrar por nome, código, referência…" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-64" />}
      >
        {sel.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-rose-claro p-2 text-sm">
            <b className="px-2">{sel.size} selecionada(s)</b>
            <Botao variante="secundario" onClick={() => lote("aprovar", undefined, "Aprovadas.")}>
              Aprovar
            </Botao>
            <Botao variante="secundario" onClick={() => analisar([...sel])} carregando={ocupado === "ia"}>
              Reanalisar com IA
            </Botao>
            <Botao variante="secundario" onClick={() => lote("agrupar", undefined, "Agrupadas como variações do mesmo modelo.")}>
              Agrupar variações
            </Botao>
            <Botao variante="secundario" onClick={() => lote("desagrupar", undefined, "Variações separadas.")}>
              Desagrupar
            </Botao>
            <select
              className="w-44"
              value=""
              onChange={(e) => e.target.value && lote("definir", { tipo: e.target.value }, "Tipo alterado.")}
            >
              <option value="">Definir tipo…</option>
              {tax?.tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
            <input
              className="w-28"
              inputMode="decimal"
              placeholder="fator…"
              title="Digite o fator e tecle Enter para aplicar às peças selecionadas"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value.trim().replace(",", ".");
                lote("definir", { fator: v ? Number(v) : null }, "Fator aplicado às peças selecionadas.");
              }}
            />
            <select className="w-44" value="" onChange={(e) => e.target.value && lote("definir", { banho: e.target.value }, "Banho alterado.")}>
              <option value="">Definir banho…</option>
              {tax?.banhos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
            <Link href={`/etiquetas?ids=${idsSel}`}>
              <Botao variante="secundario">Etiquetas</Botao>
            </Link>
            <Link href={`/up-vendas?ids=${idsSel}`}>
              <Botao variante="secundario">Enviar ao UP</Botao>
            </Link>
            <Botao
              variante="perigo"
              onClick={() => confirm(`Excluir ${sel.size} peça(s)?`) && lote("excluir", undefined, "Excluídas.").then(() => setSel(new Set()))}
            >
              Excluir
            </Botao>
          </div>
        )}
        <div className="max-h-[75vh] overflow-auto">
          <table className="tabela w-full min-w-[1100px]">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(produtos.map((p) => p.id)))} />
                </th>
                <th>#</th>
                <th>Foto</th>
                <th>Nome de cadastro</th>
                <th>Classificação</th>
                <th>Qtd</th>
                <th>Preço {moedaSimbolo(pedido.moeda)}</th>
                <th>Custo R$</th>
                <th>Fator</th>
                <th>Venda</th>
                <th>Referência · EAN</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={sel.has(p.id)}
                      onChange={() =>
                        setSel((s) => {
                          const n = new Set(s);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="text-xs text-[#9a8089]">{p.linha}</td>
                  <td>
                    <Link href={`/produtos/${p.id}`} className="relative block w-16">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.imagemId ? <img src={img(p.imagemId, 160)!} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <div className="h-16 w-16 rounded-lg bg-rose-claro" />}
                    </Link>
                    {d.fotosModelo[p.id] && (
                      <Link href={`/produtos/${p.id}/estudio`} className="relative mt-1 block w-16" title={d.fotosModelo[p.id].aprovada ? "Foto com modelo aprovada pelo marketing" : "Foto com modelo (não aprovada)"}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img(d.fotosModelo[p.id].id, 160)!} alt="" className="h-16 w-16 rounded-lg object-cover" />
                        <span className={`absolute bottom-0.5 right-0.5 rounded-full px-1 text-[0.6rem] font-semibold text-white ${d.fotosModelo[p.id].aprovada ? "bg-emerald-600" : d.fotosModelo[p.id].aprovada === false ? "bg-amber-600" : "bg-stone-500"}`}>
                          {d.fotosModelo[p.id].aprovada ? "✓" : d.fotosModelo[p.id].aprovada === false ? "!" : "?"} {d.fotosModelo[p.id].nota != null ? d.fotosModelo[p.id].nota!.toFixed(1) : ""}
                        </span>
                      </Link>
                    )}
                  </td>
                  <td className="min-w-[280px]">
                    <input
                      list={`nomes-${p.id}`}
                      defaultValue={p.nome ?? ""}
                      key={p.nome}
                      placeholder={p.tipo ? "Escolha ou digite" : "Aguardando IA"}
                      onBlur={(e) => e.target.value !== (p.nome ?? "") && editar(p, { nome: e.target.value.toUpperCase() })}
                      className="font-medium"
                    />
                    <datalist id={`nomes-${p.id}`}>
                      {(p.nomesSugeridos ?? []).map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <div className="mt-1 text-xs text-[#8a6d78]">
                      <span className="font-mono">{p.codigoFornecedor}</span> · {p.traducao ?? p.descricaoOriginal}
                    </div>
                    {p.nomeComercial && <div className="font-script text-base text-rose-escuro">{p.nomeComercial}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.destaque && <Selo cor="dourado">★ destaque</Selo>}
                      {p.grupo && <Selo cor="cinza">variação {p.grupo}</Selo>}
                      {p.status === "aprovado" && <Selo cor="verde">aprovado</Selo>}
                      {(p.alertas ?? []).map((a, i) => (
                        <span key={i} title={a}>
                          <Selo cor="amarelo">⚠ {a.length > 48 ? a.slice(0, 46) + "…" : a}</Selo>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="min-w-[170px] text-xs">
                    <select value={p.tipo ?? ""} onChange={(e) => editar(p, { tipo: e.target.value })} className="mb-1 py-0.5 text-xs">
                      <option value="">tipo?</option>
                      {tax?.tipos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nome}
                        </option>
                      ))}
                    </select>
                    <div className="text-[#6b5560]">
                      {p.subtipo ?? ""} · {nomeDe(tax?.materiais, p.material)} · {nomeDe(tax?.banhos, p.banho)}
                    </div>
                    <div className="text-[#6b5560]">
                      {(p.corPedra ?? []).map((c) => nomeDe(tax?.cores_pedra, c)).join(", ") || "—"} · {p.tamanho ?? "—"}
                    </div>
                  </td>
                  <td>
                    <input type="number" defaultValue={p.quantidade} key={p.quantidade} className="w-20" onBlur={(e) => Number(e.target.value) !== p.quantidade && editar(p, { quantidade: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" step="0.01" defaultValue={p.precoOrigem ?? ""} key={p.precoOrigem} className="w-24" onBlur={(e) => Number(e.target.value) !== p.precoOrigem && editar(p, { precoOrigem: Number(e.target.value) })} />
                  </td>
                  <td className="whitespace-nowrap">{brl(p.custoTotalBrl)}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      key={`f-${p.fator ?? ""}-${p.fatorAplicado}`}
                      defaultValue={p.fator ?? ""}
                      placeholder={`×${num(p.fatorAplicado ?? 0, 1)}`}
                      title="Em branco = fator do pedido"
                      className="w-20"
                      onBlur={(e) => {
                        const v = e.target.value.trim().replace(",", ".");
                        const novo = v ? Number(v) : null;
                        if (novo !== p.fator) editar(p, { fator: novo });
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap font-titulo text-lg font-semibold text-rose-escuro">
                    {brl(p.precoVenda)}
                    {p.precos && config?.precificacao.tabelas_preco
                      .filter((t) => t.id !== config.precificacao.tabela_base && t.multiplicador_sobre_tabela_base !== 1)
                      .slice(0, 1)
                      .map((t) => (
                        <div key={t.id} className="font-sans text-xs font-normal text-[#9a8089]">
                          {t.nome.toLowerCase()}: {brl(p.precos?.[t.id])}
                        </div>
                      ))}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs">
                    {p.referencia ?? <span className="text-[#c2a9b2]">—</span>}
                    <div className="text-[#8a6d78]">{p.codigoBarras ?? ""}</div>
                    <div className="text-[#8a6d78]">NCM {p.ncm}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      <div className="flex justify-end">
        <Botao
          variante="perigo"
          onClick={() =>
            confirm("Excluir este pedido e todas as peças dele?") &&
            acao("excluir", async () => {
              await api(`/api/pedidos/${id}`, { method: "DELETE" });
              router.push("/pedidos");
            })
          }
        >
          Excluir pedido
        </Botao>
      </div>
    </div>
  );
}
