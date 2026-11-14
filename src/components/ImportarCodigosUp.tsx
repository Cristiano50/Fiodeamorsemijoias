"use client";
import { useState } from "react";
import { Botao, Cartao, Selo, useAviso } from "@/components/ui";
import type { CAMPOS_CODIGOS_UP, MapeamentoCodigos, ResultadoCodigos } from "@/lib/codigos-up";

type Resposta = {
  arquivoNome: string;
  cabecalhos: string[];
  mapeamento: MapeamentoCodigos;
  campos: typeof CAMPOS_CODIGOS_UP;
  amostra: string[][];
  resultado: ResultadoCodigos | null;
  faltaColuna?: boolean;
  aplicados?: number;
  falhas?: string[];
};

async function enviar(arquivo: File, mapeamento: MapeamentoCodigos | null, aplicar: boolean): Promise<Resposta> {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  if (mapeamento) fd.append("mapeamento", JSON.stringify(mapeamento));
  if (aplicar) fd.append("aplicar", "1");
  const r = await fetch("/api/upvendas/codigos", { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`);
  return j as Resposta;
}

/**
 * Traz para o app o código de barras que o UP Vendas criou no cadastro de cada peça.
 * A loja exporta a lista de produtos do UP (referência + código de barras) e envia aqui.
 */
export function ImportarCodigosUp({ aoAplicar }: { aoAplicar?: () => void }) {
  const avisar = useAviso();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [r, setR] = useState<Resposta | null>(null);
  const [ocupado, setOcupado] = useState<"" | "previa" | "gravar">("");

  async function previa(f: File, mapa: MapeamentoCodigos | null) {
    setOcupado("previa");
    try {
      setR(await enviar(f, mapa, false));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function gravar() {
    if (!arquivo || !r) return;
    setOcupado("gravar");
    try {
      const x = await enviar(arquivo, r.mapeamento, true);
      setR(x);
      avisar(`${x.aplicados} código(s) do UP gravado(s)${x.falhas?.length ? `; ${x.falhas.length} com problema` : ""}.`, x.falhas?.length ? "erro" : undefined);
      aoAplicar?.();
      // Mostra o resultado já gravado (tudo "igual").
      setR(await enviar(arquivo, x.mapeamento, false));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const res = r?.resultado;
  return (
    <Cartao titulo="Códigos de barras do UP">
      <div className="flex flex-col gap-3 text-sm">
        <ol className="list-decimal pl-5 text-[#6b5560]">
          <li>Cadastre as peças no UP (planilha acima). A planilha vai <b>sem código de barras</b> para o UP criar o dele.</li>
          <li>
            No UP, exporte a <b>lista de produtos</b> em Excel ou CSV com as colunas <b>Referência</b> e <b>Código de barras</b> (se tiver, também Código externo e
            Descrição da grade).
          </li>
          <li>Envie o arquivo aqui. O app liga cada código à peça pela referência, mostra o que vai mudar e só grava quando você confirmar.</li>
        </ol>
        <p className="text-xs text-[#9a8089]">
          O código do UP vale também para as recompras da peça. Também dá para bipar ou digitar o código no pedido ou na ficha da peça.
        </p>
        <label className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setArquivo(f);
              setR(null);
              previa(f, null);
            }}
          />
          {ocupado === "previa" && <span className="text-xs text-[#9a8089]">Lendo…</span>}
        </label>

        {r && (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {r.campos.map((c) => (
                <label key={c.id} className="flex flex-col gap-1 text-xs">
                  <span className="rotulo">
                    {c.nome}
                    {c.obrigatorio ? " *" : ""}
                  </span>
                  <select
                    value={r.mapeamento[c.id] ?? ""}
                    onChange={(e) => {
                      const mapa = { ...r.mapeamento, [c.id]: e.target.value === "" ? undefined : Number(e.target.value) };
                      if (arquivo) previa(arquivo, mapa);
                    }}
                  >
                    <option value="">—</option>
                    {r.cabecalhos.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {r.faltaColuna && <p className="text-amber-800">Escolha as colunas de Referência e de Código de barras.</p>}

            {res && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Selo cor="verde">{res.atualizar.length} para gravar</Selo>
                  <Selo cor="cinza">{res.iguais} já iguais</Selo>
                  {res.semPar.length > 0 && <Selo cor="amarelo">{res.semPar.length} sem peça no app</Selo>}
                  {res.ambiguas.length > 0 && <Selo cor="amarelo">{res.ambiguas.length} em dúvida</Selo>}
                  {res.conflitos.length > 0 && <Selo cor="vermelho">{res.conflitos.length} com conflito</Selo>}
                  {res.ignoradas.length > 0 && <Selo cor="cinza">{res.ignoradas.length} linha(s) ignorada(s)</Selo>}
                  <Selo cor={res.semCodigoDoUp ? "amarelo" : "verde"}>{res.semCodigoDoUp} peça(s) do app ainda sem código do UP</Selo>
                </div>

                {res.atualizar.length > 0 && (
                  <div className="max-h-72 overflow-auto">
                    <table className="tabela w-full text-xs">
                      <thead>
                        <tr>
                          <th>Referência</th>
                          <th>Peça</th>
                          <th>Código atual</th>
                          <th>Código do UP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.atualizar.map((a) => (
                          <tr key={a.produtoId}>
                            <td className="font-mono">{a.referencia}</td>
                            <td>
                              {a.nome ?? "—"}
                              {a.variacao ? <span className="text-[#9a8089]"> · {a.variacao}</span> : null}
                            </td>
                            <td className="font-mono text-[#9a8089]">
                              {a.antes ?? "—"}
                              {a.antes && a.antesOrigem === "app" ? " (do app)" : ""}
                            </td>
                            <td className="font-mono font-semibold">{a.depois}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {[
                  ["Sem peça no app", res.semPar.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.motivo}`)],
                  ["Em dúvida (mais de uma variação com a mesma referência; grave na ficha da peça)", res.ambiguas.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.opcoes.map((o) => o.variacao ?? o.nome).join(" / ")}`)],
                  ["Conflitos", res.conflitos.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.motivo}`)],
                  ["Linhas ignoradas", res.ignoradas.map((x) => `linha ${x.linha}: ${x.motivo}`)],
                  ["Não gravados", r.falhas ?? []],
                ]
                  .filter(([, l]) => (l as string[]).length)
                  .map(([titulo, l]) => (
                    <details key={titulo as string} className="text-xs">
                      <summary className="cursor-pointer text-[#6b5560]">
                        {titulo as string} ({(l as string[]).length})
                      </summary>
                      <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-[#6b5560]">
                        {(l as string[]).slice(0, 300).map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </details>
                  ))}

                <div>
                  <Botao onClick={gravar} carregando={ocupado === "gravar"} disabled={!res.atualizar.length}>
                    Gravar {res.atualizar.length} código(s) do UP
                  </Botao>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Cartao>
  );
}
