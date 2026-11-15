"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api, img } from "@/lib/cliente";
import { prepararFoto } from "@/lib/pdf-cliente";
import {
  SITUACOES,
  dataLocal,
  dataValida,
  divergencia,
  novaConferencia,
  resumoConferencia,
  temProblema,
  type EntradaConferencia,
  type SituacaoRecebimento,
} from "@/lib/recebimento";
import { NOME_STATUS_CREDITO, type StatusCredito } from "@/lib/conta-fornecedor";
import { mensagemDe, valorMoeda, type DadosRecebimento, type LinhaRecebimento } from "./comum";

/**
 * Chegada e conferência do pedido (itens 23 e 24), para a funcionária conferir com a caixa na mão (celular):
 *  1. situação: Em trânsito → Recebido → Conferido, com a data de chegada (ao marcar Recebido sem data, fica hoje);
 *  2. uma linha por cartão: "Veio certo" ou a quantidade recebida e com defeito (+/−), foto pela câmera e observação;
 *  3. "Tudo certo" nas linhas que faltam e "Concluir conferência" (aí o estoque que entra é o conferido e as
 *     faltas/defeitos viram crédito com o fornecedor e o relatório para mandar a ele).
 *
 * Uso na tela do pedido: <ChegadaConferencia pedidoId={id} aoMudar={carregar} />
 * `aoMudar` é chamado quando a situação muda ou a conferência é concluída (não a cada linha).
 */

type Filtro = "pendentes" | "problemas" | "todas";
type Mudanca = { quantidadeRecebida?: number | null; quantidadeDefeito?: number; defeitoObs?: string | null };

const ORDEM: Record<SituacaoRecebimento, number> = { em_transito: 0, recebido: 1, conferido: 2 };

