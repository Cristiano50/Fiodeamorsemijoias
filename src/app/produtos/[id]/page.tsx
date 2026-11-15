"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Pedido, Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, img, moedaSimbolo, num } from "@/lib/cliente";
import { BotaoFotoIa } from "@/components/BotaoFotoIa";
import { CodigoBarrasCelula } from "@/components/CodigoBarrasCelula";

type ImagemInfo = { id: string; origem: string; largura: number; altura: number; meta: Record<string, unknown> | null; criadoEm: string };
const ORIGEM: Record<string, string> = { catalogo: "Catálogo", pagina: "Página", arte: "Arte da marca", ia: "Foto IA", upload: "Enviada" };

export default function ProdutoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [p, setP] = useState<Produto | null>(null);
  const [imagens, setImagens] = useState<ImagemInfo[]>([]);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [ocupado, setOcupado] = useState("");

  const carregar = useCallback(
    () =>
      api<{ produto: Produto; imagens: ImagemInfo[]; pedido: Pedido | null }>(`/api/produtos/${id}`).then((r) => {
        setP(r.produto);
        setImagens(r.imagens);
        setPedido(r.pedido);
      }),
    [id],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  async function salvar(campos: Record<string, unknown>, msg?: string) {
    try {
      const r = await api<{ produto: Produto }>(`/api/produtos/${id}`, { method: "PATCH", json: campos });
      setP(r.produto);
      if (msg) avisar(msg);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }
  async function executar(rotulo: string, fn: () => Promise<unknown>, msg: string) {
    setOcupado(rotulo);
    try {
      await fn();
      avisar(msg);
      await carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  if (!p) return <Carregando />;
  const tipo = tax?.tipos.find((t) => t.id === p.tipo);
  const txt = (k: keyof Produto, upper = false) => ({
    defaultValue: (p[k] as string) ?? "",
    key: `${String(k)}-${p[k]}`,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = upper ? e.target.value.toUpperCase() : e.target.value;
      if (v !== (p[k] ?? "")) salvar({ [k]: v || null });
    },
  });
  const sel = (k: keyof Produto) => ({ value: (p[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLSelectElement>) => salvar({ [k]: e.target.value || null }) });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {pedido ? (
            <Link href={`/pedidos/${pedido.id}`} className="text-xs text-[#9a8089]">
              ← Pedido {pedido.numero} (linha {p.linha})
            </Link>
          ) : (
            <Link href="/produtos" className="text-xs text-[#9a8089]">
              ← Produtos
            </Link>
          )}
          <h1 className="text-3xl font-semibold uppercase">{p.nome ?? "Produto sem nome"}</h1>
          {p.nomeComercial && <p className="font-script text-2xl text-rose-escuro">{p.nomeComercial}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <BotaoFotoIa produtoId={id} aoTerminar={() => carregar()} />
          </div>
          <Link href={`/produtos/${id}/estudio`}>
            <Botao variante="secundario">Estúdio de fotos</Botao>
          </Link>
          <Link href={`/etiquetas?ids=${id}`}>
            <Botao variante="secundario">Etiqueta</Botao>
          </Link>
          <Botao variante={p.status === "aprovado" ? "secundario" : "primario"} onClick={() => salvar({ status: p.status === "aprovado" ? "revisado" : "aprovado" }, p.status === "aprovado" ? "Voltou para revisão." : "Produto aprovado.")}>
            {p.status === "aprovado" ? "✓ Aprovado" : "Aprovar"}
          </Botao>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex flex-col gap-4">
          <Cartao>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.imagemId ? <img src={img(p.imagemId)!} alt="" className="aspect-square w-full rounded-xl object-cover" /> : <div className="aspect-square w-full rounded-xl bg-rose-claro" />}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {imagens.map((im) => (
                <button key={im.id} onClick={() => salvar({ imagemId: im.id }, "Foto principal alterada.")} title={`${ORIGEM[im.origem] ?? im.origem} — clique para usar como principal`} className={`relative overflow-hidden rounded-lg border-2 ${im.id === p.imagemId ? "border-rose-escuro" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img(im.id, 160)!} alt="" loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-white/80 text-[0.55rem] uppercase tracking-wide">{ORIGEM[im.origem] ?? im.origem}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 block cursor-pointer text-center text-sm text-rose-escuro underline">
              Enviar outra foto
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.set("arquivo", f);
                  form.set("origem", "upload");
                  executar("foto", () => api(`/api/produtos/${id}/arte`, { method: "POST", body: form }), "Foto enviada.");
                }}
              />
            </label>
          </Cartao>

          <Cartao titulo="Código de barras">
            {p.codigoBarras ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/codigo-barras?c=${p.codigoBarras}&altura=14`} alt={p.codigoBarras} loading="lazy" decoding="async" className="mx-auto h-24 max-w-full object-contain" />
            ) : (
              <p className="text-sm text-[#8a6d78]">Ainda sem o código do UP. Cadastre a peça no UP e bipe ou digite aqui o código que o UP criou.</p>
            )}
            <div className="mt-2 text-center">
              <CodigoBarrasCelula codigo={p.codigoBarras} origem={p.codigoBarrasOrigem} />
              {p.recompraDe && <div className="mt-1 text-xs text-[#9a8089]">Recompra: usa o mesmo código da peça original.</div>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Campo rotulo="Referência">
                <input {...txt("referencia", true)} className="font-mono" />
              </Campo>
              <Campo rotulo="Código de barras (do UP)">
                <input {...txt("codigoBarras")} className="font-mono" />
              </Campo>
            </div>
            <div className="mt-3 flex gap-2">
              <Botao variante="secundario" onClick={() => executar("cod", () => api("/api/produtos/lote", { method: "POST", json: { ids: [id], acao: "codigos" } }), "Códigos gerados.")}>
                Gerar o que falta
              </Botao>
            </div>
          </Cartao>
        </div>

        <div className="flex flex-col gap-4">
          {p.avaliacao && (
            <div className="rounded-2xl border border-borda bg-creme px-4 py-3 text-sm">
              <span className="rotulo">Avaliação da peça (IA)</span>
              <p className="mt-1">{p.avaliacao}</p>
              {(p.alertas ?? []).length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-amber-800">
                  {p.alertas!.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Cartao titulo="Cadastro">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Campo rotulo="Nome de cadastro (UP Vendas)" className="md:col-span-3" dica={`${(p.nome ?? "").length}/60 caracteres`}>
                <input {...txt("nome", true)} className="font-medium" />
              </Campo>
              <Campo rotulo="Nome comercial (Instagram)">
                <input {...txt("nomeComercial")} />
              </Campo>
              {(p.nomesSugeridos ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 md:col-span-4">
                  <span className="rotulo self-center">Sugestões:</span>
                  {p.nomesSugeridos!.map((n) => (
                    <button key={n} onClick={() => salvar({ nome: n }, "Nome aplicado.")} className={`rounded-full border px-3 py-1 text-xs ${n === p.nome ? "border-rose-escuro bg-rose-claro" : "border-borda hover:bg-rose-claro"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
              <Campo rotulo="Tipo">
                <select {...sel("tipo")}>
                  <option value="">—</option>
                  {tax?.tipos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({t.prefixo})
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Subtipo (categoria vitrine)">
                <input {...txt("subtipo")} list="subtipos" />
                <datalist id="subtipos">{tipo?.subtipos.map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              <Campo rotulo="Material">
                <select {...sel("material")}>
                  <option value="">—</option>
                  {tax?.materiais.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({t.sigla})
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Banho">
                <select {...sel("banho")}>
                  <option value="">—</option>
                  {tax?.banhos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Tamanho">
                <input {...txt("tamanho")} list="tamanhos" />
                <datalist id="tamanhos">{tipo?.tamanhos.map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              <Campo rotulo="Variação (cor/banho)">
                <input {...txt("variacao")} />
              </Campo>
              <Campo rotulo="Grupo de variações" dica="Mesmo grupo = mesma referência">
                <input {...txt("grupo", true)} />
              </Campo>
              <Campo rotulo="Código do fornecedor">
                <input {...txt("codigoFornecedor", true)} className="font-mono" />
              </Campo>
              <div className="md:col-span-4">
                <span className="rotulo">Cor da pedra</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {tax?.cores_pedra.map((c) => {
                    const ativo = (p.corPedra ?? []).includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => salvar({ corPedra: ativo ? (p.corPedra ?? []).filter((x) => x !== c.id) : [...(p.corPedra ?? []), c.id] })}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${ativo ? "border-rose-escuro bg-rose-claro font-medium" : "border-borda text-[#8a6d78]"}`}
                      >
                        {c.hex && <span className="inline-block h-3 w-3 rounded-full border border-black/10" style={{ background: c.hex }} />}
                        {c.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Campo rotulo="Descrição original" className="md:col-span-2">
                <input {...txt("descricaoOriginal")} />
              </Campo>
              <Campo rotulo="Tradução" className="md:col-span-2">
                <input {...txt("traducao")} />
              </Campo>
              <Campo rotulo="Quantidade (estoque)">
                <input type="number" defaultValue={p.quantidade} key={`q${p.quantidade}`} onBlur={(e) => Number(e.target.value) !== p.quantidade && salvar({ quantidade: Number(e.target.value) })} />
              </Campo>
              <Campo rotulo="NCM">
                <input {...txt("ncm")} className="font-mono" />
              </Campo>
              <Campo rotulo="Unidade">
                <input {...txt("unidade", true)} />
              </Campo>
              <Campo rotulo="Conjunto?">
                <select value={p.ehConjunto ? "1" : "0"} onChange={(e) => salvar({ ehConjunto: e.target.value === "1" })}>
                  <option value="0">Não</option>
                  <option value="1">Sim — {(p.componentes ?? []).join(", ")}</option>
                </select>
              </Campo>
            </div>
          </Cartao>

          <Cartao titulo="Custo e preço">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Campo rotulo={`Preço na origem (${moedaSimbolo(p.moeda)})`} dica={pedido ? `cotação ${num(pedido.cotacao, 4)}` : undefined}>
                <input type="number" step="0.01" defaultValue={p.precoOrigem ?? ""} key={`po${p.precoOrigem}`} onBlur={(e) => Number(e.target.value) !== p.precoOrigem && salvar({ precoOrigem: Number(e.target.value) })} disabled={!pedido} />
              </Campo>
              <div>
                <span className="rotulo">Custo compra bruto</span>
                <div className="mt-2">{brl(p.custoProdutoBrl)}</div>
              </div>
              <div>
                <span className="rotulo">Frete rateado e custos</span>
                <div className="mt-2">{brl(p.custoAdicionalBrl)}</div>
              </div>
              <div>
                <span className="rotulo">Custo total</span>
                <div className="mt-2 font-semibold">{brl(p.custoTotalBrl)}</div>
              </div>
              <Campo rotulo="Fator multiplicador da peça" dica={p.fator ? "definido para esta peça" : `em branco = fator do pedido (× ${num(p.fatorAplicado ?? 0)})`}>
                <input inputMode="decimal" placeholder={`× ${num(p.fatorAplicado ?? 0)}`} defaultValue={p.fator ?? ""} key={`f${p.fator}`} onBlur={(e) => { const v = e.target.value.trim().replace(",", "."); const novo = v ? Number(v) : null; if (novo !== p.fator) salvar({ fator: novo }); }} />
              </Campo>
              <Campo rotulo="Preço de venda (CONSIGNADO)" dica="Digite para fixar um preço manual">
                <input type="number" step="0.01" defaultValue={p.precoVenda ?? ""} key={`pv${p.precoVenda}`} onBlur={(e) => Number(e.target.value) !== p.precoVenda && salvar({ precoVenda: Number(e.target.value) }, "Preço atualizado.")} className="font-titulo text-xl font-semibold text-rose-escuro" />
              </Campo>
              <div className="col-span-2 flex flex-wrap gap-2 self-end">
                {config?.precificacao.tabelas_preco.map((t) => (
                  <Selo key={t.id} cor={t.id === config.precificacao.tabela_base ? "rose" : "cinza"}>
                    {t.nome}: {brl(p.precos?.[t.id])}
                  </Selo>
                ))}
                {p.custoTotalBrl ? <Selo cor="dourado">% lucro UP: {num(((p.precoVenda ?? 0) / p.custoTotalBrl - 1) * 100)}</Selo> : null}
              </div>
            </div>
          </Cartao>

          <Cartao
            titulo="Marketing"
            acoes={
              <Botao variante="secundario" carregando={ocupado === "textos"} onClick={() => executar("textos", () => api(`/api/produtos/${id}/textos`, { method: "POST" }), "Legenda e hashtags geradas.")}>
                ✦ Gerar com IA
              </Botao>
            }
          >
            <Campo rotulo="Legenda para Instagram">
              <textarea rows={4} {...txt("legenda")} />
            </Campo>
            <Campo rotulo="Hashtags" className="mt-3">
              <input
                defaultValue={(p.hashtags ?? []).join(" ")}
                key={(p.hashtags ?? []).join(" ")}
                onBlur={(e) => salvar({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
              />
            </Campo>
            <p className="mt-2 text-xs text-[#9a8089]">
              Estilo: {p.estilo ?? "—"} · Tipo {nomeDe(tax?.tipos, p.tipo)} {p.destaque ? "· ★ peça destaque" : ""}
            </p>
          </Cartao>

          <Cartao titulo="UP Vendas">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Selo cor={p.upStatus === "enviado" ? "verde" : p.upStatus === "erro" ? "vermelho" : "cinza"}>{p.upStatus ?? "não enviado"}</Selo>
              {p.upMensagem && <span className="min-w-0 break-words text-[#6b5560] [overflow-wrap:anywhere]">{p.upMensagem}</span>}
              <Link href={`/up-vendas?ids=${id}`} className="text-rose-escuro underline">
                Enviar / simular
              </Link>
            </div>
          </Cartao>

          <div className="flex justify-end">
            <Botao
              variante="perigo"
              onClick={async () => {
                if (!confirm("Excluir este produto?")) return;
                await api(`/api/produtos/${id}`, { method: "DELETE" });
                router.push(pedido ? `/pedidos/${pedido.id}` : "/produtos");
              }}
            >
              Excluir produto
            </Botao>
          </div>
        </div>
      </div>
    </div>
  );
}
