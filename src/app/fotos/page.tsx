"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api, img } from "@/lib/cliente";

type Foto = {
  id: string;
  criadoEm: string;
  produtoId: string;
  nome: string | null;
  nomeComercial: string | null;
  referencia: string | null;
  fotoReal: string | null;
  pedidoId: string | null;
  linha: number | null;
  meta: {
    aprovada?: boolean | null;
    avaliacao?: { nota?: number; problemas?: string[]; pontos_fortes?: string[]; eliminatorios?: string[] } | null;
    tentativas?: unknown[];
    modelo?: string;
    cenario?: string;
    decisao?: "aprovada" | "recusada";
    decididoPor?: string;
    decididoEm?: string;
  } | null;
};

const ABAS = [
  ["pendente", "Para aprovar"],
  ["aprovada", "Aprovadas"],
  ["recusada", "Recusadas"],
] as const;

function FilaFotos() {
  const params = useSearchParams();
  const pedido = params.get("pedido");
  const avisar = useAviso();
  const [status, setStatus] = useState<(typeof ABAS)[number][0]>("pendente");
  const [lista, setLista] = useState<Foto[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [refazendo, setRefazendo] = useState<Set<string>>(new Set());

  const carregar = useCallback(
    () => api<Foto[]>(`/api/fotos?status=${status}${pedido ? `&pedido=${pedido}` : ""}`).then(setLista),
    [status, pedido],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  async function decidir(ids: string[], decisao: "aprovada" | "recusada" | null) {
    if (!ids.length) return;
    try {
      await api("/api/fotos", { method: "PATCH", json: { ids, decisao } });
      avisar(decisao === "aprovada" ? `${ids.length} foto(s) aprovada(s).` : decisao === "recusada" ? `${ids.length} foto(s) recusada(s).` : "Voltou para a fila.");
      setSel(new Set());
      carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  async function refazer(f: Foto) {
    setRefazendo((s) => new Set(s).add(f.id));
    try {
      await api("/api/fotos", { method: "PATCH", json: { ids: [f.id], decisao: "recusada" } });
      const extra = f.meta?.avaliacao?.problemas?.length ? `Fix these problems from the previous photo: ${f.meta.avaliacao.problemas.join("; ")}` : undefined;
      await api(`/api/produtos/${f.produtoId}/ia`, { method: "POST", json: { cenarioId: f.meta?.cenario, extra } });
      avisar("Nova foto criada e avaliada pelo marketing.");
      carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setRefazendo((s) => {
        const n = new Set(s);
        n.delete(f.id);
        return n;
      });
    }
  }

  const boas = (lista ?? []).filter((f) => (f.meta?.avaliacao?.nota ?? 0) >= 9 && f.meta?.aprovada).map((f) => f.id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Fotos para aprovar</h1>
          <p className="max-w-3xl text-sm text-[#8a6d78]">
            Compare a foto criada pela IA com a peça real. Só as fotos <b>aprovadas aqui</b> vão para o catálogo do WhatsApp/Instagram e para o UP. A nota é do
            especialista de marketing (IA); a decisão final é da loja.
            {pedido && (
              <>
                {" "}
                Mostrando um pedido · <Link href="/fotos" className="text-rose-escuro underline">ver todos</Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map(([k, r]) => (
          <button key={k} onClick={() => setStatus(k)} className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
            {r}
          </button>
        ))}
        {status === "pendente" && boas.length > 0 && (
          <Botao variante="secundario" onClick={() => decidir(boas, "aprovada")}>
            Aprovar as {boas.length} com nota ≥ 9
          </Botao>
        )}
        {sel.size > 0 && (
          <>
            <Botao onClick={() => decidir([...sel], "aprovada")}>Aprovar {sel.size} selecionada(s)</Botao>
            <Botao variante="perigo" onClick={() => decidir([...sel], "recusada")}>
              Recusar {sel.size}
            </Botao>
          </>
        )}
      </div>

      {!lista ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[#8a6d78]">
            {status === "pendente" ? "Nenhuma foto esperando aprovação. Crie fotos com o botão “✦ Criar foto com IA” no catálogo ou no pedido." : "Nada aqui."}
          </p>
        </Cartao>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((f) => {
            const av = f.meta?.avaliacao;
            return (
              <div key={f.id} className={`overflow-hidden rounded-2xl border bg-white ${sel.has(f.id) ? "border-rose-escuro ring-2 ring-rose" : "border-borda"}`}>
                <div className="relative grid grid-cols-[1fr_2fr] gap-1 bg-[#f3ece6] p-1">
                  <div className="flex flex-col gap-1">
                    <span className="rotulo px-1">peça real</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.fotoReal && <img src={img(f.fotoReal, 300)!} alt="" className="aspect-square w-full rounded-lg object-cover" />}
                  </div>
                  <a href={img(f.id)!} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img(f.id, 700)!} alt="" className="aspect-[4/5] w-full rounded-lg object-cover" />
                  </a>
                  <input
                    type="checkbox"
                    className="absolute left-2 top-2 h-5 w-5"
                    checked={sel.has(f.id)}
                    onChange={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      })
                    }
                  />
                </div>
                <div className="p-3 text-sm">
                  <Link href={`/produtos/${f.produtoId}`} className="font-medium uppercase hover:underline">
                    {f.nome ?? "Produto"}
                  </Link>
                  <div className="text-xs text-[#9a8089]">
                    {f.referencia} · {new Date(f.criadoEm).toLocaleString("pt-BR")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.meta?.aprovada ? (
                      <Selo cor="verde">marketing ✓ {av?.nota?.toFixed(1)}</Selo>
                    ) : f.meta?.aprovada === false ? (
                      <Selo cor="amarelo">marketing ✗ {av?.nota?.toFixed(1)}</Selo>
                    ) : (
                      <Selo cor="cinza">sem avaliação</Selo>
                    )}
                    {f.meta?.decisao && (
                      <Selo cor={f.meta.decisao === "aprovada" ? "verde" : "vermelho"}>
                        {f.meta.decisao} por {f.meta.decididoPor}
                      </Selo>
                    )}
                  </div>
                  {(av?.eliminatorios ?? []).length > 0 && <p className="mt-2 text-xs text-red-700">⚠ {av!.eliminatorios!.join("; ")}</p>}
                  {(av?.problemas ?? []).length > 0 && <p className="mt-1 text-xs text-[#6b5560]">Ajustar: {av!.problemas!.slice(0, 3).join("; ")}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {f.meta?.decisao !== "aprovada" && <Botao onClick={() => decidir([f.id], "aprovada")}>✓ Aprovar</Botao>}
                    <Botao variante="secundario" carregando={refazendo.has(f.id)} onClick={() => refazer(f)}>
                      ↻ Refazer
                    </Botao>
                    {f.meta?.decisao !== "recusada" ? (
                      <Botao variante="perigo" onClick={() => decidir([f.id], "recusada")}>
                        ✗ Recusar
                      </Botao>
                    ) : (
                      <Botao variante="fantasma" onClick={() => decidir([f.id], null)}>
                        Voltar para a fila
                      </Botao>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function FotosPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <FilaFotos />
    </Suspense>
  );
}
