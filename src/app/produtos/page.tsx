"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Modal, Selo, useAviso } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, img } from "@/lib/cliente";
import { BotaoFotoIa } from "@/components/BotaoFotoIa";

type ProdutoCatalogo = Produto & { fotoIa: { id: string; aprovada: boolean | null; nota: number | null } | null };

/** Produtos por vez (múltiplo de 2, 3, 4 e 6 colunas: as linhas da grade ficam completas). */
const PAGINA = 60;

/**
 * GET da lista com o total do filtro (cabeçalho X-Total-Count, que a api() de lib/cliente não devolve).
 * Mesmo tratamento da api(): sessão expirada leva ao login; erro vem com a mensagem do servidor.
 */
async function buscarPagina(url: string): Promise<{ itens: ProdutoCatalogo[]; total: number }> {
  const res = await fetch(url);
  if (res.status === 401 && !window.location.pathname.startsWith("/entrar")) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- igual à api(): recarrega a página inteira no login
    window.location.href = `/entrar?voltar=${encodeURIComponent(window.location.pathname)}`;
  }
  const dados = (await res.json().catch(() => null)) as ProdutoCatalogo[] | { erro?: string } | null;
  if (!res.ok || !Array.isArray(dados)) throw new Error((dados as { erro?: string } | null)?.erro ?? `Erro ${res.status}`);
  const total = Number(res.headers.get("X-Total-Count"));
  return { itens: dados, total: Number.isFinite(total) && total >= dados.length ? total : dados.length };
}

