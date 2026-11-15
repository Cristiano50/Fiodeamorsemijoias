"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao, Campo, Cartao, Selo, useAviso } from "@/components/ui";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";
import { lerCabecalho, lerLinha } from "@/lib/extracao";
import { lerNumeroBr, numeroParaCampo } from "@/lib/numeros";
import { extrairPdf, prepararFoto, type Extracao } from "@/lib/pdf-cliente";
import { ImportarCadastroClaude } from "@/components/ImportarCadastroClaude";

type Cotacao = { valor: number; data: string; fonte: string };
/** Pedido que já existe com o mesmo número e fornecedor (resposta 409 do POST /api/pedidos). */
type Existente = { id: string; numero: string | null; fornecedor: string | null; status: string; criadoEm: string; itens: number };
/** Importação que parou no meio (status "importando"). */
type Incompleta = { id: string; numero: string | null; fornecedor: string | null; fornecedorApelido: string | null; criadoEm: string; linhas: number; arquivoNome: string | null; origem: string };

const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

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
  const [moedaAviso, setMoedaAviso] = useState("");
  const [cotacaoTexto, setCotacaoTexto] = useState("");
  const [cotacaoInfo, setCotacaoInfo] = useState<Cotacao | null>(null);
  const [cotacaoErro, setCotacaoErro] = useState("");
  // Só enviamos a cotação se a pessoa digitou; senão o servidor busca a PTAX oficial da data da compra.
  const [cotacaoManual, setCotacaoManual] = useState(false);
  const [analisarIa, setAnalisarIa] = useState(true);
  const [fator, setFator] = useState("");
  const [frete, setFrete] = useState("");
  const [fotosModelo, setFotosModelo] = useState(true);

  // Pedido repetido, importações incompletas e quem está usando (algumas ações são só da gestora).
  const [existente, setExistente] = useState<Existente | null>(null);
  const [continuar, setContinuar] = useState<Incompleta | null>(null);
  const [incompletas, setIncompletas] = useState<Incompleta[]>([]);
  const [gestora, setGestora] = useState(false);
  const carregarIncompletas = useCallback(
    () =>
      api<Incompleta[]>("/api/pedidos?incompletos=1")
        .then((l) => {
          setIncompletas(l);
          return l;
        })
        .catch(() => [] as Incompleta[]),
    [],
  );
  useEffect(() => {
    api<{ usuario: { papel: string } | null }>("/api/sessao")
      .then((s) => setGestora(!s.usuario || s.usuario.papel === "gestora"))
      .catch(() => {});
    carregarIncompletas().then((l) => {
      // /importar?continuar=<id>: vindo da lista de pedidos ("Importação incompleta").
      const id = new URLSearchParams(window.location.search).get("continuar");
      const p = id ? l.find((x) => x.id === id) : undefined;
      if (p) setContinuar(p);
    });
  }, [carregarIncompletas]);

  async function selecionar(lista: FileList | File[]) {
    const arr = Array.from(lista);
    if (!arr.length) return;
    setArquivos(arr);
    setExtracao(null);
    setFotos([]);
    setExcluidos(new Set());
    setExistente(null);
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
        if (cab.moeda) {
          trocarMoeda(cab.moeda);
          setMoedaAviso("");
        } else setMoedaAviso(`Não achei a moeda no documento: ficou ${moeda === "CNY" ? "Yuan (¥)" : moeda}. Confira antes de criar o pedido.`);
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
    setMoedaAviso("");
    if (m === "BRL") {
      setCotacaoTexto("1");
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
          setCotacaoTexto(numeroParaCampo(Number(r.cotacao.valor.toFixed(4)), 4));
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
  const cotacaoNum = lerNumeroBr(cotacaoTexto, { milhar: false });

  async function laco(url: string, rotulo: (r: { restantes: number }) => string) {
    for (let tentativa = 0; tentativa < 500; tentativa++) {
      const r = await api<{ restantes: number }>(url, { method: "POST", json: {} });
      setStatus(rotulo(r));
      if (!r.restantes) return;
    }
  }

  /** POST /api/pedidos; pedido repetido (409) devolve o existente em vez de erro. */
  async function postarPedido(form: FormData): Promise<{ id: string; avisos: string[] } | { existente: Existente }> {
    const res = await fetch("/api/pedidos", { method: "POST", body: form });
    if (res.status === 401) router.push(`/entrar?voltar=${encodeURIComponent(window.location.pathname)}`);
    const dados = (await res.json().catch(() => ({}))) as { id?: string; avisos?: string[]; erro?: string; existente?: Existente };
    if (res.status === 409 && dados.existente) return { existente: dados.existente };
    if (!res.ok || !dados.id) throw new Error(dados.erro ?? `Erro ${res.status}`);
    return { id: dados.id, avisos: dados.avisos ?? [] };
  }

  /**
   * Cria o pedido (ou continua um que parou no meio, com o mesmo id) e manda em lotes só o que o servidor ainda não tem.
   * Cada linha vai com o número da linha extraída do documento (estável), então reenviar não duplica.
   */
  async function importar(opcoes: { forcar?: boolean; pedidoId?: string } = {}) {
    if (!ativas.length && !fotos.length && !extracao?.paginas.length) return avisar("Nada para importar.", "erro");
    const freteN = frete.trim() ? lerNumeroBr(frete) : null;
    if (frete.trim() && (freteN == null || freteN < 0)) return avisar(`Frete inválido: "${frete}". Digite só o valor, ex.: 850,50.`, "erro");
    const fatorN = fator.trim() ? lerNumeroBr(fator, { milhar: false }) : null;
    if (fator.trim() && !(fatorN != null && fatorN > 0)) return avisar(`Fator inválido: "${fator}". Digite um número, ex.: 10 ou 8,5.`, "erro");
    if (cotacaoManual && cotacaoTexto.trim() && !(cotacaoNum != null && cotacaoNum > 0))
      return avisar(`Cotação inválida: "${cotacaoTexto}". Digite a cotação do dia, ex.: 0,7745.`, "erro");
    if (opcoes.pedidoId && continuar && continuar.numero && numero && continuar.numero.replace(/\s+/g, "").toUpperCase() !== numero.replace(/\s+/g, "").toUpperCase()) {
      if (!confirm(`Este documento parece ser o pedido ${numero}, mas a importação incompleta é do pedido ${continuar.numero}. Continuar mesmo assim?`)) return;
    }
    setEnviando(true);
    setExistente(null);
    try {
      let pedidoId = opcoes.pedidoId;
      let avisos: string[] = [];
      if (!pedidoId) {
        setStatus("Criando o pedido…");
        const form = new FormData();
        form.set(
          "meta",
          JSON.stringify({
            numero,
            fornecedor,
            dataCompra,
            moeda,
            cotacao: cotacaoManual && cotacaoNum ? cotacaoNum : undefined,
            cotacaoSugerida: !cotacaoManual && cotacaoNum && cotacaoInfo?.data ? { valor: cotacaoNum, data: cotacaoInfo.data, fonte: cotacaoInfo.fonte } : undefined,
            fator: fatorN,
            frete: freteN,
            cabecalho: extracao?.cabecalho,
            colunas: extracao?.colunas,
            totalDocumento: extracao?.totalDocumento ?? null,
            arquivoNome: arquivos.map((a) => a.name).join(", "),
            forcar: opcoes.forcar || undefined,
          }),
        );
        const pdf = arquivos.find((a) => a.name.toLowerCase().endsWith(".pdf"));
        if (pdf && pdf.size < 3.5 * 1024 * 1024) form.set("arquivo", pdf);
        const r = await postarPedido(form);
        if ("existente" in r) {
          setExistente(r.existente);
          setStatus("");
          return;
        }
        pedidoId = r.id;
        avisos = r.avisos;
      }

      // O que o servidor já tem (importação continuada): manda só o que falta.
      const ja = await api<{ linhas: number[]; paginas: number[] }>(`/api/pedidos/${pedidoId}/itens`);
      const linhasJa = new Set(ja.linhas);
      const paginasJa = new Set(ja.paginas);
      const faltam = ativas.filter((l) => !linhasJa.has(l.i + 1));
      // Fotos em lotes pequenos (cabem no limite de upload de qualquer servidor).
      const LOTE = 8;
      for (let i = 0; i < faltam.length; i += LOTE) {
        setStatus(`Enviando peças ${i + 1}–${Math.min(i + LOTE, faltam.length)} de ${faltam.length}…`);
        const f = new FormData();
        const lote = faltam.slice(i, i + LOTE);
        f.set("itens", JSON.stringify(lote.map((l, k) => ({ linha: l.i + 1, texto: l.texto, campo: `item_${k}` }))));
        lote.forEach((l, k) => f.set(`item_${k}`, l.imagem, `item_${k}.jpg`));
        await api(`/api/pedidos/${pedidoId}/itens`, { method: "POST", body: f });
      }
      const paginas = [...(extracao?.paginas ?? []).map((b, k) => ({ b, nome: `pagina_${k}.jpg` })), ...fotos.map((f) => ({ b: f.blob, nome: f.nome }))];
      for (let k = 0; k < paginas.length; k++) {
        if (paginasJa.has(k)) continue;
        setStatus(`Enviando página/foto ${k + 1} de ${paginas.length}…`);
        const f = new FormData();
        f.set(`pagina_${k}`, paginas[k].b, paginas[k].nome);
        await api(`/api/pedidos/${pedidoId}/itens`, { method: "POST", body: f });
      }
      setStatus("Calculando custos e preços…");
      const fim = await api<{ paginas: number; recompras: number; aConfirmar: number }>(`/api/pedidos/${pedidoId}/finalizar`, { method: "POST" });
      if (fim.recompras) avisar(`${fim.recompras} peça(s) reconhecida(s) como recompra: mesma referência e código de barras do cadastro anterior.`, "info");
      if (fim.aConfirmar) avisar(`${fim.aConfirmar} peça(s) com recompra a confirmar: escolha a peça original na tela do pedido.`, "info");
      avisos.forEach((a) => avisar(a, "info"));
      setContinuar(null);
      void carregarIncompletas();

      if (analisarIa) {
        try {
          if (fim.paginas) await laco(`/api/pedidos/${pedidoId}/detectar`, (x) => `Localizando peças nas fotos… faltam ${x.restantes} página(s)`);
          await laco(`/api/pedidos/${pedidoId}/analisar`, (x) => `IA analisando as peças (classificação, tradução e nomes)… faltam ${x.restantes}`);
          avisar("Pedido importado e analisado pela IA!");
        } catch (e) {
          avisar(`Pedido criado, mas a análise por IA parou: ${e instanceof Error ? e.message : e}`, "erro");
        }
      } else avisar("Pedido criado. Você pode rodar a análise por IA na tela do pedido.");
      router.push(`/pedidos/${pedidoId}${analisarIa && fotosModelo ? "?fotos=1" : ""}`);
    } catch (e) {
      avisar(`${e instanceof Error ? e.message : String(e)} Se o envio parou no meio, é só tentar de novo: o que já foi não se repete.`, "erro");
      void carregarIncompletas();
    } finally {
      setEnviando(false);
    }
  }

  async function excluirPedido(id: string, numeroPedido: string | null) {
    if (!confirm(`Excluir o pedido ${numeroPedido ?? "sem número"} e todas as peças dele?`)) return false;
    try {
      await api(`/api/pedidos/${id}`, { method: "DELETE" });
      avisar("Pedido excluído.");
      if (continuar?.id === id) setContinuar(null);
      void carregarIncompletas();
      return true;
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
      return false;
    }
  }

  const temDocumento = !!extracao || fotos.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-semibold">Importar pedido ou catálogo</h1>
        <p className="mt-1 text-sm text-[#8a6d78]">
          Envie o PDF do pedido do fornecedor (com fotos) ou fotos do catálogo. O app recorta a foto de cada peça, lê código, preço e
          quantidade, converte pela cotação do dia da compra e a IA classifica e sugere nomes.
        </p>
      </div>

      {incompletas.length > 0 && (
        <Cartao titulo="Importações incompletas">
          <p className="mb-2 text-sm text-[#6b5560]">
            Estes pedidos começaram a ser importados e pararam no meio (o navegador fechou ou a internet caiu). Continue com o mesmo arquivo — só o que falta
            é enviado — ou exclua e importe de novo.
          </p>
          <div className="flex flex-col divide-y divide-borda">
            {incompletas.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <b>Pedido {p.numero ?? "sem número"}</b> · {p.fornecedorApelido ?? p.fornecedor ?? "sem fornecedor"} · começou em {dataBr(p.criadoEm)} ·{" "}
                  {p.linhas} peça(s) recebida(s)
                  {p.arquivoNome ? <span className="block text-xs text-[#9a8089]">{p.arquivoNome}</span> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.origem === "skill" ? (
                    <span className="text-xs text-[#9a8089]">Cadastro do Claude: envie de novo o mesmo arquivo .json abaixo.</span>
                  ) : continuar?.id === p.id ? (
                    <Selo cor="verde">{temDocumento ? "pronto para continuar ↓" : "agora selecione o mesmo PDF ↓"}</Selo>
                  ) : (
                    <Botao variante="secundario" onClick={() => setContinuar(p)}>
                      Continuar importação
                    </Botao>
                  )}
                  {gestora && (
                    <Botao variante="perigo" onClick={() => excluirPedido(p.id, p.numero)}>
                      Excluir
                    </Botao>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Cartao>
      )}

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
        <span className="font-script text-3xl text-rose-escuro">{continuar ? `solte aqui o PDF do pedido ${continuar.numero ?? ""}` : "solte aqui o pedido"}</span>
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

      {existente && (
        <Cartao titulo="Pedido repetido">
          <p className="text-sm">
            Este pedido já foi importado em <b>{dataBr(existente.criadoEm)}</b>: pedido {existente.numero ?? "sem número"}
            {existente.fornecedor ? ` de ${existente.fornecedor}` : ""}, {existente.itens} peça(s)
            {existente.status === "importando" ? <b> — a importação ficou incompleta.</b> : "."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/pedidos/${existente.id}`}>
              <Botao variante="secundario">Abrir pedido</Botao>
            </Link>
            {existente.status === "importando" ? (
              <>
                <Botao onClick={() => importar({ pedidoId: existente.id })} carregando={enviando}>
                  Continuar importação
                </Botao>
                {gestora && (
                  <Botao
                    variante="perigo"
                    disabled={enviando}
                    onClick={async () => {
                      if (await excluirPedido(existente.id, existente.numero)) await importar();
                    }}
                  >
                    Excluir e importar de novo
                  </Botao>
                )}
              </>
            ) : (
              gestora && (
                <Botao variante="perigo" onClick={() => importar({ forcar: true })} carregando={enviando}>
                  Importar mesmo assim
                </Botao>
              )
            )}
          </div>
          {!gestora && <p className="mt-2 text-xs text-[#9a8089]">Só a gestora pode importar de novo um pedido que já existe.</p>}
        </Cartao>
      )}

      {temDocumento && (
        <Cartao titulo={continuar ? `Continuar a importação do pedido ${continuar.numero ?? "sem número"}` : "Dados do pedido"}>
          {continuar ? (
            <p className="text-sm text-[#6b5560]">
              Os dados do pedido já estão salvos ({continuar.linhas} peça(s) recebida(s)). Só as peças e páginas que faltam serão enviadas.{" "}
              <button className="text-rose-escuro underline" onClick={() => setContinuar(null)}>
                Importar como pedido novo
              </button>
            </p>
          ) : (
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
              <Campo rotulo="Moeda dos preços" dica={moedaAviso ? <span className="text-amber-700">{moedaAviso}</span> : undefined}>
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
                  inputMode="decimal"
                  placeholder="ex.: 0,7745"
                  value={cotacaoTexto}
                  onChange={(e) => {
                    setCotacaoTexto(e.target.value);
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
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-4">
            <div className="flex flex-wrap gap-4 text-sm">
              {extracao && (
                <>
                  <span>
                    <b>{ativas.length}</b> linhas · <b>{pecasLidas}</b> peças
                  </span>
                  <span>
                    Total lido: <b>{moedaSimbolo(moeda)} {num(totalLido)}</b>
                    {cotacaoNum ? <> ≈ {brl(totalLido * cotacaoNum)}</> : null}
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
              <Botao onClick={() => importar(continuar ? { pedidoId: continuar.id } : {})} carregando={enviando} disabled={lendo}>
                {continuar ? "Continuar importação" : "Criar pedido"}
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
                  <th>Especificação</th>
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
                      <img src={l.previa} alt="" loading="lazy" decoding="async" className="h-16 w-16 rounded-lg object-cover" />
                    </td>
                    <td className="max-w-md text-xs text-[#6b5560]">{l.texto}</td>
                    <td className="font-mono text-xs">{l.lida.codigo ?? "—"}</td>
                    <td className="text-xs">{l.lida.especificacao ?? "—"}</td>
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
              <img key={f.url} src={f.url} alt={f.nome} loading="lazy" decoding="async" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}
