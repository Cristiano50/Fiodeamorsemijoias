"use client";
import Link from "next/link";
import { Suspense, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { ItemMaleta, ResultadoMaleta } from "@/lib/maleta-calculo";
import { Botao, Campo, Carregando, Cartao, Modal, Numero, Selo, useAviso } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, img, num } from "@/lib/cliente";

interface Dados {
  temVendas: boolean;
  revendedoras: { nome: string; pecas: number; receita: number; ultimaVenda: string | null; tipoFavorito: string | null }[];
  valorAlvo: number;
  pecasAlvo: number;
}
type Sugestao = ResultadoMaleta & { valorAlvo: number; pecasAlvo: number; temVendas: boolean; geradoEm: string };

const NOVA = "__nova__";
const dataBr = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const lerNumero = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "maleta";

function MaletaConteudo() {
  const params = useSearchParams();
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [dados, setDados] = useState<Dados | null>(null);
  const [revendedora, setRevendedora] = useState(params.get("revendedora") || NOVA);
  const [nomeNova, setNomeNova] = useState("");
  const [valorAlvo, setValorAlvo] = useState("");
  const [pecasAlvo, setPecasAlvo] = useState("");
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [itens, setItens] = useState<ItemMaleta[]>([]);
  const [gerando, setGerando] = useState(false);
  const [troca, setTroca] = useState<{ tipo: string; substituir?: string } | null>(null);

  useEffect(() => {
    api<Dados>("/api/maleta")
      .then(setDados)
      .catch((e) => avisar(msg(e), "erro"));
  }, [avisar]);

  const opcoes = useMemo(() => {
    const lista = dados?.revendedoras ?? [];
    const daUrl = revendedora !== NOVA && !lista.some((r) => r.nome === revendedora) ? [{ nome: revendedora, pecas: 0, receita: 0, ultimaVenda: null, tipoFavorito: null }] : [];
    return [...lista, ...daUrl];
  }, [dados, revendedora]);
  const atual = opcoes.find((r) => r.nome === revendedora);
  const nomeMaleta = revendedora === NOVA ? nomeNova.trim() || "Nova revendedora" : revendedora;
  const nomeTipo = (t: string) => (t === "outros" ? "Outros" : nomeDe(tax?.tipos, t));

  async function gerar() {
    setGerando(true);
    try {
      const r = await api<Sugestao>("/api/maleta", {
        method: "POST",
        json: {
          revendedora: revendedora === NOVA ? null : revendedora,
          valorAlvo: lerNumero(valorAlvo) || undefined,
          pecasAlvo: Math.round(lerNumero(pecasAlvo)) || undefined,
          tiposExcluidos: [...excluidos],
        },
      });
      setSugestao(r);
      setItens(r.itens);
      if (!r.itens.length) avisar("Não encontrei peças com estoque para sugerir.", "info");
    } catch (e) {
      avisar(msg(e), "erro");
    } finally {
      setGerando(false);
    }
  }

  const totais = useMemo(() => {
    const pecas = itens.reduce((s, i) => s + i.quantidade, 0);
    const valor = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
    const custo = itens.reduce((s, i) => s + i.custo * i.quantidade, 0);
    return { pecas, valor, custo };
  }, [itens]);

  const grupos = useMemo(() => {
    const ordem = sugestao?.distribuicao.map((d) => d.tipo) ?? [];
    const m = new Map<string, ItemMaleta[]>();
    for (const t of ordem) m.set(t, []);
    for (const i of itens) m.set(i.tipo, [...(m.get(i.tipo) ?? []), i]);
    return [...m.entries()].filter(([t, l]) => l.length || ordem.includes(t));
  }, [itens, sugestao]);

  const alternativas = useMemo(
    () => (troca && sugestao ? sugestao.reservas.filter((r) => r.tipo === troca.tipo && !itens.some((i) => i.chave === r.chave)) : []),
    [troca, sugestao, itens],
  );

  const alterarQtd = (chave: string, delta: number) =>
    setItens((l) => l.map((i) => (i.chave === chave ? { ...i, quantidade: Math.min(i.estoque, Math.max(1, i.quantidade + delta)) } : i)));
  const remover = (chave: string) => setItens((l) => l.filter((i) => i.chave !== chave));
  function escolher(alt: ItemMaleta) {
    setItens((l) => {
      const novo = { ...alt, quantidade: 1 };
      if (!troca?.substituir) return [...l, novo];
      return l.map((i) => (i.chave === troca.substituir ? novo : i));
    });
    setTroca(null);
  }

  function exportarCsv() {
    const linhas = [["Referência", "EAN", "Quantidade", "Preço"], ...itens.map((i) => [i.referencia ?? "", i.codigoBarras ?? "", String(i.quantidade), i.preco.toFixed(2).replace(".", ",")])];
    const csv = "﻿" + linhas.map((l) => l.join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `maleta-${slug(nomeMaleta)}-${new Date().toLocaleDateString("sv-SE")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="nao-imprimir">
        <h1 className="text-4xl font-semibold">Maleta inteligente</h1>
        <p className="text-sm text-[#8a6d78]">Mix sugerido para a maleta de cada revendedora, pelo que ela mais vende e pelo giro das peças na loja.</p>
      </div>

      {dados && !dados.temVendas && (
        <div className="nao-imprimir rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Ainda não há vendas importadas: a sugestão vai usar os <b>destaques</b> e as <b>novidades</b> do estoque. Para a maleta aprender o que cada revendedora vende, importe as
          vendas do UP em{" "}
          <Link href="/vendas" className="underline">
            Vendas e recompra
          </Link>
          .
        </div>
      )}

      <Cartao className="nao-imprimir" titulo="Montar maleta">
        {!dados ? (
          <Carregando />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Campo rotulo="Revendedora" className="col-span-2">
                <select value={revendedora} onChange={(e) => setRevendedora(e.target.value)}>
                  <option value={NOVA}>Nova revendedora (sem histórico)</option>
                  {opcoes.map((r) => (
                    <option key={r.nome} value={r.nome}>
                      {r.nome}
                      {r.pecas ? ` — ${num(r.pecas, 0)} peças` : ""}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Valor-alvo (R$)" dica="em etiqueta">
                <input inputMode="decimal" placeholder={num(dados.valorAlvo, 0)} value={valorAlvo} onChange={(e) => setValorAlvo(e.target.value)} />
              </Campo>
              <Campo rotulo="Peças-alvo">
                <input inputMode="numeric" placeholder={String(dados.pecasAlvo)} value={pecasAlvo} onChange={(e) => setPecasAlvo(e.target.value)} />
              </Campo>
              {revendedora === NOVA ? (
                <Campo rotulo="Nome (opcional)" className="col-span-2" dica="Só para a impressão e o arquivo; a sugestão usa as vendas gerais da loja.">
                  <input value={nomeNova} onChange={(e) => setNomeNova(e.target.value)} placeholder="ex.: Joana Souza" />
                </Campo>
              ) : (
                atual && (
                  <p className="col-span-2 self-end text-sm text-[#6b5560]">
                    {atual.pecas ? (
                      <>
                        {num(atual.pecas, 0)} peças vendidas · {brl(atual.receita)}
                        {atual.tipoFavorito ? ` · mais vende ${nomeTipo(atual.tipoFavorito).toLowerCase()}` : ""} · última venda {dataBr(atual.ultimaVenda)}
                      </>
                    ) : (
                      "Sem vendas no histórico: a sugestão usa as vendas gerais da loja."
                    )}
                  </p>
                )
              )}
            </div>
            <div>
              <div className="rotulo mb-1">Tipos fora da maleta</div>
              <div className="flex flex-wrap gap-1">
                {tax?.tipos.map((t) => {
                  const fora = excluidos.has(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() =>
                        setExcluidos((s) => {
                          const n = new Set(s);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        })
                      }
                      className={`rounded-full px-3 py-1 text-xs transition ${fora ? "bg-stone-200 text-stone-500 line-through" : "bg-rose-claro text-rose-escuro"}`}
                    >
                      {t.nome}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end">
              <Botao onClick={gerar} carregando={gerando}>
                ✦ Sugerir maleta
              </Botao>
            </div>
          </div>
        )}
      </Cartao>

      {sugestao && (
        <>
          <div className="hidden print:block">
            <h1 className="text-3xl font-semibold">Maleta · {nomeMaleta}</h1>
            <p className="text-sm">
              {new Date().toLocaleDateString("pt-BR")} · {totais.pecas} peças · {brl(totais.valor)} em etiqueta
            </p>
          </div>

          {sugestao.avisos.length > 0 && (
            <div className="nao-imprimir rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {sugestao.avisos.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </div>
          )}

          <div className="nao-imprimir grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero rotulo="Peças" valor={totais.pecas} detalhe={`alvo ${sugestao.pecasAlvo}`} />
            <Numero rotulo="Valor em etiqueta" valor={brl(totais.valor)} detalhe={`alvo ${brl(sugestao.valorAlvo)}`} />
            <Numero rotulo="Custo" valor={brl(totais.custo)} detalhe={totais.custo ? `markup × ${num(totais.valor / totais.custo, 1)}` : "—"} />
            <Numero
              rotulo="Base da sugestão"
              valor={sugestao.base === "revendedora" ? "Revendedora" : sugestao.base === "geral" ? "Loja" : "Estoque"}
              detalhe={
                sugestao.base === "revendedora"
                  ? `${num(sugestao.historico.pecas, 0)} peças dela · ${Math.round(sugestao.confianca * 100)}% do mix`
                  : sugestao.base === "geral"
                    ? "vendas gerais da loja"
                    : "destaques e novidades"
              }
            />
          </div>

          <Cartao
            titulo={`Maleta · ${nomeMaleta}`}
            className="print:border-0 print:p-0 print:shadow-none"
            acoes={
              <div className="nao-imprimir flex flex-wrap gap-2">
                <Botao variante="secundario" onClick={exportarCsv} disabled={!itens.length} title="Referência; EAN; quantidade; preço — para montar o romaneio no UP">
                  Exportar CSV (romaneio UP)
                </Botao>
                <Botao variante="secundario" onClick={() => window.print()} disabled={!itens.length}>
                  Imprimir
                </Botao>
                <Botao variante="fantasma" onClick={gerar} carregando={gerando}>
                  Refazer sugestão
                </Botao>
              </div>
            }
          >
            {grupos.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#8a6d78]">Nenhuma peça na maleta.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {grupos.map(([tipo, lista]) => {
                  const d = sugestao.distribuicao.find((x) => x.tipo === tipo);
                  const valorTipo = lista.reduce((s, i) => s + i.preco * i.quantidade, 0);
                  const pecasTipo = lista.reduce((s, i) => s + i.quantidade, 0);
                  return (
                    <section key={tipo} className="print:break-inside-auto">
                      <header className="mb-1 flex flex-wrap items-end justify-between gap-2 border-b border-borda pb-1">
                        <div>
                          <h3 className="text-xl font-semibold">{nomeTipo(tipo)}</h3>
                          <div className="text-xs text-[#8a6d78]">
                            {pecasTipo} peça(s) · {brl(valorTipo)}
                            {d && d.alvoValor > 0 ? ` de ${brl(d.alvoValor)} (${Math.round(d.peso * 100)}% da maleta)` : ""}
                          </div>
                        </div>
                        <Botao variante="fantasma" className="nao-imprimir" onClick={() => setTroca({ tipo })}>
                          + Adicionar peça
                        </Botao>
                      </header>
                      {d && d.alvoValor > 0 && (
                        <div className="nao-imprimir mb-2 h-1.5 rounded-full bg-rose-claro">
                          <div className="h-1.5 rounded-full bg-rose-escuro" style={{ width: `${Math.min(100, (valorTipo / d.alvoValor) * 100)}%` }} />
                        </div>
                      )}
                      {lista.map((i) => (
                        <div key={i.chave} className="flex gap-3 border-b border-[#f3e8ec] py-2 last:border-0 print:break-inside-avoid">
                          <Link href={`/produtos/${i.produtoId}`} className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {i.imagemId ? <img src={img(i.imagemId, 160)!} alt="" className="h-16 w-16 rounded-lg object-cover print:h-12 print:w-12" /> : <div className="h-16 w-16 rounded-lg bg-rose-claro print:h-12 print:w-12" />}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-xs font-medium uppercase leading-snug">{i.nome}</div>
                            <div className="font-mono text-[0.7rem] text-[#8a6d78]">
                              {i.referencia ?? "—"} · {i.codigoBarras ?? "sem EAN"}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-rose-escuro">
                              {i.campea && <Selo cor="dourado">★ campeã</Selo>}
                              <span>{i.motivo}</span>
                            </div>
                            <div className="nao-imprimir mt-1 flex flex-wrap items-center gap-1">
                              <button className="h-7 w-7 rounded-full border border-borda text-rose-escuro disabled:opacity-40" onClick={() => alterarQtd(i.chave, -1)} disabled={i.quantidade <= 1} aria-label="Menos uma">
                                −
                              </button>
                              <span className="w-6 text-center text-sm font-medium">{i.quantidade}</span>
                              <button
                                className="h-7 w-7 rounded-full border border-borda text-rose-escuro disabled:opacity-40"
                                onClick={() => alterarQtd(i.chave, 1)}
                                disabled={i.quantidade >= i.estoque}
                                aria-label="Mais uma"
                              >
                                +
                              </button>
                              <span className="mr-2 text-[0.7rem] text-[#9a8089]">estoque {num(i.estoque, 0)}</span>
                              <Botao variante="fantasma" className="px-2! py-0.5! text-xs" onClick={() => setTroca({ tipo: i.tipo, substituir: i.chave })}>
                                Trocar
                              </Botao>
                              <Botao variante="perigo" className="px-2! py-0.5! text-xs" onClick={() => remover(i.chave)}>
                                Remover
                              </Botao>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-titulo text-lg font-semibold text-rose-escuro">{brl(i.preco)}</div>
                            <div className="text-xs text-[#8a6d78]">× {i.quantidade}</div>
                            {i.quantidade > 1 && <div className="text-xs text-[#8a6d78]">{brl(i.preco * i.quantidade)}</div>}
                          </div>
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-borda pt-3 text-sm">
              <span>
                <b>{totais.pecas}</b> peças
              </span>
              <span>
                Etiqueta <b>{brl(totais.valor)}</b>
              </span>
              <span className="nao-imprimir">
                Custo <b>{brl(totais.custo)}</b>
              </span>
            </div>
          </Cartao>
        </>
      )}

      <Modal aberto={!!troca} aoFechar={() => setTroca(null)} titulo={troca?.substituir ? `Trocar ${troca ? nomeTipo(troca.tipo).toLowerCase() : ""}` : `Adicionar ${troca ? nomeTipo(troca.tipo).toLowerCase() : ""}`}>
        {alternativas.length === 0 ? (
          <p className="text-sm text-[#8a6d78]">Não há outras peças deste tipo com estoque.</p>
        ) : (
          <div className="flex max-h-[65vh] flex-col overflow-auto">
            {alternativas.map((a) => (
              <div key={a.chave} className="flex items-center gap-3 border-b border-[#f3e8ec] py-2 last:border-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.imagemId ? <img src={img(a.imagemId, 120)!} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-rose-claro" />}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-xs font-medium uppercase">{a.nome}</div>
                  <div className="font-mono text-[0.7rem] text-[#8a6d78]">
                    {a.referencia ?? "—"} · estoque {num(a.estoque, 0)}
                  </div>
                  <div className="text-xs text-rose-escuro">{a.motivo}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-titulo text-lg font-semibold text-rose-escuro">{brl(a.preco)}</div>
                  <Botao variante="secundario" className="px-3! py-0.5! text-xs" onClick={() => escolher(a)}>
                    Escolher
                  </Botao>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function MaletaPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <MaletaConteudo />
    </Suspense>
  );
}