function ProdutosConteudo() {
  const params = useSearchParams();
  const avisar = useAviso();
  const { config } = useConfig();
  const tax = config?.taxonomia;
  const [lista, setLista] = useState<ProdutoCatalogo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [filtros, setFiltros] = useState({ q: "", tipo: "", material: "", cor: "", status: "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [novo, setNovo] = useState(params.get("novo") === "1");
  const ultimaBusca = useRef(0); // resposta atrasada de um filtro antigo não sobrescreve a do filtro atual

  const urlPagina = useCallback(
    (offset: number, limite: number) => {
      const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
      qs.set("limite", String(limite));
      qs.set("offset", String(offset));
      return `/api/produtos?${qs}`;
    },
    [filtros],
  );

  /** Busca de novo do começo, com os filtros atuais; `quantos` mantém na tela o que já tinha sido carregado. */
  const carregar = useCallback(
    async (quantos = PAGINA) => {
      const n = ++ultimaBusca.current;
      const r = await buscarPagina(urlPagina(0, Math.min(5000, Math.max(PAGINA, quantos))));
      if (n !== ultimaBusca.current) return;
      setLista(r.itens);
      setTotal(r.total);
    },
    [urlPagina],
  );
  useEffect(() => {
    const t = setTimeout(() => carregar().catch((e) => avisar(e.message, "erro")), 250);
    return () => clearTimeout(t);
  }, [carregar, avisar]);

  /** "Carregar mais": a próxima página (offset = quantos já estão na tela), mantendo filtros e busca. */
  async function carregarMais() {
    if (!lista) return;
    const n = ++ultimaBusca.current;
    setCarregandoMais(true);
    try {
      const r = await buscarPagina(urlPagina(lista.length, PAGINA));
      if (n !== ultimaBusca.current) return;
      setLista((atual) => {
        const vistos = new Set((atual ?? []).map((p) => p.id));
        return [...(atual ?? []), ...r.itens.filter((p) => !vistos.has(p.id))];
      });
      setTotal(r.total);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setCarregandoMais(false);
    }
  }
  const recarregar = () => carregar(lista?.length).catch((e) => avisar(e instanceof Error ? e.message : String(e), "erro"));

  const lote = async (acao: string, msg: string) => {
    try {
      await api("/api/produtos/lote", { method: "POST", json: { ids: [...sel], acao } });
      avisar(msg);
      if (acao === "excluir") setSel(new Set());
      recarregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  };
  const ids = [...sel].join(",");
  const f = (k: keyof typeof filtros) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFiltros((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-semibold">Produtos</h1>
        <div className="flex flex-wrap gap-2">
          <a href="/api/exportar?formato=xlsx">
            <Botao variante="secundario">Exportar planilha UP</Botao>
          </a>
          <Botao onClick={() => setNovo(true)}>+ Produto avulso</Botao>
        </div>
      </div>

      <Cartao>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Campo rotulo="Buscar" className="col-span-2">
            <input placeholder="nome, referência, EAN, código do fornecedor" value={filtros.q} onChange={f("q")} />
          </Campo>
          <Campo rotulo="Tipo">
            <select value={filtros.tipo} onChange={f("tipo")}>
              <option value="">Todos</option>
              {tax?.tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Material">
            <select value={filtros.material} onChange={f("material")}>
              <option value="">Todos</option>
              {tax?.materiais.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Cor da pedra">
            <select value={filtros.cor} onChange={f("cor")}>
              <option value="">Todas</option>
              {tax?.cores_pedra.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Status">
            <select value={filtros.status} onChange={f("status")}>
              <option value="">Todos</option>
              <option value="rascunho">Rascunho</option>
              <option value="revisado">Revisado pela IA</option>
              <option value="aprovado">Aprovado</option>
            </select>
          </Campo>
        </div>
      </Cartao>

      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-rose-claro p-2 text-sm shadow">
          <b className="px-2">{sel.size} selecionado(s)</b>
          <Botao variante="secundario" onClick={() => lote("aprovar", "Aprovados.")}>
            Aprovar
          </Botao>
          <Botao variante="secundario" onClick={() => lote("codigos", "Códigos gerados.")}>
            Gerar códigos
          </Botao>
          <Link href={`/etiquetas?ids=${ids}`}>
            <Botao variante="secundario">Etiquetas</Botao>
          </Link>
          <a href={`/api/exportar?formato=xlsx&ids=${ids}`}>
            <Botao variante="secundario">Planilha</Botao>
          </a>
          <Link href={`/up-vendas?ids=${ids}`}>
            <Botao variante="secundario">Enviar ao UP</Botao>
          </Link>
          <Botao variante="perigo" onClick={() => confirm(`Excluir ${sel.size} produto(s)?`) && lote("excluir", "Excluídos.")}>
            Excluir
          </Botao>
          <Botao variante="fantasma" onClick={() => setSel(new Set())}>
            Limpar seleção
          </Botao>
        </div>
      )}

      {!lista ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[#8a6d78]">Nenhum produto encontrado.</p>
        </Cartao>
      ) : (
        <>
          <p className="-mb-2 text-sm text-[#8a6d78]">
            {total === 1 ? "1 produto" : `${total.toLocaleString("pt-BR")} produtos`}
            {Object.values(filtros).some(Boolean) ? " com estes filtros" : ""}
            {lista.length < total ? ` · mostrando ${lista.length.toLocaleString("pt-BR")}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {lista.map((p) => (
              <div key={p.id} className={`group relative overflow-hidden rounded-2xl border bg-white transition ${sel.has(p.id) ? "border-rose-escuro ring-2 ring-rose" : "border-borda"}`}>
                <input
                  type="checkbox"
                  className="absolute left-2 top-2 z-10 h-4 w-4"
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
                <Link href={`/produtos/${p.id}`} className="relative block">
                  {/* Foto criada pela IA à frente; a do fornecedor só aparece se ainda não houver. */}
                  {p.fotoIa || p.imagemId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img(p.fotoIa?.id ?? p.imagemId, 400)!} alt="" loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="aspect-square w-full bg-rose-claro" />
                  )}
                  {p.fotoIa && (
                    <span className={`absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold text-white ${p.fotoIa.aprovada ? "bg-emerald-600" : p.fotoIa.aprovada === false ? "bg-amber-600" : "bg-stone-500"}`}>
                      {p.fotoIa.aprovada ? "✓ aprovada" : p.fotoIa.aprovada === false ? "não aprovada" : "IA"} {p.fotoIa.nota != null ? p.fotoIa.nota.toFixed(1) : ""}
                    </span>
                  )}
                  <div className="p-3">
                    <div className="line-clamp-2 text-xs font-medium uppercase leading-snug">{p.nome ?? p.traducao ?? "Sem nome"}</div>
                    {p.nomeComercial && <div className="truncate font-script text-base text-rose-escuro">{p.nomeComercial}</div>}
                    <div className="mt-1 flex flex-wrap items-end justify-between gap-x-2">
                      <span className="whitespace-nowrap font-titulo text-xl font-semibold text-rose-escuro">{brl(p.precoVenda)}</span>
                      <span className="min-w-0 truncate font-mono text-[0.65rem] text-[#9a8089]">{p.referencia}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Selo cor="cinza">{nomeDe(tax?.tipos, p.tipo)}</Selo>
                      {p.status === "aprovado" && <Selo cor="verde">aprovado</Selo>}
                      {p.upStatus === "enviado" && <Selo cor="verde">UP</Selo>}
                      {p.upStatus === "erro" && <Selo cor="vermelho">UP erro</Selo>}
                      {p.destaque && <Selo cor="dourado">★</Selo>}
                    </div>
                  </div>
                </Link>
                <div className="px-3 pb-3">
                  <BotaoFotoIa produtoId={p.id} aoTerminar={() => recarregar()} />
                </div>
              </div>
            ))}
          </div>
          {lista.length < total && (
            <div className="flex flex-col items-center gap-1">
              <Botao variante="secundario" carregando={carregandoMais} onClick={carregarMais}>
                Carregar mais {Math.min(PAGINA, total - lista.length)}
              </Botao>
              <span className="text-xs text-[#9a8089]">
                {lista.length.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}
              </span>
            </div>
          )}
        </>
      )}

      <NovoProduto aberto={novo} aoFechar={() => setNovo(false)} aoCriar={() => recarregar()} />
    </div>
  );
}

export default function ProdutosPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <ProdutosConteudo />
    </Suspense>
  );
}

function NovoProduto({ aberto, aoFechar, aoCriar }: { aberto: boolean; aoFechar: () => void; aoCriar: () => void }) {
  const { config } = useConfig();
  const avisar = useAviso();
  const tax = config?.taxonomia;
  const [dados, setDados] = useState({ nome: "", tipo: "brinco", material: "semijoia", banho: "ouro_18k", tamanho: "Único", codigoFornecedor: "", quantidade: 1, custoTotalBrl: 0, precoVenda: "" });
  const [foto, setFoto] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDados((d) => ({ ...d, [k]: e.target.value }));
  async function salvar() {
    setSalvando(true);
    try {
      const form = new FormData();
      form.set("dados", JSON.stringify({ ...dados, nome: dados.nome.toUpperCase(), quantidade: Number(dados.quantidade), custoTotalBrl: Number(dados.custoTotalBrl), precoVenda: dados.precoVenda ? Number(dados.precoVenda) : null }));
      if (foto) form.set("foto", foto);
      const r = await api<{ id: string }>("/api/produtos", { method: "POST", body: form });
      avisar("Produto criado com referência e código de barras.");
      aoCriar();
      aoFechar();
      window.location.href = `/produtos/${r.id}`;
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Novo produto avulso">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Nome de cadastro" className="col-span-2" dica="Padrão: TIPO (SIGLA) DESCRITORES — ex.: BRINCO (SJ) ARGOLA TORCIDA">
          <input value={dados.nome} onChange={set("nome")} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={dados.tipo} onChange={set("tipo")}>
            {tax?.tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Material">
          <select value={dados.material} onChange={set("material")}>
            {tax?.materiais.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Banho">
          <select value={dados.banho} onChange={set("banho")}>
            {tax?.banhos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Tamanho">
          <input value={dados.tamanho} onChange={set("tamanho")} list="tamanhos" />
          <datalist id="tamanhos">{tax?.tipos.find((t) => t.id === dados.tipo)?.tamanhos.map((t) => <option key={t} value={t} />)}</datalist>
        </Campo>
        <Campo rotulo="Código do fornecedor">
          <input value={dados.codigoFornecedor} onChange={set("codigoFornecedor")} />
        </Campo>
        <Campo rotulo="Quantidade">
          <input type="number" value={dados.quantidade} onChange={set("quantidade")} />
        </Campo>
        <Campo rotulo="Custo total da peça (R$)">
          <input type="number" step="0.01" value={dados.custoTotalBrl} onChange={set("custoTotalBrl")} />
        </Campo>
        <Campo rotulo="Preço de venda (opcional)" dica="Em branco = calculado pelo fator multiplicador">
          <input type="number" step="0.01" value={dados.precoVenda} onChange={set("precoVenda")} />
        </Campo>
        <Campo rotulo="Foto" className="col-span-2">
          <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </Campo>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Botao variante="fantasma" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao onClick={salvar} carregando={salvando} disabled={!dados.nome}>
          Criar produto
        </Botao>
      </div>
    </Modal>
  );
}
