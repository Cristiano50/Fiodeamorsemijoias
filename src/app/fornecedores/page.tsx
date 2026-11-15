"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl } from "@/lib/cliente";
import { RenomearFornecedor } from "@/components/Fornecedor";
import { CampoNumero, apiSeGestora, mensagemDe, valorMoeda, type CreditoTela } from "@/components/pedido/comum";
import { NOME_STATUS_CREDITO, type StatusCredito, type TotalCreditos } from "@/lib/conta-fornecedor";
import { dataBr, nomeSituacao } from "@/lib/recebimento";

/**
 * Fornecedores (item 30), só a gestora: apelido e nome original, lote mínimo da recompra, pedidos,
 * total pago e a conta de créditos (faltas e defeitos) — em aberto, abatidos e cancelados.
 */

interface ContaFornecedor {
  nome: string;
  apelido: string | null;
  pedidos: number;
  ultimo: string | null;
  chave: string;
  loteMinimo: number | null;
  loteMinimoEfetivo: number;
  totalPagoBrl: number;
  pedidosPagos: number;
  listaPedidos: { id: string; numero: string | null; dataCompra: string | null; moeda: string; valorPagoBrl: number | null; recebimento: string | null; dataChegada: string | null }[];
  creditos: { abertos: TotalCreditos[]; abatidos: TotalCreditos[]; cancelados: number };
}

const totalTexto = (t: TotalCreditos[]) => (t.length ? t.map((x) => valorMoeda(x.valor, x.moeda)).join(" + ") : "—");
const pecasTexto = (t: TotalCreditos[]) => t.reduce((s, x) => s + x.pecas, 0);

export default function FornecedoresPage() {
  const avisar = useAviso();
  const [d, setD] = useState<{ fornecedores: ContaFornecedor[]; loteMinimoPadrao: number } | null | undefined>(undefined);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(() => apiSeGestora<{ fornecedores: ContaFornecedor[]; loteMinimoPadrao: number }>("/api/fornecedores?conta=1").then(setD), []);
  useEffect(() => {
    carregar().catch((e) => {
      setD({ fornecedores: [], loteMinimoPadrao: 1 });
      avisar(mensagemDe(e), "erro");
    });
  }, [carregar, avisar]);

  if (d === undefined) return <Carregando />;
  if (d === null)
    return (
      <Cartao>
        <p className="text-sm text-[#8a6d78]">Somente a gestora vê a conta dos fornecedores.</p>
      </Cartao>
    );

  const termo = busca.trim().toLowerCase();
  const lista = d.fornecedores.filter((f) => !termo || [f.nome, f.apelido].some((x) => x?.toLowerCase().includes(termo)));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-4xl font-semibold">Fornecedores</h1>
        <p className="max-w-3xl text-sm text-[#8a6d78]">
          Apelido, lote mínimo da recompra, quanto já foi pago e os créditos por falta ou defeito. Os créditos nascem na conferência da chegada e são abatidos no próximo pedido do mesmo fornecedor.
        </p>
      </div>
      {d.fornecedores.length > 4 && <input type="search" placeholder="Buscar fornecedor…" value={busca} onChange={(e) => setBusca(e.target.value)} className="sm:max-w-sm" aria-label="Buscar fornecedor" />}
      {d.fornecedores.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[#8a6d78]">Nenhum fornecedor ainda: eles aparecem aqui a partir dos pedidos importados.</p>
        </Cartao>
      ) : (
        lista.map((f) => <CartaoFornecedor key={f.chave} f={f} padrao={d.loteMinimoPadrao} aoMudar={() => void carregar().catch(() => {})} />)
      )}
    </div>
  );
}

