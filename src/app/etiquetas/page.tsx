"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo } from "@/components/ui";
import { useConfig } from "@/components/hooks";
import { api, brl } from "@/lib/cliente";
import { ean13Valido } from "@/lib/codigos-up";
import { copiasEtiqueta } from "@/lib/recebimento";
import { esperarImagens } from "@/components/pedido/comum";

type Formato = "rabicho" | "a4_6180" | "a4_6187" | "cartela";

const FORMATOS: Record<Formato, { nome: string; descricao: string }> = {
  rabicho: { nome: "Rabicho térmico 95×12 mm", descricao: "Impressora térmica (Argox, Elgin, Zebra). Duas faces de 30 mm + rabicho. 1 etiqueta por página." },
  a4_6180: { nome: "A4 Pimaco 6180 (66,7×25,4 mm)", descricao: "30 etiquetas por folha (3×10). Impressora comum." },
  a4_6187: { nome: "A4 Pimaco 6187 (44,45×12,7 mm)", descricao: "80 etiquetas por folha (4×20). Mini etiqueta para saquinho." },
  cartela: { nome: "Cartela de brinco 50×50 mm", descricao: "Cartela que segura o brinco, com logo, nome, referência, código e preço." },
};

/**
 * O código impresso é sempre o mesmo número gravado no UP:
 *  - código do UP: o número inteiro (EAN-13 se tiver 13 dígitos; senão, ou se escolher Code128, em Code128);
 *  - EAN interno do app no "Code128 curto": os 8 dígitos da sequência (é o que o app grava no UP nesse modo).
 */
