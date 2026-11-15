"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ItemMaleta, ResultadoMaleta } from "@/lib/maleta-calculo";
import { NOME_SITUACAO, type CampoConsignado, type MapeamentoConsignado, type ResumoRevendedoraConsignado, type Situacao } from "@/lib/consignado-calculo";
import { chaveNome } from "@/lib/vendas-calculo";
import { celulaCsv } from "@/lib/csv";
import { lerNumeroBr } from "@/lib/numeros";
import { Botao, Campo, Carregando, Cartao, Modal, Numero, Selo, useAviso } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, img, num } from "@/lib/cliente";

interface Dados {
  temVendas: boolean;
  revendedoras: { nome: string; pecas: number; receita: number; ultimaVenda: string | null; tipoFavorito: string | null }[];
  valorAlvo: number | null;
  pecasAlvo: number;
}
type Sugestao = ResultadoMaleta & { valorAlvo: number | null; pecasAlvo: number; temVendas: boolean; temConsignado: boolean; geradoEm: string };

interface LoteConsignado {
  id: string;
  arquivoNome: string | null;
  linhas: number;
  criadoEm: string;
  pecas: number;
  revendedoras: number;
}
interface ResumoConsignado {
  revendedoras: ResumoRevendedoraConsignado[];
  totais: Record<Situacao, number>;
  naoLigadas: { linhas: number; pecas: number };
  lotes: LoteConsignado[];
  atualizadoEm: string | null;
}

const NOVA = "__nova__";
const SITUACOES_TELA: Situacao[] = ["com_revendedora", "devolvida", "vendida", "avariada", "perdida"];
const ROTULO_COLUNA: Record<Situacao, string> = { com_revendedora: "Com ela", devolvida: "Devolvidas", vendida: "Vendidas", avariada: "Avariadas", perdida: "Perdidas" };
const dataBr = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pecas = (v: number) => num(v, Number.isInteger(v) ? 0 : 1);
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "maleta";