function CartaoFornecedor({ f, padrao, aoMudar }: { f: ContaFornecedor; padrao: number; aoMudar: () => void }) {
  const avisar = useAviso();
  const [verPedidos, setVerPedidos] = useState(false);
  const [creditos, setCreditos] = useState<CreditoTela[] | null>(null);
  const [verCreditos, setVerCreditos] = useState(false);
  const [ocupado, setOcupado] = useState("");

  async function salvarLote(v: number | null) {
    setOcupado("lote");
    try {
      await api("/api/fornecedores", { method: "PUT", json: { nome: f.nome, loteMinimo: v } });
      avisar(v ? `Lote mínimo: ${v} peça(s).` : `Lote mínimo: o padrão da loja (${padrao}).`);
      aoMudar();
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const carregarCreditos = useCallback(() => api<{ creditos: CreditoTela[] }>(`/api/creditos?fornecedor=${encodeURIComponent(f.chave)}`).then((r) => setCreditos(r.creditos)), [f.chave]);

  async function abrirCreditos() {
    const abrir = !verCreditos;
    setVerCreditos(abrir);
    if (abrir && !creditos) await carregarCreditos().catch((e) => avisar(mensagemDe(e), "erro"));
  }

  async function alterar(c: CreditoTela, acao: "cancelar" | "reabrir", sucesso: string, pergunta?: string) {
    if (pergunta && !confirm(pergunta)) return;
    setOcupado(c.id);
    try {
      await api(`/api/creditos/${c.id}`, { method: "PATCH", json: { acao } });
      await carregarCreditos();
      avisar(sucesso);
      aoMudar();
    } catch (e) {
      avisar(mensagemDe(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  return (
    <Cartao>
      <div className="text-lg">
        <RenomearFornecedor nome={f.nome} apelido={f.apelido} aoSalvar={aoMudar} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
        <div className="rounded-xl bg-rose-claro/50 p-2">
          <dt className="rotulo">Pedidos</dt>
          <dd className="font-titulo text-xl font-semibold text-rose-escuro">{f.pedidos}</dd>
          <dd className="text-xs text-[#9a8089]">{f.ultimo ? `último ${dataBr(f.ultimo)}` : "—"}</dd>
        </div>
        <div className="rounded-xl bg-rose-claro/50 p-2">
          <dt className="rotulo">Total pago</dt>
          <dd className="font-titulo text-xl font-semibold text-rose-escuro">{brl(f.totalPagoBrl)}</dd>
          <dd className="text-xs text-[#9a8089]">{f.pedidosPagos === f.pedidos ? "todos os pedidos" : `${f.pedidosPagos} de ${f.pedidos} pedido(s) com o pagamento informado`}</dd>
        </div>
        <div className="rounded-xl bg-rose-claro/50 p-2">
          <dt className="rotulo">Créditos em aberto</dt>
          <dd className="font-titulo text-xl font-semibold text-rose-escuro">{totalTexto(f.creditos.abertos)}</dd>
          <dd className="text-xs text-[#9a8089]">{pecasTexto(f.creditos.abertos) ? `${pecasTexto(f.creditos.abertos)} peça(s) a abater` : "nada a abater"}</dd>
        </div>
        <div className="rounded-xl bg-rose-claro/50 p-2">
          <dt className="rotulo">Créditos abatidos</dt>
          <dd className="font-titulo text-xl font-semibold text-rose-escuro">{totalTexto(f.creditos.abatidos)}</dd>
          <dd className="text-xs text-[#9a8089]">{f.creditos.cancelados ? `${f.creditos.cancelados} cancelado(s)` : "—"}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="rotulo whitespace-nowrap">Lote mínimo</span>
          <CampoNumero valor={f.loteMinimo} inteiro casas={0} placeholder={`padrão: ${padrao}`} rotulo="Lote mínimo em peças" disabled={ocupado === "lote"} aoSalvar={salvarLote} className="w-28" />
        </label>
        <span className="text-xs text-[#9a8089]">
          Múltiplo de peças por modelo que o fornecedor aceita na recompra. Vazio = padrão da loja ({padrao}). Valendo: <b>{f.loteMinimoEfetivo}</b>.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Botao variante="secundario" onClick={() => setVerPedidos((v) => !v)}>
          {verPedidos ? "Esconder os pedidos" : `Ver os pedidos (${f.listaPedidos.length})`}
        </Botao>
        <Botao variante="secundario" onClick={abrirCreditos}>
          {verCreditos ? "Esconder os créditos" : "Ver os créditos"}
        </Botao>
      </div>

      {verPedidos && (
        <ul className="mt-3 flex flex-col divide-y divide-borda rounded-xl border border-borda text-sm">
          {f.listaPedidos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <Link href={`/pedidos/${p.id}`} className="font-medium text-rose-escuro underline-offset-2 hover:underline">
                {p.numero ?? "sem número"}
              </Link>
              <span className="text-xs text-[#6b5560]">
                {dataBr(p.dataCompra) || "—"} · {p.recebimento ? nomeSituacao(p.recebimento) : "recebimento não informado"}
                {p.dataChegada ? ` (${dataBr(p.dataChegada)})` : ""}
              </span>
              <span className="whitespace-nowrap">{p.valorPagoBrl ? `pago ${brl(p.valorPagoBrl)}` : <span className="text-[#9a8089]">pagamento não informado</span>}</span>
            </li>
          ))}
        </ul>
      )}

      {verCreditos && (
        <div className="mt-3">
          {!creditos ? (
            <Carregando />
          ) : creditos.length === 0 ? (
            <p className="text-sm text-[#8a6d78]">Nenhum crédito com este fornecedor.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {creditos.map((c) => (
                <li key={c.id} className={`flex flex-col gap-2 rounded-xl border border-borda p-3 sm:flex-row sm:items-center sm:justify-between ${c.status === "cancelado" ? "bg-stone-50 text-[#9a8089]" : ""}`}>
                  <div className="min-w-0">
                    <div className="text-sm">{c.descricao}</div>
                    <div className="text-xs text-[#9a8089]">
                      pedido {c.pedidoNumero ?? "—"} · {c.quantidade} peça(s) · {dataBr(c.criadoEm)}
                      {c.abatidoPedidoNumero ? ` · abatido no pedido ${c.abatidoPedidoNumero}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="whitespace-nowrap font-titulo text-lg text-rose-escuro">{valorMoeda(c.valorMoeda, c.moeda)}</b>
                    <Selo cor={c.status === "aberto" ? "amarelo" : c.status === "abatido" ? "verde" : "cinza"}>{NOME_STATUS_CREDITO[c.status as StatusCredito] ?? c.status}</Selo>
                    {c.status === "aberto" && (
                      <Botao variante="fantasma" disabled={!!ocupado} carregando={ocupado === c.id} onClick={() => alterar(c, "cancelar", "Crédito cancelado.", "Cancelar este crédito? Use quando o fornecedor não vai pagar nem repor.")}>
                        Cancelar
                      </Botao>
                    )}
                    {c.status === "abatido" && (
                      <Botao variante="fantasma" disabled={!!ocupado} carregando={ocupado === c.id} onClick={() => alterar(c, "reabrir", "Abatimento desfeito.", "Desfazer o abatimento? O crédito volta a ficar em aberto e a cotação efetiva daquele pedido é recalculada.")}>
                        Desfazer abatimento
                      </Botao>
                    )}
                    {c.status === "cancelado" && c.quantidade > 0 && (
                      <Botao variante="fantasma" disabled={!!ocupado} carregando={ocupado === c.id} onClick={() => alterar(c, "reabrir", "Crédito reaberto.")}>
                        Reabrir
                      </Botao>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Cartao>
  );
}