function Codigo({ valor, origem, simbologia, altura }: { valor: string; origem: string | null; simbologia: "ean13" | "code128"; altura: number }) {
  const curto = simbologia === "code128" && origem !== "up" && /^9100\d{9}$/.test(valor);
  const v = curto ? valor.replace(/^9100/, "").slice(0, -1) : valor;
  // EAN-13 só quando o número é um EAN-13 válido; senão Code128 com o mesmo número (o leitor do caixa lê os dois).
  const tipo = simbologia === "ean13" && ean13Valido(v) ? "ean13" : "code128";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/codigo-barras?c=${encodeURIComponent(v)}&tipo=${tipo}&texto=0&altura=${altura}`} alt={valor} loading="lazy" decoding="async" className="block h-full w-full object-fill" />;
}

function EtiquetasConteudo() {
  const params = useSearchParams();
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [formato, setFormato] = useState<Formato>("rabicho");
  const [simbologiaEscolhida, setSimbologia] = useState<"ean13" | "code128" | null>(null);
  const [copias, setCopias] = useState<"quantidade" | "uma">("quantidade");
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [pular, setPular] = useState(0);
  const [imprimindo, setImprimindo] = useState(false);
  const { config } = useConfig();
  const codigoNoUp = config?.sistema.codigoNoUp === "code128" ? "code128" : "ean13";
  // Padrão da loja: o código de barras é o que o UP criou; peça sem ele não ganha etiqueta.
  const modoUp = config?.sistema.origemCodigoBarras !== "app";
  const temCodigo = (p: Produto) => !!p.codigoBarras && (!modoUp || p.codigoBarrasOrigem === "up");
  const simbologia = simbologiaEscolhida ?? codigoNoUp;

  useEffect(() => {
    const ids = params.get("ids");
    const pedido = params.get("pedido");
    const url = ids ? `/api/produtos?limite=2000` : pedido ? `/api/produtos?pedido=${pedido}&limite=2000` : `/api/produtos?status=aprovado&limite=2000`;
    api<Produto[]>(url).then((l) => {
      const filtrados = ids ? l.filter((p) => ids.split(",").includes(p.id)) : l;
      setProdutos(filtrados.sort((a, b) => (a.linha ?? 0) - (b.linha ?? 0)));
    });
  }, [params]);

  // Uma etiqueta por peça que ENTROU na loja: conferida = recebida − defeito; sem conferência, a pedida.
  const etiquetas = useMemo(() => {
    const out: (Produto | null)[] = Array.from({ length: formato.startsWith("a4") ? pular : 0 }, () => null);
    for (const p of produtos ?? []) {
      if (!p.codigoBarras || (modoUp && p.codigoBarrasOrigem !== "up")) continue;
      const n = copiasEtiqueta(p, copias);
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [produtos, copias, formato, pular, modoUp]);

  // Ctrl+P sem o botão: começa a carregar as etiquetas que ainda não apareceram na tela.
  useEffect(() => {
    const antes = () => void esperarImagens(document.querySelector(".area-impressao"));
    window.addEventListener("beforeprint", antes);
    return () => window.removeEventListener("beforeprint", antes);
  }, []);

  async function imprimir() {
    setImprimindo(true);
    try {
      // Os códigos de barras carregam só quando aparecem na tela: antes de imprimir, carrega todos.
      await esperarImagens(document.querySelector(".area-impressao"));
      window.print();
    } finally {
      setImprimindo(false);
    }
  }

  if (!produtos) return <Carregando />;
  const semCodigo = produtos.filter((p) => !temCodigo(p)).length;
  const total = etiquetas.filter(Boolean).length;
  // Peças de pedido ainda sem conferência na chegada: a etiqueta sai pela quantidade pedida.
  const semConferencia = produtos.filter((p) => p.pedidoId && p.quantidadeRecebida == null && temCodigo(p)).length;
  const nadaEntrou = produtos.filter((p) => temCodigo(p) && copiasEtiqueta(p, copias) === 0).length;

  const css = {
    rabicho: "@page { size: 95mm 12mm; margin: 0 } .folha { display:block } .et { width:95mm; height:12mm; page-break-after: always; break-after: page; }",
    a4_6180: "@page { size: A4; margin: 12.7mm 4.8mm 0 4.8mm } .folha { display:grid; grid-template-columns: repeat(3, 66.7mm); column-gap: 3.1mm; grid-auto-rows: 25.4mm }",
    a4_6187: "@page { size: A4; margin: 10.7mm 10.2mm 0 10.2mm } .folha { display:grid; grid-template-columns: repeat(4, 44.45mm); column-gap: 3.1mm; grid-auto-rows: 12.7mm }",
    cartela: "@page { size: 50mm 50mm; margin: 0 } .et { width:50mm; height:50mm; page-break-after: always; break-after: page; }",
  }[formato];

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { ${css} main { padding:0 !important; max-width:none !important } .area-impressao { padding:0 !important; background:none !important; border:none !important } }`}</style>
      <div className="nao-imprimir flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Etiquetas</h1>
          <p className="text-sm text-[#8a6d78]">
            {produtos.length} produto(s) · {total} etiqueta(s)
            {semCodigo ? (modoUp ? ` · ${semCodigo} sem o código de barras do UP (cadastre no UP e importe ou bipe os códigos)` : ` · ${semCodigo} sem código de barras (gere antes)`) : ""}
          </p>
          {copias === "quantidade" && (
            <p className="text-sm text-[#8a6d78]">
              Uma etiqueta por peça que entrou na loja (conferência da chegada: recebidas − com defeito).
              {semConferencia ? ` ${semConferencia} produto(s) ainda sem conferência saem pela quantidade pedida.` : ""}
              {nadaEntrou ? ` ${nadaEntrou} produto(s) sem nenhuma peça boa ficam sem etiqueta.` : ""}
            </p>
          )}
        </div>
        <Botao onClick={imprimir} carregando={imprimindo} disabled={!total}>
          🖶 Imprimir
        </Botao>
      </div>

      <Cartao className="nao-imprimir">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Campo rotulo="Formato" className="md:col-span-2" dica={FORMATOS[formato].descricao}>
            <select value={formato} onChange={(e) => setFormato(e.target.value as Formato)}>
              {Object.entries(FORMATOS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            rotulo="Código impresso"
            dica={
              modoUp
                ? "Sempre o número criado pelo UP. Code128 mostra o mesmo número com outro desenho de barras."
                : simbologia !== (codigoNoUp ?? "ean13")
                  ? "⚠ Diferente do código gravado no UP (Configurações → Códigos). O caixa não vai achar o produto."
                  : simbologia === "code128"
                    ? "Code128 de 8 dígitos: cabe melhor no rabicho"
                    : "EAN-13 (padrão)"
            }
          >
            <select value={simbologia} onChange={(e) => setSimbologia(e.target.value as "ean13" | "code128")}>
              <option value="ean13">EAN-13</option>
              <option value="code128">{modoUp ? "Code128 (mesmo número)" : "Code128 curto"}</option>
            </select>
          </Campo>
          <Campo rotulo="Cópias">
            <select value={copias} onChange={(e) => setCopias(e.target.value as "quantidade" | "uma")}>
              <option value="quantidade">Uma por peça (a que entrou)</option>
              <option value="uma">Uma por produto</option>
            </select>
          </Campo>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mostrarPreco} onChange={(e) => setMostrarPreco(e.target.checked)} /> Imprimir preço
            </label>
            {formato.startsWith("a4") && (
              <Campo rotulo="Pular etiquetas já usadas">
                <input type="number" min={0} value={pular} onChange={(e) => setPular(Number(e.target.value))} />
              </Campo>
            )}
          </div>
        </div>
        {formato === "rabicho" && simbologia === "ean13" && (
          <p className="mt-3 text-xs text-amber-800">
            <Selo cor="amarelo">teste antes</Selo> No rabicho, o EAN-13 fica com ~28 mm, abaixo do mínimo GS1. Teste a leitura no leitor do caixa com algumas etiquetas; se falhar, use{" "}
            {modoUp ? "“Code128 (mesmo número)”" : "“Code128 curto” (ver parecer do gestor de estoque)"}.
          </p>
        )}
      </Cartao>

      <div className="area-impressao overflow-auto rounded-2xl border border-borda bg-[#f3ece6] p-6">
        <div className="folha flex flex-wrap gap-2">
          {etiquetas.map((p, i) =>
            !p ? (
              <div key={`v${i}`} className="et" />
            ) : formato === "rabicho" ? (
              <div key={i} className="et flex bg-white text-black" style={{ width: "95mm", height: "12mm" }}>
                <div className="flex flex-col justify-center px-[1.5mm]" style={{ width: "30mm" }}>
                  <div className="font-script leading-none text-rose-escuro" style={{ fontSize: "7pt" }}>
                    fio de amor
                  </div>
                  {mostrarPreco && (
                    <div className="font-titulo font-semibold leading-none" style={{ fontSize: "11pt" }}>
                      {brl(p.precoVenda)}
                    </div>
                  )}
                  <div className="truncate font-mono leading-none" style={{ fontSize: "5pt" }}>
                    {p.referencia}
                  </div>
                </div>
                <div className="flex flex-col justify-center px-[0.5mm]" style={{ width: "30mm" }}>
                  <div style={{ height: "8mm" }}>
                    <Codigo valor={p.codigoBarras!} origem={p.codigoBarrasOrigem} simbologia={simbologia} altura={8} />
                  </div>
                  <div className="text-center font-mono leading-none" style={{ fontSize: "5pt" }}>
                    {simbologia === "ean13" ? p.codigoBarras : p.codigoBarras!.replace(/^9100/, "").slice(0, -1)}
                  </div>
                </div>
                <div className="border-l border-dashed border-stone-300" style={{ width: "35mm" }} />
              </div>
            ) : formato === "cartela" ? (
              <div key={i} className="et flex flex-col items-center justify-between bg-white p-[2mm] text-black" style={{ width: "50mm", height: "50mm" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/marca/logo-fiodeamor.png" alt="" loading="lazy" decoding="async" style={{ width: "22mm" }} />
                <div className="flex w-full justify-around">
                  <span className="h-[1.6mm] w-[1.6mm] rounded-full border border-stone-400" />
                  <span className="h-[1.6mm] w-[1.6mm] rounded-full border border-stone-400" />
                </div>
                <div className="w-full text-center">
                  <div className="truncate uppercase" style={{ fontSize: "5pt" }}>
                    {p.nome}
                  </div>
                  <div style={{ height: "7mm" }}>
                    <Codigo valor={p.codigoBarras!} origem={p.codigoBarrasOrigem} simbologia={simbologia} altura={8} />
                  </div>
                  <div className="flex justify-between font-mono" style={{ fontSize: "5.5pt" }}>
                    <span>{p.referencia}</span>
                    <span>{p.codigoBarras}</span>
                  </div>
                  {mostrarPreco && (
                    <div className="font-titulo font-semibold" style={{ fontSize: "12pt" }}>
                      {brl(p.precoVenda)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                key={i}
                className="et flex items-center gap-[1mm] overflow-hidden bg-white px-[1.5mm] text-black"
                style={formato === "a4_6180" ? { width: "66.7mm", height: "25.4mm" } : { width: "44.45mm", height: "12.7mm" }}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="font-script leading-none text-rose-escuro" style={{ fontSize: formato === "a4_6180" ? "9pt" : "6pt" }}>
                    fio de amor
                  </div>
                  {formato === "a4_6180" && (
                    <div className="line-clamp-2 uppercase leading-tight" style={{ fontSize: "5.5pt" }}>
                      {p.nome}
                    </div>
                  )}
                  <div className="font-mono leading-none" style={{ fontSize: "5pt" }}>
                    {p.referencia}
                  </div>
                  {mostrarPreco && (
                    <div className="font-titulo font-semibold leading-none" style={{ fontSize: formato === "a4_6180" ? "13pt" : "8pt" }}>
                      {brl(p.precoVenda)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center" style={{ width: formato === "a4_6180" ? "32mm" : "22mm" }}>
                  <div style={{ height: formato === "a4_6180" ? "13mm" : "7.5mm", width: "100%" }}>
                    <Codigo valor={p.codigoBarras!} origem={p.codigoBarrasOrigem} simbologia={simbologia} altura={10} />
                  </div>
                  <div className="font-mono leading-none" style={{ fontSize: "5pt" }}>
                    {simbologia === "ean13" ? p.codigoBarras : p.codigoBarras!.replace(/^9100/, "").slice(0, -1)}
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export default function EtiquetasPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <EtiquetasConteudo />
    </Suspense>
  );
}