function Foto({ id, classe }: { id: string | null; classe: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return id ? <img src={img(id, 160)!} alt="" loading="lazy" decoding="async" className={`${classe} rounded-lg object-cover`} /> : <div className={`${classe} rounded-lg bg-rose-claro`} />;
}

function MaletaConteudo() {
  const params = useSearchParams();
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [dados, setDados] = useState<Dados | null>(null);
  const [consignado, setConsignado] = useState<ResumoConsignado | null>(null);
  const [revendedora, setRevendedora] = useState(params.get("revendedora") || NOVA);
  const [nomeNova, setNomeNova] = useState("");
  const [valorAlvo, setValorAlvo] = useState("");
  const [pecasAlvo, setPecasAlvo] = useState("");
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [itens, setItens] = useState<ItemMaleta[]>([]);
  const [gerando, setGerando] = useState(false);
  const [troca, setTroca] = useState<{ tipo: string; substituir?: string } | null>(null);

  const carregarConsignado = useCallback(() => api<ResumoConsignado>("/api/consignado").then(setConsignado), []);
  useEffect(() => {
    api<Dados>("/api/maleta")
      .then(setDados)
      .catch((e) => avisar(msg(e), "erro"));
    carregarConsignado().catch((e) => avisar(msg(e), "erro"));
  }, [avisar, carregarConsignado]);

  // Revendedoras das vendas + as do consignado (sem repetir quem escreve o nome de outro jeito).
  const opcoes = useMemo(() => {
    const lista = [...(dados?.revendedoras ?? [])];
    const vistas = new Set(lista.map((r) => chaveNome(r.nome)));
    for (const c of consignado?.revendedoras ?? []) {
      if (vistas.has(c.chave)) continue;
      vistas.add(c.chave);
      lista.push({ nome: c.nome, pecas: 0, receita: 0, ultimaVenda: null, tipoFavorito: null });
    }
    if (revendedora !== NOVA && !vistas.has(chaveNome(revendedora))) lista.push({ nome: revendedora, pecas: 0, receita: 0, ultimaVenda: null, tipoFavorito: null });
    return lista;
  }, [dados, consignado, revendedora]);
  const atual = opcoes.find((r) => r.nome === revendedora);
  const consignadoDela = revendedora !== NOVA ? consignado?.revendedoras.find((c) => c.chave === chaveNome(revendedora)) : undefined;
  const nomeMaleta = revendedora === NOVA ? nomeNova.trim() || "Nova revendedora" : revendedora;
  const nomeTipo = (t: string) => (t === "outros" ? "Outros" : nomeDe(tax?.tipos, t));

  async function gerar() {
    setGerando(true);
    try {
      const r = await api<Sugestao>("/api/maleta", {
        method: "POST",
        json: {
          revendedora: revendedora === NOVA ? null : revendedora,
          valorAlvo: lerNumeroBr(valorAlvo) || undefined,
          pecasAlvo: Math.round(lerNumeroBr(pecasAlvo) ?? 0) || undefined,
          tiposExcluidos: [...excluidos],
        },
      });
      setSugestao(r);
      setItens(r.itens);
      if (!r.itens.length) avisar("Não encontrei peças disponíveis para sugerir.", "info");
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
    const linhas = [["Referência", "EAN", "Quantidade", "Preço"], ...itens.map((i) => [i.referencia ?? "", i.codigoBarras ?? "", i.quantidade, i.preco])];
    const csv = "﻿" + linhas.map((l) => l.map((c) => celulaCsv(c)).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `maleta-${slug(nomeMaleta)}-${new Date().toLocaleDateString("sv-SE")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const teto = sugestao?.teto ?? null;
  const passouTeto = teto != null && totais.valor > teto + 0.005;

  return (
    <div className="flex flex-col gap-5">
      <div className="nao-imprimir">
        <h1 className="text-3xl font-semibold sm:text-4xl">Maleta inteligente</h1>
        <p className="text-sm text-[#8a6d78]">
          Mix sugerido para a maleta de cada revendedora, pelo que ela mais vende e pelo giro das peças na loja. Só entram peças que já chegaram, que estão no UP e que não estão com outra
          revendedora.
        </p>
      </div>

      {dados && !dados.temVendas && (
        <div className="nao-imprimir rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Ainda não há vendas importadas: a sugestão vai usar os <b>destaques</b> e as <b>novidades</b> do estoque. Para a maleta aprender o que cada revendedora vende, importe as vendas do UP em{" "}
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
              <Campo rotulo="Valor máximo (R$)" dica="teto em etiqueta; vazio = sem teto">
                <input inputMode="decimal" placeholder="sem teto" value={valorAlvo} onChange={(e) => setValorAlvo(e.target.value)} />
              </Campo>
              <Campo rotulo="Peças-alvo">
                <input inputMode="numeric" placeholder={String(dados.pecasAlvo)} value={pecasAlvo} onChange={(e) => setPecasAlvo(e.target.value)} />
              </Campo>
              {revendedora === NOVA ? (
                <Campo rotulo="Nome (opcional)" className="col-span-2" dica="Só para a impressão e o arquivo; a sugestão usa as vendas gerais da loja.">
                  <input value={nomeNova} onChange={(e) => setNomeNova(e.target.value)} placeholder="ex.: Joana Souza" />
                </Campo>
              ) : (
                <div className="col-span-2 self-end text-sm text-[#6b5560]">
                  {atual?.pecas ? (
                    <p>
                      {num(atual.pecas, 0)} peças vendidas · {brl(atual.receita)}
                      {atual.tipoFavorito ? ` · mais vende ${nomeTipo(atual.tipoFavorito).toLowerCase()}` : ""} · última venda {dataBr(atual.ultimaVenda)}
                    </p>
                  ) : (
                    <p>Sem vendas no histórico: a sugestão usa as vendas gerais da loja.</p>
                  )}
                  {consignadoDela && (
                    <p className="text-xs text-[#8a6d78]">
                      Consignado: {pecas(consignadoDela.com_revendedora)} com ela agora · {pecas(consignadoDela.devolvida)} devolvida(s) — não vão de novo nesta maleta.
                    </p>
                  )}
                </div>
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
            <Numero
              rotulo="Valor em etiqueta"
              valor={<span className={`text-xl sm:text-2xl ${passouTeto ? "text-red-700" : ""}`}>{brl(totais.valor)}</span>}
              detalhe={teto != null ? (passouTeto ? `passou do teto de ${brl(teto)}` : `teto ${brl(teto)}`) : "sem teto"}
            />
            <Numero rotulo="Custo" valor={<span className="text-xl sm:text-2xl">{brl(totais.custo)}</span>} detalhe={totais.custo ? `markup × ${num(totais.valor / totais.custo, 1)}` : "—"} />
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
                            {d && d.alvoPecas > 0 ? ` · referência ${num(d.alvoPecas, 0)} peças (${Math.round(d.peso * 100)}% da maleta)` : ""}
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
                            <Foto id={i.imagemId} classe="h-16 w-16 print:h-12 print:w-12" />
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
                              <span className="mr-2 text-[0.7rem] text-[#9a8089]">disponível {num(i.estoque, 0)}</span>
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
                Etiqueta <b className={passouTeto ? "text-red-700" : ""}>{brl(totais.valor)}</b>
                {teto != null && <span className="text-xs text-[#9a8089]"> (teto {brl(teto)})</span>}
              </span>
              <span className="nao-imprimir">
                Custo <b>{brl(totais.custo)}</b>
              </span>
            </div>
          </Cartao>
        </>
      )}

      <Consignado
        resumo={consignado}
        aoMudar={() => carregarConsignado().catch((e) => avisar(msg(e), "erro"))}
        aoEscolher={(nome) => {
          setRevendedora(nome);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <Modal aberto={!!troca} aoFechar={() => setTroca(null)} titulo={troca?.substituir ? `Trocar ${troca ? nomeTipo(troca.tipo).toLowerCase() : ""}` : `Adicionar ${troca ? nomeTipo(troca.tipo).toLowerCase() : ""}`}>
        {alternativas.length === 0 ? (
          <p className="text-sm text-[#8a6d78]">Não há outras peças deste tipo disponíveis.</p>
        ) : (
          <div className="flex max-h-[65vh] flex-col overflow-auto">
            {alternativas.map((a) => (
              <div key={a.chave} className="flex items-center gap-3 border-b border-[#f3e8ec] py-2 last:border-0">
                <Foto id={a.imagemId} classe="h-14 w-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-xs font-medium uppercase">{a.nome}</div>
                  <div className="font-mono text-[0.7rem] text-[#8a6d78]">
                    {a.referencia ?? "—"} · disponível {num(a.estoque, 0)}
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

/* ------------------------------------------------- consignado do UP */

function Consignado({ resumo, aoMudar, aoEscolher }: { resumo: ResumoConsignado | null; aoMudar: () => void; aoEscolher: (nome: string) => void }) {
  const avisar = useAviso();
  const [importar, setImportar] = useState(false);
  const [podeDesfazer, setPodeDesfazer] = useState(false);
  useEffect(() => {
    api<{ modo: string; usuario: { papel: string } | null }>("/api/sessao")
      .then((s) => setPodeDesfazer(s.modo !== "usuarios" || s.usuario?.papel === "gestora"))
      .catch(() => {});
  }, []);

  async function desfazer(l: LoteConsignado) {
    if (!confirm(`Desfazer a importação de "${l.arquivoNome ?? "planilha"}"? As ${l.linhas} linha(s) dela serão apagadas e a planilha anterior volta a valer para as mesmas peças.`)) return;
    try {
      await api(`/api/consignado/lotes/${l.id}`, { method: "DELETE" });
      avisar("Importação desfeita.");
      aoMudar();
    } catch (e) {
      avisar(msg(e), "erro");
    }
  }

  return (
    <Cartao
      className="nao-imprimir"
      titulo="Peças com as revendedoras (consignado do UP)"
      acoes={
        <Botao variante="secundario" onClick={() => setImportar((v) => !v)}>
          ⇪ Importar consignado do UP
        </Botao>
      }
    >
      {importar && (
        <ImportarConsignado
          aoFechar={() => setImportar(false)}
          aoImportar={() => {
            aoMudar();
          }}
        />
      )}
      {!resumo ? (
        <Carregando />
      ) : !resumo.revendedoras.length ? (
        <div className="text-sm text-[#6b5560]">
          <p>Ainda não há consignado importado. Com ele, a maleta não sugere peças que já estão com alguma revendedora nem o que ela já devolveu.</p>
          <ol className="mt-2 ml-5 list-decimal space-y-1">
            <li>
              No <b>UP Vendas</b>, exporte o relatório de <b>consignado / maletas</b> (as peças de cada maleta e a situação: em aberto, devolvida, vendida…) em Excel ou CSV.
            </li>
            <li>
              Clique em <b>Importar consignado do UP</b>, confira qual coluna é cada campo, confira a prévia e grave.
            </li>
            <li>Repita quando as maletas mudarem: para a mesma revendedora, data e peça, vale a planilha mais nova.</li>
          </ol>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {SITUACOES_TELA.map((s) => (
              <Selo key={s} cor={s === "com_revendedora" ? "rose" : s === "vendida" ? "verde" : s === "devolvida" ? "cinza" : "vermelho"}>
                {pecas(resumo.totais[s])} {NOME_SITUACAO[s]}
              </Selo>
            ))}
            <span className="text-xs text-[#9a8089]">atualizado em {dataHora(resumo.atualizadoEm)}</span>
          </div>
          {resumo.naoLigadas.linhas > 0 && (
            <p className="mb-2 text-xs text-amber-800">
              {resumo.naoLigadas.linhas} linha(s) ({pecas(resumo.naoLigadas.pecas)} peças) não acharam a peça no app pelo código de barras nem pela referência: contam no resumo, mas não tiram
              peça da maleta.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="tabela w-full min-w-[640px]">
              <thead>
                <tr>
                  <th>Revendedora</th>
                  {SITUACOES_TELA.map((s) => (
                    <th key={s}>{ROTULO_COLUNA[s]}</th>
                  ))}
                  <th>Última maleta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resumo.revendedoras.map((r) => (
                  <tr key={r.chave}>
                    <td className="font-medium">{r.nome}</td>
                    {SITUACOES_TELA.map((s) => (
                      <td key={s} className={s === "com_revendedora" && r[s] ? "font-semibold text-rose-escuro" : (s === "avariada" || s === "perdida") && r[s] ? "text-red-700" : ""}>
                        {r[s] ? pecas(r[s]) : "—"}
                      </td>
                    ))}
                    <td className="whitespace-nowrap">{dataBr(r.ultimaData)}</td>
                    <td className="text-right">
                      <Botao variante="secundario" onClick={() => aoEscolher(r.nome)}>
                        Montar maleta
                      </Botao>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {resumo && resumo.lotes.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-[#8a6d78]">Planilhas de consignado importadas ({resumo.lotes.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tabela w-full min-w-[560px]">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Importado em</th>
                  <th>Linhas</th>
                  <th>Peças</th>
                  <th>Revendedoras</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resumo.lotes.map((l) => (
                  <tr key={l.id}>
                    <td className="max-w-[240px] truncate" title={l.arquivoNome ?? ""}>
                      {l.arquivoNome ?? "—"}
                    </td>
                    <td className="whitespace-nowrap">{dataHora(l.criadoEm)}</td>
                    <td>{l.linhas}</td>
                    <td>{pecas(l.pecas)}</td>
                    <td>{l.revendedoras}</td>
                    <td className="text-right">
                      {podeDesfazer && (
                        <Botao variante="perigo" onClick={() => desfazer(l)}>
                          Desfazer
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Cartao>
  );
}

interface PreviaConsignado {
  arquivoNome: string;
  cabecalhos: string[];
  mapeamento: MapeamentoConsignado;
  amostra: string[][];
  totalLinhas: number;
  linhaCabecalho: number;
  campos: { id: CampoConsignado; nome: string }[];
}

interface ResultadoConsignado {
  loteId: string | null;
  simulado: boolean;
  arquivoNome: string;
  linhas: number;
  ligadas: number;
  naoLigadas: number;
  revendedoras: number;
  porSituacao: Record<Situacao, number>;
  periodoInicio: string | null;
  periodoFim: string | null;
  totalIgnoradas: number;
  motivos: Record<string, number>;
  ignoradas: { linha: number; motivo: string }[];
}

const POR_SITUACAO: CampoConsignado[] = ["qtdComRevendedora", "qtdDevolvida", "qtdVendida", "qtdAvariada", "qtdPerdida"];

function ImportarConsignado({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: () => void }) {
  const avisar = useAviso();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaConsignado | null>(null);
  const [mapa, setMapa] = useState<MapeamentoConsignado>({});
  const [revendedoraPadrao, setRevendedoraPadrao] = useState("");
  const [ocupado, setOcupado] = useState<"" | "lendo" | "conferindo" | "gravando">("");
  const [resultado, setResultado] = useState<ResultadoConsignado | null>(null);

  async function escolher(f: File | undefined) {
    if (!f) return;
    setArquivo(f);
    setPrevia(null);
    setResultado(null);
    setOcupado("lendo");
    try {
      const form = new FormData();
      form.set("arquivo", f);
      const p = await api<PreviaConsignado>("/api/consignado/previa", { method: "POST", body: form });
      setPrevia(p);
      setMapa(p.mapeamento);
    } catch (e) {
      avisar(msg(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function enviar(simular: boolean) {
    if (!arquivo) return;
    setOcupado(simular ? "conferindo" : "gravando");
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("mapeamento", JSON.stringify(mapa));
      form.set("opcoes", JSON.stringify({ simular, revendedoraPadrao: revendedoraPadrao.trim() || null }));
      const r = await api<ResultadoConsignado>("/api/consignado/importar", { method: "POST", body: form });
      setResultado(r);
      if (!simular) {
        avisar(`${r.linhas} linha(s) de consignado gravada(s).`);
        aoImportar();
      }
    } catch (e) {
      avisar(msg(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const campoDaColuna = (i: number) => ((Object.entries(mapa) as [CampoConsignado, number][]).find(([, c]) => c === i)?.[0] ?? "") as CampoConsignado | "";
  const definir = (i: number, campo: CampoConsignado | "") => {
    setResultado(null);
    setMapa((m) => {
      const n: MapeamentoConsignado = { ...m };
      for (const k of Object.keys(n) as CampoConsignado[]) if (n[k] === i || k === campo) delete n[k];
      if (campo) n[campo] = i;
      return n;
    });
  };
  const nomeCampo = (c: CampoConsignado | "") => previa?.campos.find((x) => x.id === c)?.nome ?? "";
  const tem = (c: CampoConsignado) => mapa[c] != null;
  const porSituacao = POR_SITUACAO.some(tem);
  const faltas = [
    !tem("referencia") && !tem("codigoBarras") && "a coluna da referência ou a do código de barras",
    !tem("revendedora") && !revendedoraPadrao.trim() && "a coluna da revendedora (ou o nome dela, se a planilha for de uma maleta só)",
  ].filter(Boolean) as string[];

  return (
    <div className="mb-4 rounded-2xl border border-rose bg-[#fdf7f9] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-sm">Importar consignado (maletas) do UP</b>
        <Botao variante="fantasma" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-rose bg-white px-4 py-5 text-center hover:bg-[#fdf7f9]">
        <span className="font-script text-2xl text-rose-escuro">escolha a planilha das maletas</span>
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
            <b>{previa.totalLinhas}</b> linha(s) com dados; cabeçalho na linha {previa.linhaCabecalho}. Confira qual campo é cada coluna. A planilha pode ter uma coluna <b>Situação</b> (em
            aberto, devolvida, vendida, avariada, perdida) ou uma coluna de quantidade para cada situação.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {previa.cabecalhos.map((c, i) => {
              const campo = campoDaColuna(i);
              return (
                <div key={i} className={`rounded-xl border p-2 ${campo ? "border-rose bg-white" : "border-borda bg-white/60"}`}>
                  <div className="truncate text-sm font-medium" title={c}>
                    {c}
                  </div>
                  <select value={campo} onChange={(e) => definir(i, e.target.value as CampoConsignado | "")} className="mt-1">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Revendedora (planilha de uma maleta só)" dica="Só quando a planilha não tem a coluna da revendedora.">
              <input
                value={revendedoraPadrao}
                onChange={(e) => {
                  setRevendedoraPadrao(e.target.value);
                  setResultado(null);
                }}
                placeholder="nome como está no UP"
              />
            </Campo>
            <p className="self-end text-xs text-[#9a8089]">
              {porSituacao
                ? "Usando as colunas de quantidade por situação. Se houver a quantidade enviada e não houver a coluna “em aberto”, o que sobra conta como com a revendedora."
                : tem("situacao")
                  ? "Usando a coluna Situação; situação vazia conta como com a revendedora."
                  : "Sem coluna de situação: todas as linhas contam como peças com a revendedora."}
            </p>
          </div>

          {faltas.length > 0 && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">Falta indicar {faltas.join(" e ")}.</div>}

          <div className="flex flex-wrap justify-end gap-2">
            <Botao variante="secundario" onClick={() => enviar(true)} carregando={ocupado === "conferindo"} disabled={faltas.length > 0}>
              Conferir antes de gravar
            </Botao>
            <Botao onClick={() => enviar(false)} carregando={ocupado === "gravando"} disabled={faltas.length > 0 || !resultado?.simulado}>
              Gravar
            </Botao>
          </div>
        </div>
      )}

      {resultado && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${resultado.simulado ? "bg-white text-[#4a3540]" : "bg-emerald-50 text-emerald-800"}`}>
          <p>
            {resultado.simulado ? "Prévia (nada gravado ainda): " : "✓ Gravado: "}
            <b>{resultado.linhas}</b> linha(s) de <b>{resultado.revendedoras}</b> revendedora(s)
            {resultado.periodoInicio ? `, de ${dataBr(resultado.periodoInicio)} a ${dataBr(resultado.periodoFim)}` : ""}; {resultado.ligadas} ligada(s) a peças do app
            {resultado.naoLigadas ? `, ${resultado.naoLigadas} sem peça no app (confira a referência/EAN)` : ""}.
          </p>
          <p className="mt-1 flex flex-wrap gap-1">
            {SITUACOES_TELA.map((s) => (
              <Selo key={s} cor="cinza">
                {pecas(resultado.porSituacao[s])} {NOME_SITUACAO[s]}
              </Selo>
            ))}
          </p>
          {resultado.simulado && <p className="mt-1 text-xs text-[#8a6d78]">Se estiver certo, clique em Gravar.</p>}
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
