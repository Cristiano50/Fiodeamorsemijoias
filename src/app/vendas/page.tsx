"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnaliseVendas, CampoVenda, Curva, Mapeamento, ResumoGrupo, SkuAnalise, StatusSku } from "@/lib/vendas-calculo";
import { Botao, Campo, Carregando, Cartao, Numero, Selo, useAviso } from "@/components/ui";
import { nomeDe, useConfig, type TaxonomiaCliente } from "@/components/hooks";
import { api, brl, img, num } from "@/lib/cliente";

type Aba = "repor" | "parados" | "abc" | "tipo" | "fornecedor" | "revendedoras";

interface Lote {
  id: string;
  arquivoNome: string | null;
  linhas: number;
  ligadas: number;
  periodoInicio: string | null;
  periodoFim: string | null;
  criadoEm: string;
  pecas: number;
  receita: number;
}

interface Previa {
  arquivoNome: string;
  cabecalhos: string[];
  mapeamento: Mapeamento;
  amostra: string[][];
  totalLinhas: number;
  linhaCabecalho: number;
  campos: { id: CampoVenda; nome: string }[];
}

interface ResultadoImportacao {
  loteId: string | null;
  arquivoNome: string;
  linhas: number;
  ligadas: number;
  naoLigadas: number;
  periodoInicio: string | null;
  periodoFim: string | null;
  totalIgnoradas: number;
  motivos: Record<string, number>;
  ignoradas: { linha: number; motivo: string }[];
}

const dataBr = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const pct = (v: number, casas = 0) => `${num(v * 100, casas)}%`;
const pecas = (v: number) => num(v, Number.isInteger(v) ? 0 : 1);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function diasAtras(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
}

const STATUS: Record<StatusSku, { rotulo: string; cor: "amarelo" | "vermelho" | "cinza" | "verde" }> = {
  repor: { rotulo: "repor", cor: "amarelo" },
  esgotado: { rotulo: "esgotado", cor: "vermelho" },
  parado: { rotulo: "parado", cor: "cinza" },
  ok: { rotulo: "ok", cor: "verde" },
};
const COR_CURVA: Record<Curva, "dourado" | "rose" | "cinza"> = { A: "dourado", B: "rose", C: "cinza" };

