"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao, Campo, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";
import { lerCabecalho, lerLinha } from "@/lib/extracao";
import { extrairPdf, prepararFoto, type Extracao } from "@/lib/pdf-cliente";
import { ImportarCadastroClaude } from "@/components/ImportarCadastroClaude";

type Cotacao = { valor: number; data: string; fonte: string };

export default function ImportarPage() {
  const router = useRouter();
  const avisar = useAviso();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [extracao, setExtracao] = useState<Extracao | null>(null);
  const [fotos, setFotos] = useState<{ blob: Blob; url: string; nome: string }[]>([]);
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [fornecedor, setFornecedor] = useState("");
  // Fornecedores já cadastrados: o nome original (o que a recompra usa) e o apelido da loja.
  const [fornecedores, setFornecedores] = useState<{ nome: string; apelido: string | null }[]>([]);
  useEffect(() => {
    api<{ nome: string; apelido: string | null }[]>("/api/fornecedores")
      .then(setFornecedores)
      .catch(() => {});
  }, []);
  const chaveForn = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const fornecedorConhecido = fornecedor.trim() ? fornecedores.find((f) => chaveForn(f.nome) === chaveForn(fornecedor)) : undefined;
  const [numero, setNumero] = useState("");
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().slice(0, 10));
  const [moeda, setMoeda] = useState("CNY");
  const [cotacao, setCotacao] = useState<number | "">("");
  const [cotacaoInfo, setCotacaoInfo] = useState<Cotacao | null>(null);
  const [cotacaoErro, setCotacaoErro] = useState("");
  // Só enviamos a cotação se a pessoa digitou; senão o servidor busca a PTAX oficial da data da compra.
  const [cotacaoManual, setCotacaoManual] = useState(false);
  const [analisarIa, setAnalisarIa] = useState(true);
  const [fator, setFator] = useState("");
  const [frete, setFrete] = useState("");
  const [fotosModelo, setFotosModelo] = useState(true);

  async function selecionar(lista: FileList | File[]) {
    const arr = Array.from(lista);
    if (!arr.length) return;
    setArquivos(arr);
    setExtracao(null);
    setFotos([]);
    setExcluidos(new Set());
    setLendo(true);
    try {
      const pdf = arr.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      if (pdf) {
        const ex = await extrairPdf(pdf, setStatus);
        setExtracao(ex);
        const cab = lerCabecalho(ex.cabecalho + "\n" + ex.textoCompleto.slice(0, 600));
        if (cab.data) {
          setDataCompra(cab.data);
          setCotacaoManual(false);
        }
        if (cab.numero) setNumero(cab.numero);
        if (cab.moeda) trocarMoeda(cab.moeda);
        const primeira = ex.cabecalho.split("\n").find((l) => l.trim().length > 3);
        if (primeira && !fornecedor) setFornecedor(primeira.replaceAll(" | ", " ").trim());
        setStatus(
          ex.itens.length
            ? `${ex.itens.length} itens encontrados${ex.paginas.length ? ` + ${ex.paginas.length} página(s) em foto` : ""}.`
            : ex.paginas.length
              ? `${ex.paginas.length} página(s) sem tabela: a IA vai localizar as peças.`
              : "Não encontrei itens neste PDF.",
        );
      }
      const imgs = arr.filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        const prontas = await Promise.all(imgs.map(async (f) => ({ blob: await prepararFoto(f), nome: f.name })));
        setFotos(prontas.map((p) => ({ ...p, url: URL.createObjectURL(p.blob) })));
        if (!pdf) setStatus(`${imgs.length} foto(s) — a IA vai localizar e recortar cada peça.`);
      }
    } catch (e) {
      avisar(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : e}`, "erro");
      setStatus("");
    } finally {
      setLendo(false);
    }
  }

  function trocarMoeda(m: string) {
    setMoeda(m);
    if (m === "BRL") {
      setCotacao(1);
      setCotacaoInfo({ valor: 1, data: dataCompra, fonte: "Real" });
      setCotacaoErro("");
    }
  }

  const cotacaoManualRef = useRef(false);
  useEffect(() => {
    cotacaoManualRef.current = cotacaoManual;
  }, [cotacaoManual]);

  // Cotação do dia da compra (PTAX) — prévia na tela; o servidor confirma ao criar o pedido.
  useEffect(() => {
    if (moeda === "BRL") return;
    let cancelado = false;
    api<{ cotacao: Cotacao | null; erros: string[] }>(`/api/cotacao?moeda=${moeda}&data=${dataCompra}`)
      .then((r) => {
        if (cancelado) return;
        if (r.cotacao && !cotacaoManualRef.current) {
          setCotacaoErro("");
          setCotacao(Number(r.cotacao.valor.toFixed(4)));
          setCotacaoInfo(r.cotacao);
        } else {
          setCotacaoInfo(null);
          setCotacaoErro("Não consegui buscar a cotação automaticamente. Digite a cotação do dia.");
        }
      })
      .catch(() => !cancelado && setCotacaoErro("Não consegui buscar a cotação automaticamente. Digite a cotação do dia."));
    return () => {
      cancelado = true;
    };
  }, [moeda, dataCompra]);

  const linhas = useMemo(
    () => (extracao?.itens ?? []).map((it, i) => ({ ...it, i, lida: lerLinha(it.texto) })),
    [extracao],
  );
  const ativas = linhas.filter((l) => !excluidos.has(l.i));
  const totalLido = ativas.reduce((s, l) => s + (l.lida.preco ?? 0) * (l.lida.quantidade ?? 0), 0);
  const pecasLidas = ativas.reduce((s, l) => s + (l.lida.quantidade ?? 0), 0);
  const confere = extracao?.totalDocumento != null && Math.abs(totalLido - extracao.totalDocumento) < 0.05;

  async function laco(url: string, rotulo: (r: { restantes: number }) => string) {
    for (let tentativa = 0; tentativa < 500; tentativa++) {
      const r = await api<{ restantes: number }>(url, { method: "POST", json: {} });
      setStatus(rotulo(r));
      if (!r.restantes) return;
    }
  }

  async function criarPedido() {
    if (!ativas.length && !fotos.length && !extracao?.paginas.length) return avisar("Nada para importar.", "erro");
    setEnviando(true);
    try {
      setStatus("Enviando itens e fotos…");
      const form = new FormData();
      form.set(
        "meta",
        JSON.stringify({
          numero,
          fornecedor,
          dataCompra,
          moeda,
          cotacao: cotacaoManual && cotacao ? cotacao : undefined,
          cotacaoSugerida: !cotacaoManual && cotacao && cotacaoInfo?.data ? { valor: cotacao, data: cotacaoInfo.data, fonte: cotacaoInfo.fonte } : undefined,
          fator: fator ? Number(fator.replace(",", ".")) : null,
          frete: frete ? Number(frete.replace(/\./g, "").replace(",", ".")) : null,
          cabecalho: extracao?.cabecalho,
          colunas: extracao?.colunas,
          totalDocumento: extracao?.totalDocumento ?? null,
          arquivoNome: arquivos.map((a) => a.name).join(", "),
        }),
      );
      const pdf = arquivos.find((a) => a.name.toLowerCase().endsWith(".pdf"));
      if (pdf && pdf.size < 3.5 * 1024 * 1024) form.set("arquivo", pdf);
      const r = await api<{ id: string; avisos: string[]; paginas: number }>("/api/pedidos", { method: "POST", body: form });

      // Fotos em lotes pequenos (cabem no limite de upload de qualquer servidor).
      const LOTE = 8;
      for (let i = 0; i < ativas.length; i += LOTE) {
        setStatus(`Enviando peças ${i + 1}–${Math.min(i + LOTE, ativas.length)} de ${ativas.length}…`);
        const f = new FormData();
        const lote = ativas.slice(i, i + LOTE);
        f.set("itens", JSON.stringify(lote.map((l, k) => ({ linha: i + k + 1, texto: l.texto, campo: `item_${k}` }))));
        lote.forEach((l, k) => f.set(`item_${k}`, l.imagem, `item_${k}.jpg`));
        await api(`/api/pedidos/${r.id}/itens`, { method: "POST", body: f });
      }
      const paginas = [...(extracao?.paginas ?? []).map((b, k) => ({ b, nome: `pagina_${k}.jpg` })), ...fotos.map((f) => ({ b: f.blob, nome: f.nome }))];
      for (let k = 0; k < paginas.length; k++) {
        setStatus(`Enviando página/foto ${k + 1} de ${paginas.length}…`);
        const f = new FormData();
        f.set(`pagina_${k}`, paginas[k].b, paginas[k].nome);
        await api(`/api/pedidos/${r.id}/itens`, { method: "POST", body: f });
      }
      setStatus("Calculando custos e preços…");
      const fim = await api<{ paginas: number; recompras: number }>(`/api/pedidos/${r.id}/finalizar`, { method: "POST" });
      r.paginas = fim.paginas;
      if (fim.recompras) avisar(`${fim.recompras} peça(s) reconhecida(s) como recompra: mesma referência e EAN do cadastro anterior.`, "info");
      r.avisos.forEach((a) => avisar(a, "info"));

      if (analisarIa) {
        try {
          if (r.paginas) await laco(`/api/pedidos/${r.id}/detectar`, (x) => `Localizando peças nas fotos… faltam ${x.restantes} página(s)`);
          await laco(`/api/pedidos/${r.id}/analisar`, (x) => `IA analisando as peças (classificação, tradução e nomes)… faltam ${x.restantes}`);
          avisar("Pedido importado e analisado pela IA!");
        } catch (e) {
          avisar(`Pedido criado, mas a análise por IA parou: ${e instanceof Error ? e.message : e}`, "erro");
        }
      } else avisar("Pedido criado. Você pode rodar a análise por IA na tela do pedido.");
      router.push(`/pedidos/${r.id}${analisarIa && fotosModelo ? "?fotos=1" : ""}`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-semibold">Importar pedido ou catálogo</h1>
        <p className="mt-1 text-sm text-[#8a6d78]">
          Envie o PDF do pedido do fornecedor (com fotos) ou fotos do catálogo. O app recorta a foto de cada peça, lê código, preço e
          quantidade, converte pela cotação do dia da compra e a IA classifica e sugere nomes.
        </p>
      </div>

      <ImportarCadastroClaude />

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          selecionar(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition ${arrastando ? "border-rose-escuro bg-rose-claro" : "border-rose bg-white hover:bg-[#fdf7f9]"}`}
      >
        <span className="font-script text-3xl text-rose-escuro">solte aqui o pedido</span>
        <span className="text-sm text-[#8a6d78]">PDF do fornecedor, ou fotos JPG/PNG do catálogo (pode selecionar várias)</span>
        <input type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => e.target.files && selecionar(e.target.files)} />
        {arquivos.length > 0 && <span className="text-xs text-rose-escuro">{arquivos.map((a) => a.name).join(", ")}</span>}
      </label>

      {(lendo || status) && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-claro px-4 py-2 text-sm text-rose-escuro">
          {(lendo || enviando) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {status || "Lendo…"}
        </div>
      )}

      {(extracao || fotos.length > 0) && (
        <Cartao titulo="Dados do pedido">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-8">
            <Campo rotulo="Fornecedor" className="lg:col-span-2">
              <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" list="fornecedores-conhecidos" />
              <datalist id="fornecedores-conhecidos">
                {fornecedores.map((f) => (
                  <option key={f.nome} value={f.nome}>
                    {f.apelido ?? f.nome}
                  </option>
                ))}
              </datalist>
              {fornecedorConhecido ? (
                <span className="text-xs text-[#6b8f71]">✓ Fornecedor já cadastrado{fornecedorConhecido.apelido ? `: ${fornecedorConhecido.apelido}` : ""}. A recompra vai achar as peças que já vieram dele.</span>
              ) : (
                fornecedores.length > 0 && <span className="text-xs text-[#9a8089]">Use o nome original (ex.: em chinês) para a recompra reconhecer o fornecedor.</span>
              )}
            </Campo>
            <Campo rotulo="Nº do pedido">
              <input value={numero} onChange={(e) => setNumero(e.target.value)} />
            </Campo>
            <Campo rotulo="Data da compra">
              <input
                type="date"
                value={dataCompra}
                onChange={(e) => {
                  setDataCompra(e.target.value);
                  setCotacaoManual(false);
                }}
              />
            </Campo>
            <Campo rotulo="Moeda dos preços">
              <select value={moeda} onChange={(e) => trocarMoeda(e.target.value)}>
                <option value="CNY">Yuan (¥ CNY)</option>
                <option value="BRL">Real (R$)</option>
                <option value="USD">Dólar (US$)</option>
              </select>
            </Campo>
            <Campo
              rotulo={`Cotação (R$ por ${moedaSimbolo(moeda)} 1)`}
              dica={cotacaoErro ? <span className="text-red-700">{cotacaoErro}</span> : cotacaoInfo ? `${cotacaoInfo.fonte} · ${cotacaoInfo.data.split("-").reverse().join("/")}` : "buscando PTAX…"}
            >
              <input
                type="number"
                step="0.0001"
                value={cotacao}
                onChange={(e) => {
                  setCotacao(e.target.value ? Number(e.target.value) : "");
                  setCotacaoManual(true);
                }}
                disabled={moeda === "BRL"}
              />
            </Campo>
            <Campo rotulo="Frete (R$)" dica="Rateado: frete ÷ mercadoria × valor de cada peça">
              <input inputMode="decimal" placeholder="ex.: 850,00" value={frete} onChange={(e) => setFrete(e.target.value)} className="border-rose font-titulo text-xl font-semibold text-rose-escuro" />
            </Campo>
            <Campo rotulo="Fator multiplicador" dica="Preço = custo × fator. Em branco = padrão da loja.">
              <input inputMode="decimal" placeholder="ex.: 10" value={fator} onChange={(e) => setFator(e.target.value)} className="border-rose font-titulo text-xl font-semibold text-rose-escuro" />
            </Campo>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-4">
            <div className="flex flex-wrap gap-4 text-sm">
              {extracao && (
                <>
                  <span>
                    <b>{ativas.length}</b> linhas · <b>{pecasLidas}</b> peças
                  </span>
                  <span>
                    Total lido: <b>{moedaSimbolo(moeda)} {num(totalLido)}</b>
                    {cotacao ? <> ≈ {brl(totalLido * Number(cotacao))}</> : null}
                  </span>
                  {extracao.totalDocumento != null && (
                    <Selo cor={confere ? "verde" : "amarelo"}>
                      {confere ? "✓ confere com o total do documento" : `Documento: ${num(extracao.totalDocumento)} — confira`}
                    </Selo>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={analisarIa} onChange={(e) => setAnalisarIa(e.target.checked)} /> Analisar com IA (classificar, traduzir, nomes)
                </label>
                <label className="flex items-center gap-2" title="Gemini 3 Pro Image ≈ US$ 0,13–0,24 por imagem gerada; o marketing pode pedir até 3 tentativas por peça">
                  <input type="checkbox" checked={analisarIa && fotosModelo} disabled={!analisarIa} onChange={(e) => setFotosModelo(e.target.checked)} /> Criar fotos com IA (expositor) aprovadas pelo marketing
                </label>
              </div>
              <Botao onClick={criarPedido} carregando={enviando} disabled={lendo}>
                Criar pedido
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      {linhas.length > 0 && (
        <Cartao titulo="Itens encontrados" acoes={<span className="text-xs text-[#9a8089]">Desmarque o que não for produto (ex.: linhas repetidas)</span>}>
          <div className="max-h-[70vh] overflow-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th></th>
                  <th>Foto</th>
                  <th>Linha do documento</th>
                  <th>Código</th>
                  <th>Preço</th>
                  <th>Qtd</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.i} className={excluidos.has(l.i) ? "opacity-40" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!excluidos.has(l.i)}
                        onChange={() =>
                          setExcluidos((s) => {
                            const n = new Set(s);
                            if (n.has(l.i)) n.delete(l.i);
                            else n.add(l.i);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.previa} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    </td>
                    <td className="max-w-md text-xs text-[#6b5560]">{l.texto}</td>
                    <td className="font-mono text-xs">{l.lida.codigo ?? "—"}</td>
                    <td>{l.lida.preco != null ? `${moedaSimbolo(moeda)} ${num(l.lida.preco)}` : <Selo cor="amarelo">IA lê</Selo>}</td>
                    <td>{l.lida.quantidade ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      {fotos.length > 0 && (
        <Cartao titulo="Fotos do catálogo">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {fotos.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f.url} src={f.url} alt={f.nome} className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}