export function ChegadaConferencia({ pedidoId, aoMudar }: { pedidoId: string; aoMudar?: () => void }) {
  const avisar = useAviso();
  const [d, setD] = useState<DadosRecebimento | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null); // null = escolhe sozinho pela situação
  const [busca, setBusca] = useState("");
  const [tocadas, setTocadas] = useState<Set<string>>(() => new Set()); // continuam na lista depois de conferidas
  const [verLista, setVerLista] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [hoje] = useState(() => dataLocal());
  const fila = useRef(new Map<string, Mudanca>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const url = `/api/pedidos/${pedidoId}/recebimento`;

  const carregar = useCallback(() => api<DadosRecebimento>(`/api/pedidos/${pedidoId}/recebimento`).then(setD), [pedidoId]);
  useEffect(() => {
    carregar().catch((e) => avisar(mensagemDe(e), "erro"));
  }, [carregar, avisar]);

  // Saindo da tela com mudança ainda na fila: manda mesmo assim (keepalive).
  useEffect(() => {
    const f = fila.current;
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
      if (!f.size) return;
      const linhas = [...f].map(([id, m]) => ({ id, ...m }));
      f.clear();
      void fetch(`/api/pedidos/${pedidoId}/recebimento`, { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linhas, hoje: dataLocal() }) }).catch(() => {});
    };
  }, [pedidoId]);

  const patch = (corpo: Record<string, unknown>) => api<DadosRecebimento>(url, { method: "PATCH", json: { ...corpo, hoje: dataLocal() } });

  /** Manda as linhas que estão na fila (as mudanças de +/− esperam um instante e vão juntas). */
  async function descarregar() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!fila.current.size) return;
    const linhas = [...fila.current].map(([id, m]) => ({ id, ...m }));
    fila.current.clear();
    const meu = ++seq.current;
    try {
      const r = await patch({ linhas });
      if (meu === seq.current && !fila.current.size) setD(r);
      if (r.avisos?.length) {
        r.avisos.forEach((a) => avisar(a, "info"));
        aoMudar?.();
      }
    } catch (e) {
      avisar(mensagemDe(e), "erro");
      carregar().catch(() => {});
    }
  }

  function mudarLinha(l: LinhaRecebimento, entrada: EntradaConferencia) {
    const r = novaConferencia({ quantidade: l.quantidade, quantidadeRecebida: l.quantidadeRecebida, quantidadeDefeito: l.quantidadeDefeito, defeitoObs: l.defeitoObs }, entrada);
    if (!r.ok) return avisar(r.erro, "erro");
    setD((atual) => {
      if (!atual) return atual;
      const linhas = atual.linhas.map((x) => (x.id === l.id ? { ...x, quantidadeRecebida: r.valor.quantidadeRecebida, quantidadeDefeito: r.valor.quantidadeDefeito, defeitoObs: r.valor.defeitoObs } : x));
      return { ...atual, linhas, resumo: resumoConferencia(linhas) };
    });
    setTocadas((t) => (t.has(l.id) ? t : new Set(t).add(l.id)));
    const m: Mudanca = { ...(fila.current.get(l.id) ?? {}), quantidadeRecebida: r.valor.quantidadeRecebida, quantidadeDefeito: r.valor.quantidadeDefeito };
    if ("defeitoObs" in entrada) m.defeitoObs = r.valor.defeitoObs;
    fila.current.set(l.id, m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void descarregar(), 700);
  }

  async function acao(rotulo: string, corpo: Record<string, unknown>, sucesso?: string) {
    setOcupado(rotulo);
    try {
      await descarregar();
      const r = await patch(corpo);
      seq.current++;
      setD(r);
      r.avisos?.forEach((a) => avisar(a, "info"));
      if (sucesso) avisar(sucesso);
      aoMudar?.();
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function enviarFoto(l: LinhaRecebimento, arquivo: File) {
    setOcupado(`foto-${l.id}`);
    try {
      await descarregar();
      let foto: Blob = arquivo;
      try {
        foto = await prepararFoto(arquivo, 1600); // menor = sobe rápido pelo Wi-Fi da loja
      } catch {
        /* formato que o navegador não abre: manda o original */
      }
      const form = new FormData();
      form.set("produtoId", l.id);
      form.set("foto", foto, "defeito.jpg");
      const r = await api<DadosRecebimento>(url, { method: "POST", body: form });
      seq.current++;
      setD(r);
      avisar("Foto do defeito guardada.");
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function removerFoto(l: LinhaRecebimento) {
    if (!confirm("Apagar a foto do defeito?")) return;
    setOcupado(`foto-${l.id}`);
    try {
      await descarregar();
      const r = await patch({ linhas: [{ id: l.id, removerFoto: true }] });
      seq.current++;
      setD(r);
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  if (!d)
    return (
      <Cartao titulo="Chegada e conferência">
        <Carregando />
      </Cartao>
    );

  const sit = d.pedido.recebimento;
  const r = d.resumo;
  const filtroAtual: Filtro = filtro ?? (sit === "conferido" ? "problemas" : r.pendentes ? "pendentes" : "todas");
  const mostrarLista = verLista ?? sit === "recebido";
  const termo = busca.trim().toLowerCase();
  const visiveis = d.linhas.filter((l) => {
    const dv = divergencia(l);
    if (!tocadas.has(l.id)) {
      if (filtroAtual === "pendentes" && dv.conferida) return false;
      if (filtroAtual === "problemas" && !temProblema(dv)) return false;
    }
    return !termo || [l.codigoFornecedor, l.nome, l.referencia, l.especificacao, l.linha != null ? `#${l.linha}` : null].some((x) => x?.toLowerCase().includes(termo));
  });

  function escolherSituacao(nova: SituacaoRecebimento) {
    if (nova === sit) return;
    if (nova === "conferido") return concluir();
    if (sit === "conferido") {
      if (!confirm(`A conferência já foi concluída. Reabrir a conferência${nova === "em_transito" ? " e voltar para Em trânsito" : ""}?`)) return;
      return acao("situacao", { reabrir: true, ...(nova === "em_transito" ? { situacao: "em_transito" } : {}) }, "Conferência reaberta.");
    }
    if (nova === "em_transito" && r.conferidas && !confirm("Já há linhas conferidas. Voltar o pedido para Em trânsito? (as linhas conferidas continuam guardadas)")) return;
    acao("situacao", { situacao: nova });
  }

  function concluir() {
    if (!d?.linhas.length) return avisar("Este pedido não tem peças para conferir.", "erro");
    if (r.pendentes && !confirm(`Ainda há ${r.pendentes} linha(s) sem conferir. Marcar essas como "veio certo" (a quantidade pedida, sem defeito) e concluir?`)) return;
    acao("concluir", { tudoCerto: r.pendentes > 0, concluir: true }, "Conferência concluída: entra no estoque o que foi conferido.");
  }

  const creditosAbertos = d.creditos.filter((c) => c.status !== "cancelado");

  return (
    <Cartao
      titulo="Chegada e conferência"
      acoes={
        r.pecasACreditar > 0 ? (
          <Link href={`/pedidos/${pedidoId}/fornecedor`}>
            <Botao variante="secundario">Relatório para o fornecedor</Botao>
          </Link>
        ) : undefined
      }
    >
      {/* 1. Situação */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Situação do recebimento">
        {SITUACOES.map((s, i) => {
          const ativo = sit === s.id;
          const passou = sit != null && ORDEM[sit] > i;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => escolherSituacao(s.id)}
              disabled={!!ocupado}
              aria-pressed={ativo}
              className={`min-h-14 rounded-xl border px-2 py-2 text-center text-sm font-medium transition disabled:opacity-60 ${
                ativo ? "border-rose-escuro bg-rose-escuro text-white" : passou ? "border-rose bg-rose-claro text-rose-escuro" : "border-borda bg-white text-texto hover:bg-rose-claro/50"
              }`}
            >
              <span className="block">
                {passou ? "✓ " : `${i + 1}. `}
                {s.nome}
              </span>
              <span className={`mt-0.5 hidden text-[0.7rem] font-normal sm:block ${ativo ? "text-white/85" : "text-[#9a8089]"}`}>{s.explicacao}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
        {sit && sit !== "em_transito" ? (
          <label className="flex flex-col gap-1">
            <span className="rotulo">Data de chegada</span>
            <DataChegada valor={d.pedido.dataChegada} hoje={hoje} aoSalvar={(v) => acao("data", { dataChegada: v })} />
          </label>
        ) : (
          <p className="text-[#6b5560]">{sit === "em_transito" ? "A caminho." : "Situação não informada."} Quando a caixa chegar, toque em “Recebido” para começar a conferência.</p>
        )}
        {sit === "conferido" && (
          <p className="text-[#6b5560]">
            Conferido{d.pedido.conferidoEm ? ` em ${new Date(d.pedido.conferidoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
            {d.pedido.conferidoPor ? ` por ${d.pedido.conferidoPor}` : ""}.
          </p>
        )}
      </div>

      {/* 2. Resumo */}
      {d.linhas.length > 0 && (sit != null || r.conferidas > 0) && (
        <div className="mt-4 rounded-xl bg-rose-claro/50 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span>
              <b>{r.conferidas}</b> de {r.linhas} linha(s) conferida(s)
              {r.pendentes ? ` · ${r.pendentes} sem conferir` : " ✓"}
            </span>
            <span>
              Entram <b>{r.entram}</b> de {r.pedidas} peça(s)
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-white">
            <div className="h-2 rounded-full bg-rose-escuro transition-all" style={{ width: `${(r.conferidas / Math.max(1, r.linhas)) * 100}%` }} />
          </div>
          {(r.faltas > 0 || r.defeito > 0 || r.sobras > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {r.faltas > 0 && <Selo cor="vermelho">faltaram {r.faltas}</Selo>}
              {r.defeito > 0 && <Selo cor="amarelo">{r.defeito} com defeito</Selo>}
              {r.sobras > 0 && <Selo cor="cinza">{r.sobras} a mais</Selo>}
              {r.pecasACreditar > 0 && (
                <Selo cor="rose">
                  pedir ao fornecedor: {r.pecasACreditar} peça(s) · {valorMoeda(r.valorACreditar, d.pedido.moeda)}
                </Selo>
              )}
            </div>
          )}
        </div>
      )}

      {/* Créditos gerados (só a gestora vê) */}
      {creditosAbertos.length > 0 && (
        <div className="mt-3 rounded-xl border border-borda p-3 text-sm">
          <div className="font-medium">Crédito com o fornecedor gerado nesta conferência</div>
          <ul className="mt-1 flex flex-col gap-1">
            {creditosAbertos.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-x-3 text-xs">
                <span className="min-w-0">{c.descricao}</span>
                <span className="whitespace-nowrap">
                  {valorMoeda(c.valorMoeda, c.moeda)} · {NOME_STATUS_CREDITO[c.status as StatusCredito] ?? c.status}
                  {c.abatidoPedidoNumero ? ` no pedido ${c.abatidoPedidoNumero}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[#9a8089]">É abatido no próximo pedido deste fornecedor (quadro “Créditos com o fornecedor”).</p>
        </div>
      )}

      {/* 3. Linhas */}
      {d.linhas.length === 0 ? (
        <p className="mt-4 text-sm text-[#8a6d78]">Este pedido não tem peças.</p>
      ) : !mostrarLista ? (
        <div className="mt-4">
          <Botao variante="secundario" onClick={() => setVerLista(true)} className="w-full py-2.5! sm:w-auto">
            {sit === "conferido" ? `Ver as linhas da conferência${r.comProblema ? ` (${r.comProblema} com diferença)` : ""}` : "Conferir as peças agora"}
          </Botao>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              placeholder="Buscar pelo código da etiqueta (货号), nome ou nº da linha"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="sm:max-w-sm"
              aria-label="Buscar peça"
            />
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["pendentes", `Sem conferir (${r.pendentes})`],
                  ["problemas", `Com diferença (${r.comProblema})`],
                  ["todas", `Todas (${r.linhas})`],
                ] as const
              ).map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setFiltro(k);
                    setTocadas(new Set());
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm ${filtroAtual === k ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}
                >
                  {rotulo}
                </button>
              ))}
              {sit === "conferido" && (
                <button type="button" onClick={() => setVerLista(false)} className="rounded-full px-3 py-1.5 text-sm text-[#8a6d78] underline">
                  esconder
                </button>
              )}
            </div>
          </div>

          {sit === "conferido" && <p className="text-xs text-[#9a8089]">A conferência já foi concluída: corrigir uma linha atualiza o estoque que entra e o crédito com o fornecedor.</p>}

          {visiveis.length === 0 ? (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              {filtroAtual === "pendentes" ? "Nenhuma linha sem conferir." : filtroAtual === "problemas" ? "Nenhuma linha com diferença." : "Nenhuma peça encontrada."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visiveis.map((l) => (
                <CartaoLinha
                  key={l.id}
                  l={l}
                  ocupadoFoto={ocupado === `foto-${l.id}`}
                  aoMudar={mudarLinha}
                  aoFoto={enviarFoto}
                  aoRemoverFoto={removerFoto}
                />
              ))}
            </div>
          )}

          {sit !== "conferido" && (
            <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-2xl border border-borda bg-white/95 p-2 shadow-lg backdrop-blur sm:flex-row sm:justify-end">
              {r.pendentes > 0 && (
                <Botao
                  variante="secundario"
                  className="py-3! text-base!"
                  carregando={ocupado === "tudo"}
                  disabled={!!ocupado}
                  onClick={() =>
                    confirm(`Marcar as ${r.pendentes} linha(s) sem conferir como “veio certo” (chegou a quantidade pedida, sem defeito)?`) &&
                    acao("tudo", { tudoCerto: true }, `${r.pendentes} linha(s) marcadas como “veio certo”.`)
                  }
                >
                  ✓ Tudo certo nas {r.pendentes} linha(s) sem conferir
                </Botao>
              )}
              <Botao className="py-3! text-base!" carregando={ocupado === "concluir"} disabled={!!ocupado} onClick={concluir}>
                Concluir conferência
              </Botao>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}

/** Data de chegada: grava ao escolher no calendário (celular) ou ao sair do campo; nunca no futuro. */
function DataChegada({ valor, hoje, aoSalvar }: { valor: string | null; hoje: string; aoSalvar: (v: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gravar = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v && v !== valor && dataValida(v) && v <= hoje) aoSalvar(v);
  };
  return (
    <input
      key={valor ?? ""}
      type="date"
      max={hoje}
      defaultValue={valor ?? ""}
      className="w-44"
      onChange={(e) => {
        const v = e.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => gravar(v), 1200);
      }}
      onBlur={(e) => gravar(e.target.value)}
    />
  );
}

function CartaoLinha({
  l,
  ocupadoFoto,
  aoMudar,
  aoFoto,
  aoRemoverFoto,
}: {
  l: LinhaRecebimento;
  ocupadoFoto: boolean;
  aoMudar: (l: LinhaRecebimento, e: EntradaConferencia) => void;
  aoFoto: (l: LinhaRecebimento, f: File) => void;
  aoRemoverFoto: (l: LinhaRecebimento) => void;
}) {
  const dv = divergencia(l);
  const [aberto, setAberto] = useState(false);
  const editando = dv.conferida || aberto;
  const problema = temProblema(dv);
  const recebidas = dv.recebida ?? dv.pedida;
  return (
    <div className={`rounded-2xl border p-3 ${!dv.conferida ? "border-borda bg-white" : problema ? "border-amber-300 bg-amber-50/50" : "border-emerald-200 bg-emerald-50/40"}`}>
      <div className="flex gap-3">
        {l.imagemId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img(l.imagemId, 200)!} alt="" loading="lazy" decoding="async" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-20 w-20 shrink-0 rounded-lg bg-rose-claro" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[#9a8089]">
            #{l.linha ?? "?"} · <span className="font-mono text-sm font-semibold text-texto">{l.codigoFornecedor ?? "sem código"}</span>
            {l.especificacao ? <span className="ml-1 rounded bg-stone-100 px-1 font-mono text-texto">{l.especificacao}</span> : null}
          </div>
          <div className="line-clamp-2 text-sm font-medium uppercase leading-snug">{l.nome ?? "—"}</div>
          <div className="mt-0.5 text-sm text-[#6b5560]">
            Pedido: <b>{dv.pedida}</b>
            {dv.conferida && (
              <>
                {" "}
                · entram <b>{dv.entram}</b>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {dv.conferida && !problema && <Selo cor="verde">✓ conferida</Selo>}
            {dv.falta > 0 && <Selo cor="vermelho">faltou {dv.falta}</Selo>}
            {dv.defeito > 0 && <Selo cor="amarelo">{dv.defeito} com defeito</Selo>}
            {dv.sobra > 0 && <Selo cor="cinza">{dv.sobra} a mais</Selo>}
            {l.recompra && <Selo cor="cinza">↻ recompra</Selo>}
          </div>
        </div>
      </div>

      {!editando ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => aoMudar(l, { quantidadeRecebida: l.quantidade, quantidadeDefeito: 0 })}
            className="min-h-12 rounded-xl bg-emerald-600 px-3 text-base font-semibold text-white active:bg-emerald-700"
          >
            ✓ Veio certo ({dv.pedida})
          </button>
          <button type="button" onClick={() => setAberto(true)} className="min-h-12 rounded-xl border border-rose bg-white px-3 text-base font-medium text-rose-escuro active:bg-rose-claro">
            Tem diferença
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Contador rotulo="Recebidas" valor={recebidas} aoMudar={(v) => aoMudar(l, { quantidadeRecebida: v })} />
          <Contador rotulo="Com defeito" valor={dv.defeito} max={recebidas} aoMudar={(v) => aoMudar(l, dv.conferida ? { quantidadeDefeito: v } : { quantidadeRecebida: recebidas, quantidadeDefeito: v })} />
          {dv.defeito > 0 && (
            <div className="flex flex-col gap-2 rounded-xl bg-white/70 p-2">
              <div className="flex items-center gap-2">
                <label
                  className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full border border-rose bg-white px-4 text-sm font-medium text-rose-escuro active:bg-rose-claro ${ocupadoFoto ? "pointer-events-none opacity-60" : ""}`}
                >
                  {ocupadoFoto ? "Enviando a foto…" : l.defeitoImagemId ? "Trocar a foto do defeito" : "Tirar foto do defeito"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) aoFoto(l, f);
                    }}
                  />
                </label>
                {l.defeitoImagemId && (
                  <a href={img(l.defeitoImagemId)!} target="_blank" rel="noreferrer" className="shrink-0" title="Ver a foto">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img(l.defeitoImagemId, 160)!} alt="Foto do defeito" loading="lazy" decoding="async" className="h-12 w-12 rounded-lg object-cover" />
                  </a>
                )}
                {l.defeitoImagemId && (
                  <button type="button" onClick={() => aoRemoverFoto(l)} className="shrink-0 text-xs text-[#8a6d78] underline">
                    apagar
                  </button>
                )}
              </div>
              <textarea
                key={`obs-${l.defeitoObs ?? ""}`}
                defaultValue={l.defeitoObs ?? ""}
                rows={2}
                maxLength={500}
                placeholder="O que tem? Ex.: banho manchado, pedra solta, fecho quebrado"
                aria-label="Observação do defeito"
                onBlur={(e) => e.target.value.trim() !== (l.defeitoObs ?? "") && aoMudar(l, { defeitoObs: e.target.value })}
              />
            </div>
          )}
          {dv.conferida ? (
            <button type="button" onClick={() => aoMudar(l, { quantidadeRecebida: null })} className="self-start text-xs text-[#8a6d78] underline">
              desfazer a conferência desta linha
            </button>
          ) : (
            <button type="button" onClick={() => setAberto(false)} className="self-start text-xs text-[#8a6d78] underline">
              cancelar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** − número + com botões grandes para o dedo. */
function Contador({ rotulo, valor, aoMudar, max }: { rotulo: string; valor: number; aoMudar: (v: number) => void; max?: number }) {
  const botao = "h-12 w-12 shrink-0 rounded-full border border-rose bg-white text-2xl leading-none text-rose-escuro active:bg-rose-claro disabled:opacity-40";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{rotulo}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={`${rotulo}: menos um`} disabled={valor <= 0} onClick={() => aoMudar(Math.max(0, valor - 1))} className={botao}>
          −
        </button>
        <input
          key={valor}
          inputMode="numeric"
          defaultValue={valor}
          aria-label={rotulo}
          className="h-12 w-16 text-center text-xl font-semibold"
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            const n = Number(e.target.value.trim());
            if (Number.isInteger(n) && n >= 0 && (max == null || n <= max)) {
              if (n !== valor) aoMudar(n);
            } else e.target.value = String(valor);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" aria-label={`${rotulo}: mais um`} disabled={max != null && valor >= max} onClick={() => aoMudar(valor + 1)} className={botao}>
          +
        </button>
      </div>
    </div>
  );
}