export default function VendasPage() {
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [periodo, setPeriodo] = useState({ inicio: "", fim: "" });
  const [analise, setAnalise] = useState<AnaliseVendas | null>(null);
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [aba, setAba] = useState<Aba>("repor");
  const [importar, setImportar] = useState(false);
  const [podeDesfazer, setPodeDesfazer] = useState(false);
  useEffect(() => {
    api<{ modo: string; usuario: { papel: string } | null }>("/api/sessao")
      .then((s) => setPodeDesfazer(s.modo !== "usuarios" || s.usuario?.papel === "gestora"))
      .catch(() => {});
  }, []);

  const qs = useMemo(() => new URLSearchParams(Object.entries(periodo).filter(([, v]) => v)).toString(), [periodo]);
  const carregar = useCallback(
    () =>
      Promise.all([api<AnaliseVendas>(`/api/vendas/analise?${qs}`), api<Lote[]>("/api/vendas/lotes")]).then(([a, l]) => {
        setAnalise(a);
        setLotes(l);
      }),
    [qs],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(msg(e), "erro"));
  }, [carregar, avisar]);

  async function desfazer(l: Lote) {
    if (!confirm(`Desfazer a importação de "${l.arquivoNome ?? "planilha"}"? As ${l.linhas} venda(s) deste lote serão apagadas.`)) return;
    try {
      await api(`/api/vendas/lotes/${l.id}`, { method: "DELETE" });
      avisar("Importação desfeita.");
      await carregar();
    } catch (e) {
      avisar(msg(e), "erro");
    }
  }

  const atalho = (dias: number | null) => setPeriodo(dias == null ? { inicio: "", fim: "" } : { inicio: diasAtras(dias), fim: "" });
  const t = analise?.totais;
  const repor = useMemo(
    () =>
      (analise?.skus ?? [])
        .filter((s) => s.status === "repor" || s.status === "esgotado")
        .sort((a, b) => a.curva.localeCompare(b.curva) || b.quantidadeSugerida - a.quantidadeSugerida),
    [analise],
  );
  const parados = useMemo(
    () => (analise?.skus ?? []).filter((s) => s.status === "parado").sort((a, b) => b.estoque * (b.precoVenda ?? 0) - a.estoque * (a.precoVenda ?? 0)),
    [analise],
  );
  const naRecompra = repor.filter((s) => s.quantidadeSugerida > 0).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Vendas e recompra</h1>
          <p className="text-sm text-[#8a6d78]">Retorno das vendas do UP Vendas: o que gira, o que parou e quando recomprar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={() => setImportar((v) => !v)}>
            ⇪ Importar planilha do UP
          </Botao>
          {naRecompra > 0 ? (
            <>
              <a href={`/api/vendas/recompra?formato=xlsx&${qs}`} title="XLSX com uma aba por fornecedor e a foto de cada peça">
                <Botao>Lista de recompra para o fornecedor ({naRecompra})</Botao>
              </a>
              <a href={`/api/vendas/recompra?formato=csv&${qs}`}>
                <Botao variante="secundario">CSV</Botao>
              </a>
            </>
          ) : (
            <Botao disabled title="Nenhuma peça para repor no momento">
              Lista de recompra para o fornecedor
            </Botao>
          )}
        </div>
      </div>

      {importar && (
        <Importacao
          aoFechar={() => setImportar(false)}
          aoImportar={() => carregar().catch((e) => avisar(msg(e), "erro"))}
        />
      )}

      <Cartao>
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="De" className="w-40">
            <input type="date" value={periodo.inicio} onChange={(e) => setPeriodo((p) => ({ ...p, inicio: e.target.value }))} />
          </Campo>
          <Campo rotulo="Até" className="w-40">
            <input type="date" value={periodo.fim} onChange={(e) => setPeriodo((p) => ({ ...p, fim: e.target.value }))} />
          </Campo>
          <div className="flex flex-wrap gap-1 pb-1">
            {(
              [
                ["Tudo", null],
                ["30 dias", 30],
                ["90 dias", 90],
                ["12 meses", 365],
              ] as const
            ).map(([r, d]) => (
              <button
                key={r}
                onClick={() => atalho(d)}
                className={`rounded-full px-3 py-1 text-sm ${(d == null ? !periodo.inicio && !periodo.fim : periodo.inicio === diasAtras(d) && !periodo.fim) ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}
              >
                {r}
              </button>
            ))}
          </div>
          {analise?.periodo.primeiraVenda && (
            <p className="pb-1 text-xs text-[#9a8089]">
              Vendas de {dataBr(analise.periodo.primeiraVenda)} a {dataBr(analise.periodo.ultimaVenda)}. O estoque estimado usa todas as vendas até {dataBr(analise.periodo.fim)}.
            </p>
          )}
        </div>
      </Cartao>

      {!analise ? (
        <Carregando />
      ) : !analise.temVendas ? (
        <EstadoVazio aoImportar={() => setImportar(true)} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero rotulo="Receita" valor={brl(t!.receita)} detalhe={`${t!.linhas} linha(s) · ${t!.linhas ? pct(t!.linhasLigadas / t!.linhas) : "—"} ligadas a produtos`} />
            <Numero rotulo="Peças vendidas" valor={pecas(t!.pecas)} detalhe={`${t!.skusVendidos} SKU(s) diferentes`} />
            <Numero rotulo="Sell-through" valor={pct(t!.sellThrough, 1)} detalhe={`${pecas(t!.vendido)} de ${pecas(t!.comprado)} peças compradas`} />
            <Numero rotulo="Repor agora" valor={t!.repor + t!.esgotados} detalhe={`${t!.esgotados} esgotada(s) · ${t!.parados} parada(s)`} />
          </div>

          {analise.naoLigadas.linhas > 0 && (
            <details className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <summary className="cursor-pointer">
                {analise.naoLigadas.linhas} linha(s) ({pecas(analise.naoLigadas.pecas)} peças, {brl(analise.naoLigadas.receita)}) não acharam o produto no app pelo código de barras nem pela
                referência. Entram na receita e no ranking das revendedoras, mas não no giro por peça.
              </summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {analise.naoLigadas.exemplos.map((x) => (
                  <li key={x.codigo} className="truncate">
                    <span className="font-mono">{x.codigo}</span> {x.descricao ? `· ${x.descricao}` : ""} — {pecas(x.pecas)} peça(s)
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Cartao>
            <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
              {(
                [
                  ["repor", `Repor agora (${repor.length})`],
                  ["parados", `Parados (${parados.length})`],
                  ["abc", "Curva ABC"],
                  ["tipo", "Por tipo"],
                  ["fornecedor", "Por fornecedor"],
                  ["revendedoras", `Revendedoras (${analise.revendedoras.filter((r) => r.chave).length})`],
                ] as const
              ).map(([k, r]) => (
                <button key={k} onClick={() => setAba(k)} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm ${aba === k ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
                  {r}
                </button>
              ))}
            </div>
            {aba === "repor" && <AbaRepor lista={repor} tax={tax} prazo={analise.parametros.prazoReposicaoDias} />}
            {aba === "parados" && <AbaParados lista={parados} tax={tax} dias={analise.parametros.diasEstoqueParado} />}
            {aba === "abc" && <AbaAbc analise={analise} tax={tax} />}
            {aba === "tipo" && <TabelaResumo lista={analise.porTipo} titulo="Tipo" nome={(k) => (k ? nomeDe(tax?.tipos, k) : "Sem tipo")} />}
            {aba === "fornecedor" && <TabelaResumo lista={analise.porFornecedor} titulo="Fornecedor" nome={(k) => k || "Sem fornecedor"} />}
            {aba === "revendedoras" && <AbaRevendedoras analise={analise} tax={tax} />}
          </Cartao>

          <details className="rounded-2xl border border-borda bg-white px-4 py-3 text-sm text-[#6b5560]">
            <summary className="cursor-pointer font-medium text-rose-escuro">Como as contas são feitas</summary>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                <b>Comprado</b>: soma das quantidades das linhas de produto com o mesmo código de barras (o original e as recompras). <b>Estoque estimado</b> = comprado −
                vendido. As peças que estão em maletas de revendedoras contam como estoque (o UP não exporta isso).
              </li>
              <li>
                <b>Sell-through</b> = vendido ÷ comprado. <b>Venda média diária</b> = vendido ÷ dias desde a entrada (data do pedido).
              </li>
              <li>
                <b>Ponto de reposição</b> = venda média diária × {analise.parametros.prazoReposicaoDias} dias de prazo × 1,5. <b>Repor</b>: vendeu e o estoque está no ponto ou
                abaixo. <b>Quantidade sugerida</b> = venda média × prazo × 2,5 − estoque (cobre a chegada, a margem e mais um prazo de vendas).
              </li>
              <li>
                <b>Parado</b>: com estoque e sem venda há mais de {analise.parametros.diasEstoqueParado} dias (prazo e dias ajustáveis em Configurações).
              </li>
              <li>
                <b>Curva ABC</b> pela receita do período: A soma os primeiros 80%, B até 95%, C o resto.
              </li>
            </ul>
          </details>
        </>
      )}

      <Cartao titulo="Planilhas importadas">
        {!lotes ? (
          <Carregando />
        ) : lotes.length === 0 ? (
          <p className="text-sm text-[#8a6d78]">Nenhuma planilha importada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Importado em</th>
                  <th>Período</th>
                  <th>Vendas</th>
                  <th>Ligadas</th>
                  <th>Peças</th>
                  <th>Receita</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.id}>
                    <td className="max-w-[260px] truncate" title={l.arquivoNome ?? ""}>
                      {l.arquivoNome ?? "—"}
                    </td>
                    <td className="whitespace-nowrap">{new Date(l.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="whitespace-nowrap">
                      {dataBr(l.periodoInicio)} a {dataBr(l.periodoFim)}
                    </td>
                    <td>{l.linhas}</td>
                    <td>
                      {l.ligadas} <span className="text-xs text-[#9a8089]">({l.linhas ? pct(l.ligadas / l.linhas) : "—"})</span>
                    </td>
                    <td>{pecas(l.pecas)}</td>
                    <td className="whitespace-nowrap">{brl(l.receita)}</td>
                    <td className="text-right">
                      {podeDesfazer && (
                        <Botao variante="perigo" onClick={() => desfazer(l)} title="Apaga as vendas deste lote">
                          Desfazer
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}

/* ---------------------------------------------------------- estado vazio */

function EstadoVazio({ aoImportar }: { aoImportar: () => void }) {
  return (
    <Cartao titulo="Ainda não há vendas importadas">
      <div className="grid gap-4 md:grid-cols-2">
        <ol className="ml-5 list-decimal space-y-2 text-sm text-[#6b5560]">
          <li>
            No <b>UP Vendas</b>, abra o relatório de <b>vendas por produto</b> (itens vendidos, incluindo os acertos das maletas) e escolha o período.
          </li>
          <li>
            Exporte em <b>Excel (XLSX)</b> ou <b>CSV</b>.
          </li>
          <li>
            Aqui, clique em <b>Importar planilha do UP</b>, confira qual coluna é cada campo e importe.
          </li>
          <li>Repita todo mês. Linhas que já foram importadas são ignoradas, então pode exportar períodos que se sobrepõem.</li>
        </ol>
        <div className="rounded-xl bg-creme p-4 text-sm text-[#6b5560]">
          <div className="rotulo mb-1">O que a planilha precisa ter</div>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <b>Data</b> da venda;
            </li>
            <li>
              <b>Referência</b> ou <b>código de barras</b> (é assim que a venda acha o produto do app);
            </li>
            <li>
              <b>Quantidade</b> e <b>valor</b>;
            </li>
            <li>
              <b>Revendedora</b> (opcional, mas é ela que alimenta a maleta inteligente) e <b>canal</b> (opcional).
            </li>
          </ul>
          <p className="mt-2">Os nomes das colunas não importam: o app sugere o mapeamento e você ajusta.</p>
          <Botao className="mt-3" onClick={aoImportar}>
            ⇪ Importar planilha do UP
          </Botao>
        </div>
      </div>
    </Cartao>
  );
}

/* ---------------------------------------------------------- importação */

function Importacao({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: () => void }) {
  const avisar = useAviso();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [mapa, setMapa] = useState<Mapeamento>({});
  const [dataPadrao, setDataPadrao] = useState("");
  const [ignorarDuplicadas, setIgnorarDuplicadas] = useState(true);
  const [ocupado, setOcupado] = useState<"" | "lendo" | "importando">("");
  const [arrastando, setArrastando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  async function escolher(f: File | undefined) {
    if (!f) return;
    setArquivo(f);
    setPrevia(null);
    setResultado(null);
    setOcupado("lendo");
    try {
      const form = new FormData();
      form.set("arquivo", f);
      const p = await api<Previa>("/api/vendas/previa", { method: "POST", body: form });
      setPrevia(p);
      setMapa(p.mapeamento);
    } catch (e) {
      avisar(msg(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function importar() {
    if (!arquivo) return;
    setOcupado("importando");
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("mapeamento", JSON.stringify(mapa));
      form.set("opcoes", JSON.stringify({ dataPadrao: dataPadrao || null, ignorarDuplicadas }));
      const r = await api<ResultadoImportacao>("/api/vendas/importar", { method: "POST", body: form });
      setResultado(r);
      avisar(r.loteId ? `${r.linhas} venda(s) importada(s).` : "Nenhuma venda nova nesta planilha.", r.loteId ? "ok" : "info");
      aoImportar();
    } catch (e) {
      avisar(msg(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const campoDaColuna = (i: number) => ((Object.entries(mapa) as [CampoVenda, number][]).find(([, c]) => c === i)?.[0] ?? "") as CampoVenda | "";
  const definir = (i: number, campo: CampoVenda | "") =>
    setMapa((m) => {
      const n: Mapeamento = { ...m };
      for (const k of Object.keys(n) as CampoVenda[]) if (n[k] === i || k === campo) delete n[k];
      if (campo) n[campo] = i;
      return n;
    });
  const nomeCampo = (c: CampoVenda | "") => previa?.campos.find((x) => x.id === c)?.nome ?? "";
  const tem = (c: CampoVenda) => mapa[c] != null;
  const faltas = [!tem("referencia") && !tem("codigoBarras") && "a coluna da referência ou a do código de barras", !tem("data") && !dataPadrao && "a coluna da data (ou uma data para as linhas sem data)"].filter(
    Boolean,
  ) as string[];
  const recomendados = [
    !tem("quantidade") && "quantidade (sem ela, cada linha conta 1 peça)",
    !tem("valorTotal") && !tem("valorUnitario") && "valor (sem ele, a receita usa o preço de etiqueta do app)",
    !tem("revendedora") && "revendedora (é o que alimenta a maleta inteligente)",
  ].filter(Boolean) as string[];

  return (
    <Cartao
      titulo="Importar vendas do UP Vendas"
      acoes={
        <Botao variante="fantasma" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          escolher(e.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${arrastando ? "border-rose-escuro bg-rose-claro" : "border-rose bg-white hover:bg-[#fdf7f9]"}`}
      >
        <span className="font-script text-2xl text-rose-escuro">solte aqui a planilha de vendas</span>
        <span className="text-sm text-[#8a6d78]">CSV ou XLSX exportado do UP Vendas</span>
        <input
          type="file"
          accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            escolher(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {arquivo && <span className="text-xs text-rose-escuro">{arquivo.name}</span>}
      </label>

      {ocupado === "lendo" && <Carregando texto="Lendo a planilha…" />}

      {previa && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-[#6b5560]">
            <b>{previa.totalLinhas}</b> linha(s) com dados; cabeçalho na linha {previa.linhaCabecalho}. Confira qual campo é cada coluna:
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {previa.cabecalhos.map((c, i) => {
              const campo = campoDaColuna(i);
              return (
                <div key={i} className={`rounded-xl border p-2 ${campo ? "border-rose bg-[#fdf7f9]" : "border-borda"}`}>
                  <div className="truncate text-sm font-medium" title={c}>
                    {c}
                  </div>
                  <select value={campo} onChange={(e) => definir(i, e.target.value as CampoVenda | "")} className="mt-1">
                    <option value="">— ignorar —</option>
                    {previa.campos.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 truncate text-xs text-[#9a8089]" title={previa.amostra.map((l) => l[i]).join(" · ")}>
                    {previa.amostra
                      .slice(0, 3)
                      .map((l) => l[i])
                      .filter(Boolean)
                      .join(" · ") || "vazia"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="tabela w-full min-w-[640px]">
              <thead>
                <tr>
                  {previa.cabecalhos.map((c, i) => (
                    <th key={i} className={campoDaColuna(i) ? "" : "opacity-50"}>
                      {campoDaColuna(i) ? nomeCampo(campoDaColuna(i)) : "ignorada"}
                      <div className="font-normal normal-case tracking-normal">{c}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previa.amostra.map((l, j) => (
                  <tr key={j}>
                    {previa.cabecalhos.map((_, i) => (
                      <td key={i} className={`whitespace-nowrap ${campoDaColuna(i) ? "" : "text-[#c2a9b2]"}`}>
                        {l[i]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="Data para linhas sem data" dica="Para relatórios sem data por linha (ex.: total do mês): use o último dia do período.">
              <input type="date" value={dataPadrao} onChange={(e) => setDataPadrao(e.target.value)} />
            </Campo>
            <label className="flex items-start gap-2 pt-5 text-sm">
              <input type="checkbox" checked={ignorarDuplicadas} onChange={(e) => setIgnorarDuplicadas(e.target.checked)} className="mt-1" />
              <span>
                Ignorar linhas já importadas
                <span className="block text-xs text-[#9a8089]">mesma data, peça, quantidade, valor e revendedora</span>
              </span>
            </label>
          </div>

          {faltas.length > 0 && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">Falta indicar {faltas.join(" e ")}.</div>}
          {faltas.length === 0 && recomendados.length > 0 && <div className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">Recomendado: {recomendados.join("; ")}.</div>}

          <div className="flex flex-wrap justify-end gap-2">
            <Botao onClick={importar} carregando={ocupado === "importando"} disabled={faltas.length > 0}>
              Importar {previa.totalLinhas} linha(s)
            </Botao>
          </div>
        </div>
      )}

      {resultado && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${resultado.loteId ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {resultado.loteId ? (
            <p>
              ✓ <b>{resultado.linhas}</b> venda(s) importada(s), de {dataBr(resultado.periodoInicio)} a {dataBr(resultado.periodoFim)}: {resultado.ligadas} ligada(s) a produtos do app
              {resultado.naoLigadas ? `, ${resultado.naoLigadas} sem produto no app (confira a referência/EAN)` : ""}.
            </p>
          ) : (
            <p>Nenhuma venda nova foi gravada.</p>
          )}
          {resultado.totalIgnoradas > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">
                {resultado.totalIgnoradas} linha(s) ignorada(s):{" "}
                {Object.entries(resultado.motivos)
                  .map(([m, n]) => `${n} ${m}`)
                  .join(" · ")}
              </summary>
              <ul className="mt-1 max-h-60 overflow-auto text-xs">
                {resultado.ignoradas.map((i) => (
                  <li key={`${i.linha}-${i.motivo}`}>
                    Linha {i.linha}: {i.motivo}
                  </li>
                ))}
                {resultado.totalIgnoradas > resultado.ignoradas.length && <li>… e mais {resultado.totalIgnoradas - resultado.ignoradas.length}</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </Cartao>
  );
}

/* ---------------------------------------------------------- abas */

function Peca({ s, tax }: { s: SkuAnalise; tax?: TaxonomiaCliente }) {
  return (
    <div className="flex min-w-[230px] items-start gap-2">
      <Link href={`/produtos/${s.produtoId}`} className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.imagemId ? <img src={img(s.imagemId, 120)!} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-rose-claro" />}
      </Link>
      <div className="min-w-0">
        <Link href={`/produtos/${s.produtoId}`} className="line-clamp-2 text-xs font-medium uppercase leading-snug hover:text-rose-escuro">
          {s.nome}
        </Link>
        <div className="font-mono text-[0.7rem] text-[#8a6d78]">
          {s.referencia ?? "—"} · {s.codigoBarras ?? "sem EAN"}
        </div>
        <div className="text-[0.7rem] text-[#9a8089]">
          {nomeDe(tax?.tipos, s.tipo)} · {s.fornecedor ?? "sem fornecedor"}
          {s.codigoFornecedor ? ` · ${s.codigoFornecedor}` : ""}
        </div>
      </div>
    </div>
  );
}

const Vazio = ({ children }: { children: React.ReactNode }) => <p className="py-6 text-center text-sm text-[#8a6d78]">{children}</p>;

function AbaRepor({ lista, tax, prazo }: { lista: SkuAnalise[]; tax?: TaxonomiaCliente; prazo: number }) {
  if (!lista.length) return <Vazio>Nada para repor agora: nenhuma peça que vende está no ponto de reposição.</Vazio>;
  return (
    <>
      <p className="mb-2 text-xs text-[#9a8089]">
        Peças que vendem com estoque estimado no ponto de reposição (venda de {prazo} dias × 1,5) ou esgotadas. A lista de recompra leva estas peças, agrupadas por
        fornecedor.
      </p>
      <div className="max-h-[70vh] overflow-auto">
        <table className="tabela w-full min-w-[900px]">
          <thead>
            <tr>
              <th>Peça</th>
              <th>Status</th>
              <th>Curva</th>
              <th>Comprado</th>
              <th>Vendido</th>
              <th>Sell-through</th>
              <th>Venda/dia</th>
              <th>Estoque</th>
              <th>Ponto</th>
              <th>Sugerida</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.chave}>
                <td>
                  <Peca s={s} tax={tax} />
                </td>
                <td>
                  <Selo cor={STATUS[s.status].cor}>{STATUS[s.status].rotulo}</Selo>
                  {s.divergente && (
                    <div className="mt-1" title="Vendeu mais do que o app registra como comprado: confira as quantidades do pedido">
                      <Selo cor="amarelo">⚠ vendeu &gt; comprou</Selo>
                    </div>
                  )}
                </td>
                <td>
                  <Selo cor={COR_CURVA[s.curva]}>{s.curva}</Selo>
                </td>
                <td>{pecas(s.comprado)}</td>
                <td>{pecas(s.vendido)}</td>
                <td>{pct(s.sellThrough)}</td>
                <td className="whitespace-nowrap" title={`${num(s.mediaDiaria * 30, 1)} por mês`}>
                  {num(s.mediaDiaria, 2)}
                </td>
                <td>{pecas(s.estoque)}</td>
                <td>{num(s.pontoReposicao, 1)}</td>
                <td className="font-titulo text-lg font-semibold text-rose-escuro">{s.quantidadeSugerida || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbaParados({ lista, tax, dias }: { lista: SkuAnalise[]; tax?: TaxonomiaCliente; dias: number }) {
  if (!lista.length) return <Vazio>Nenhuma peça parada: tudo o que tem estoque vendeu nos últimos {dias} dias.</Vazio>;
  const valor = lista.reduce((s, x) => s + x.estoque * (x.precoVenda ?? 0), 0);
  const custo = lista.reduce((s, x) => s + x.estoque * (x.custo ?? 0), 0);
  return (
    <>
      <p className="mb-2 text-sm text-[#6b5560]">
        Com estoque e sem venda há mais de {dias} dias: <b>{brl(valor)}</b> em etiqueta ({brl(custo)} de custo). Ideias: colocar nas maletas, montar kits ou fazer promoção.
      </p>
      <div className="max-h-[70vh] overflow-auto">
        <table className="tabela w-full min-w-[860px]">
          <thead>
            <tr>
              <th>Peça</th>
              <th>Entrada</th>
              <th>Última venda</th>
              <th>Dias sem venda</th>
              <th>Comprado</th>
              <th>Vendido</th>
              <th>Estoque</th>
              <th>Em etiqueta</th>
              <th>Custo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.chave}>
                <td>
                  <Peca s={s} tax={tax} />
                </td>
                <td className="whitespace-nowrap">{dataBr(s.dataEntrada)}</td>
                <td className="whitespace-nowrap">{s.ultimaVenda ? dataBr(s.ultimaVenda) : "nunca vendeu"}</td>
                <td>{s.diasSemVenda}</td>
                <td>{pecas(s.comprado)}</td>
                <td>{pecas(s.vendido)}</td>
                <td>{pecas(s.estoque)}</td>
                <td className="whitespace-nowrap">{brl(s.estoque * (s.precoVenda ?? 0))}</td>
                <td className="whitespace-nowrap">{brl(s.estoque * (s.custo ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AbaAbc({ analise, tax }: { analise: AnaliseVendas; tax?: TaxonomiaCliente }) {
  const [filtro, setFiltro] = useState<Curva | "">("");
  const lista = analise.skus.filter((s) => (filtro ? s.curva === filtro : s.receita > 0));
  const LIMITE = 400;
  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(["A", "B", "C"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFiltro((f) => (f === c ? "" : c))}
            className={`rounded-xl border px-3 py-2 text-left transition ${filtro === c ? "border-rose-escuro bg-rose-claro" : "border-borda bg-white hover:bg-[#fdf7f9]"}`}
          >
            <div className="font-titulo text-2xl font-semibold text-rose-escuro">Curva {c}</div>
            <div className="text-xs text-[#6b5560]">
              {analise.abc[c].skus} SKU(s) · {pct(analise.abc[c].participacao)} da receita
            </div>
            <div className="text-xs text-[#9a8089]">{brl(analise.abc[c].receita)}</div>
          </button>
        ))}
      </div>
      {!lista.length ? (
        <Vazio>Nenhuma peça com venda neste período.</Vazio>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="tabela w-full min-w-[820px]">
            <thead>
              <tr>
                <th>Curva</th>
                <th>Peça</th>
                <th>Receita</th>
                <th>Part.</th>
                <th>Acumulado</th>
                <th>Vendido no período</th>
                <th>Estoque</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, LIMITE).map((s) => (
                <tr key={s.chave}>
                  <td>
                    <Selo cor={COR_CURVA[s.curva]}>{s.curva}</Selo>
                  </td>
                  <td>
                    <Peca s={s} tax={tax} />
                  </td>
                  <td className="whitespace-nowrap">{brl(s.receita)}</td>
                  <td>{pct(s.participacao, 1)}</td>
                  <td>{pct(s.acumulado, 1)}</td>
                  <td>{pecas(s.vendidoPeriodo)}</td>
                  <td>{pecas(s.estoque)}</td>
                  <td>
                    <Selo cor={STATUS[s.status].cor}>{STATUS[s.status].rotulo}</Selo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > LIMITE && <p className="py-2 text-center text-xs text-[#9a8089]">Mostrando {LIMITE} de {lista.length}. Use os filtros A, B e C.</p>}
        </div>
      )}
    </>
  );
}

function TabelaResumo({ lista, titulo, nome }: { lista: ResumoGrupo[]; titulo: string; nome: (chave: string) => string }) {
  if (!lista.length) return <Vazio>Sem dados.</Vazio>;
  const max = Math.max(...lista.map((g) => g.participacao), 0.0001);
  return (
    <div className="overflow-x-auto">
      <table className="tabela w-full min-w-[900px]">
        <thead>
          <tr>
            <th>{titulo}</th>
            <th>SKUs</th>
            <th>Comprado</th>
            <th>Vendido</th>
            <th>Sell-through</th>
            <th>Receita</th>
            <th className="w-40">Part. na receita</th>
            <th>Estoque</th>
            <th>Em etiqueta</th>
            <th>Repor</th>
            <th>Parados</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((g) => (
            <tr key={g.chave}>
              <td className="font-medium">{nome(g.chave)}</td>
              <td>{g.skus}</td>
              <td>{pecas(g.comprado)}</td>
              <td>{pecas(g.vendido)}</td>
              <td>{pct(g.sellThrough)}</td>
              <td className="whitespace-nowrap">{brl(g.receita)}</td>
              <td>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-rose-claro">
                    <div className="h-2 rounded-full bg-rose-escuro" style={{ width: `${(g.participacao / max) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs">{pct(g.participacao, 1)}</span>
                </div>
              </td>
              <td>{pecas(g.estoque)}</td>
              <td className="whitespace-nowrap">{brl(g.valorEstoque)}</td>
              <td>{g.repor || "—"}</td>
              <td>{g.parados || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AbaRevendedoras({ analise, tax }: { analise: AnaliseVendas; tax?: TaxonomiaCliente }) {
  if (!analise.revendedoras.length) return <Vazio>Sem vendas no período.</Vazio>;
  if (!analise.revendedoras.some((r) => r.chave))
    return <Vazio>A planilha importada não tem a coluna da revendedora. Importe de novo indicando essa coluna para ver o ranking e alimentar a maleta.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="tabela w-full min-w-[760px]">
        <thead>
          <tr>
            <th>#</th>
            <th>Revendedora</th>
            <th>Peças</th>
            <th>Receita</th>
            <th>Peça média</th>
            <th>Tipo favorito</th>
            <th>Última venda</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {analise.revendedoras.map((r) => (
            <tr key={r.chave || "sem"}>
              <td className="text-xs text-[#9a8089]">{r.chave ? r.posicao : ""}</td>
              <td className="font-medium">{r.chave ? r.nome : <span className="italic text-[#9a8089]">Sem revendedora (venda direta)</span>}</td>
              <td>{pecas(r.pecas)}</td>
              <td className="whitespace-nowrap">{brl(r.receita)}</td>
              <td className="whitespace-nowrap">{brl(r.ticketMedio)}</td>
              <td>{r.tipoFavorito ? nomeDe(tax?.tipos, r.tipoFavorito) : "—"}</td>
              <td className="whitespace-nowrap">{dataBr(r.ultimaVenda)}</td>
              <td className="text-right">
                {r.chave && (
                  <Link href={`/maleta?revendedora=${encodeURIComponent(r.nome)}`}>
                    <Botao variante="secundario">Montar maleta</Botao>
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
