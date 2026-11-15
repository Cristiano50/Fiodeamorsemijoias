"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Botao, Carregando, Cartao, useAviso } from "@/components/ui";
import { api, img, moedaSimbolo, num } from "@/lib/cliente";
import { dataBr, relatorioFornecedor, type ItemRelatorio } from "@/lib/recebimento";
import { esperarImagens, mensagemDe, type DadosRecebimento } from "@/components/pedido/comum";

/**
 * Relatório de faltas e defeitos para mandar ao fornecedor (item 24), pedindo crédito ou reposição.
 * Foto do catálogo e do defeito, código (货号), especificação (规格), quantidades, valor na moeda do pedido e total.
 * Imprimir → salvar em PDF no celular ou no computador; ou copiar o texto para o WhatsApp/WeChat.
 */
export default function RelatorioFornecedorPage() {
  const { id } = useParams<{ id: string }>();
  const avisar = useAviso();
  const [d, setD] = useState<DadosRecebimento | null>(null);
  const [falha, setFalha] = useState("");
  const [texto, setTexto] = useState<string | null>(null); // texto para copiar à mão, quando o navegador não deixa copiar
  const [imprimindo, setImprimindo] = useState(false);

  useEffect(() => {
    api<DadosRecebimento>(`/api/pedidos/${id}/recebimento`)
      .then(setD)
      .catch((e) => setFalha(mensagemDe(e)));
  }, [id]);

  const rel = useMemo(() => (d ? relatorioFornecedor(d.linhas) : null), [d]);

  if (falha)
    return (
      <Cartao>
        <p className="text-sm text-red-700">{falha}</p>
      </Cartao>
    );
  if (!d || !rel) return <Carregando />;

  const { pedido } = d;
  const moeda = moedaSimbolo(pedido.moeda);
  const valor = (v: number) => `${moeda} ${num(v)}`;

  async function imprimir() {
    setImprimindo(true);
    try {
      // As fotos carregam só quando aparecem na tela: antes de imprimir, carrega todas.
      await esperarImagens(document.querySelector(".relatorio-fornecedor"));
      window.print();
    } finally {
      setImprimindo(false);
    }
  }

  async function copiar() {
    const t = textoDoRelatorio(pedido.numero, pedido.fornecedor, rel!.itens, rel!.pecas, rel!.total, valor);
    try {
      if (!navigator.clipboard) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(t);
      avisar("Texto copiado. Cole no WhatsApp ou no WeChat do fornecedor.");
    } catch {
      setTexto(t); // no Wi-Fi da loja (http) o navegador não deixa copiar sozinho: mostra o texto para copiar
    }
  }

  return (
    <div className="relatorio-fornecedor flex flex-col gap-4">
      <style>{`@media print { @page { size: A4; margin: 12mm } main { padding: 0 !important; max-width: none !important } .relatorio-fornecedor { font-size: 11px } }`}</style>
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
        <Link href={`/pedidos/${id}`} className="text-sm text-[#9a8089]">
          ← Voltar ao pedido
        </Link>
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={copiar} disabled={!rel.itens.length}>
            Copiar texto
          </Botao>
          <Botao onClick={imprimir} carregando={imprimindo} disabled={!rel.itens.length}>
            Imprimir ou salvar PDF
          </Botao>
        </div>
      </div>

      {texto != null && (
        <Cartao className="nao-imprimir" titulo="Copie o texto">
          <textarea readOnly value={texto} rows={8} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <div className="mt-2 flex justify-end">
            <Botao variante="fantasma" onClick={() => setTexto(null)}>
              Fechar
            </Botao>
          </div>
        </Cartao>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Faltas e defeitos · 缺货及次品清单</h1>
          <p className="text-sm text-[#6b5560]">
            Pedido / 订单号 <b>{pedido.numero ?? "sem número"}</b>
            {pedido.dataCompra ? ` · compra / 下单 ${dataBr(pedido.dataCompra)}` : ""}
            {pedido.dataChegada ? ` · chegada / 到货 ${dataBr(pedido.dataChegada)}` : ""}
          </p>
          <p className="text-sm text-[#6b5560]">Fornecedor / 供应商: {pedido.fornecedor ?? "—"}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo-fiodeamor.png" alt="Fio de Amor Semijoias" className="h-14 w-auto" />
      </header>

      {pedido.recebimento !== "conferido" && (
        <p className="nao-imprimir rounded-xl bg-amber-50 p-3 text-sm text-amber-800">A conferência deste pedido ainda não foi concluída: o relatório pode mudar.</p>
      )}

      {rel.itens.length === 0 ? (
        <Cartao>
          <p className="text-sm text-[#6b5560]">Nenhuma falta ou defeito registrado na conferência.</p>
        </Cartao>
      ) : (
        <>
          {/* Celular: um cartão por peça */}
          <div className="flex flex-col gap-3 md:hidden print:hidden">
            {rel.itens.map((i) => (
              <div key={i.id} className="rounded-2xl border border-borda bg-white p-3">
                <div className="flex gap-2">
                  <Fotos i={i} lado={72} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-mono font-semibold">
                      {i.codigo || "—"}
                      {i.especificacao ? ` · ${i.especificacao}` : ""}
                    </div>
                    <div className="text-xs text-[#6b5560]">
                      pedido {i.pedida} · recebido {i.recebida}
                      {i.falta ? ` · faltou ${i.falta}` : ""}
                      {i.defeito ? ` · defeito ${i.defeito}` : ""}
                      {i.sobra ? ` · a mais ${i.sobra}` : ""}
                    </div>
                    {i.obs && <div className="text-xs">“{i.obs}”</div>}
                    <div className="mt-1">
                      {i.aCreditar} × {valor(i.preco)} = <b>{valor(i.valor)}</b>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Computador e impressão: tabela */}
          <div className="hidden overflow-x-auto md:block print:block">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Foto · 图片</th>
                  <th>Código · 货号</th>
                  <th>Especificação · 规格</th>
                  <th className="text-right">Pedido · 订购</th>
                  <th className="text-right">Recebido · 实收</th>
                  <th className="text-right">Falta · 欠货</th>
                  <th className="text-right">Defeito · 次品</th>
                  <th className="text-right">A creditar · 数量</th>
                  <th className="text-right">Preço · 单价</th>
                  <th className="text-right">Valor · 金额</th>
                </tr>
              </thead>
              <tbody>
                {rel.itens.map((i) => (
                  <tr key={i.id} className="break-inside-avoid">
                    <td>
                      <Fotos i={i} lado={64} />
                    </td>
                    <td className="font-mono font-semibold">
                      {i.codigo || "—"}
                      <div className="font-sans text-xs font-normal text-[#6b5560]">
                        #{i.linha ?? "?"} {i.nome}
                      </div>
                      {i.obs && <div className="font-sans text-xs font-normal">“{i.obs}”</div>}
                    </td>
                    <td className="font-mono">{i.especificacao || "—"}</td>
                    <td className="text-right">{i.pedida}</td>
                    <td className="text-right">{i.recebida}</td>
                    <td className="text-right">{i.falta || "—"}</td>
                    <td className="text-right">{i.defeito || "—"}</td>
                    <td className="text-right font-semibold">{i.aCreditar}</td>
                    <td className="whitespace-nowrap text-right">{valor(i.preco)}</td>
                    <td className="whitespace-nowrap text-right font-semibold">{valor(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="text-right font-semibold">
                    Total · 合计
                  </td>
                  <td className="text-right font-semibold">{rel.pecas}</td>
                  <td />
                  <td className="whitespace-nowrap text-right font-titulo text-lg font-semibold text-rose-escuro">{valor(rel.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Cartao className="md:hidden print:hidden">
            <div className="flex justify-between text-sm">
              <span>Total · 合计 ({rel.pecas} peças · 件)</span>
              <b className="font-titulo text-lg text-rose-escuro">{valor(rel.total)}</b>
            </div>
          </Cartao>

          <p className="text-sm">
            Pedimos o crédito no próximo pedido ou a reposição das peças acima. Obrigada!
            <br />
            请在下次订单中抵扣，或补发以上货品。谢谢！
          </p>
        </>
      )}
    </div>
  );
}

function Fotos({ i, lado }: { i: ItemRelatorio; lado: number }) {
  const estilo = { width: lado, height: lado };
  return (
    <div className="flex shrink-0 gap-1">
      {i.imagemId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img(i.imagemId, 200)!} alt="Foto do catálogo" loading="lazy" decoding="async" style={estilo} className="rounded-lg object-cover" />
      ) : (
        <div style={estilo} className="rounded-lg bg-rose-claro" />
      )}
      {i.defeitoImagemId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img(i.defeitoImagemId, 300)!} alt="Foto do defeito" loading="lazy" decoding="async" style={estilo} className="rounded-lg object-cover ring-2 ring-amber-400" />
      )}
    </div>
  );
}

/** Texto para colar no WhatsApp/WeChat (português e chinês). */
function textoDoRelatorio(numero: string | null, fornecedor: string | null, itens: ItemRelatorio[], pecas: number, total: number, valor: (v: number) => string) {
  const linhas = [`Pedido / 订单号 ${numero ?? "—"}${fornecedor ? ` — ${fornecedor}` : ""}`, "Faltas e defeitos / 缺货及次品:", ""];
  for (const i of itens) {
    const partes = [i.falta ? `falta/欠货 ${i.falta}` : "", i.defeito ? `defeito/次品 ${i.defeito}` : ""].filter(Boolean).join(", ");
    linhas.push(`${i.codigo || "—"}${i.especificacao ? ` (${i.especificacao})` : ""}: ${partes} → ${i.aCreditar} × ${valor(i.preco)} = ${valor(i.valor)}${i.obs ? ` — ${i.obs}` : ""}`);
  }
  linhas.push("", `Total / 合计: ${pecas} peças/件 · ${valor(total)}`, "", "Pedimos o crédito no próximo pedido ou a reposição. Obrigada!", "请在下次订单中抵扣，或补发以上货品。谢谢！");
  return linhas.join("\n");
}
