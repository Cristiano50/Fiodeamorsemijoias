"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Botao, Cartao, Selo, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";
import type { CAMPOS_CODIGOS_UP, MapeamentoCodigos, ResultadoCodigos } from "@/lib/codigos-up";

type Resposta = {
  arquivoNome: string;
  cabecalhos: string[];
  mapeamento: MapeamentoCodigos;
  campos: typeof CAMPOS_CODIGOS_UP;
  amostra: string[][];
  resultado: ResultadoCodigos | null;
  faltaColuna?: boolean;
  saldos?: number; // linhas com saldo de estoque (coluna opcional)
  aplicados?: number;
  trocados?: number;
  saldosGravados?: number;
  falhas?: string[];
};

async function enviar(arquivo: File, mapeamento: MapeamentoCodigos | null, aplicar: boolean, trocar: string[] = []): Promise<Resposta> {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  if (mapeamento) fd.append("mapeamento", JSON.stringify(mapeamento));
  if (aplicar) fd.append("aplicar", "1");
  if (trocar.length) fd.append("trocar", JSON.stringify(trocar));
  const r = await fetch("/api/upvendas/codigos", { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`);
  return j as Resposta;
}

/**
 * Traz para o app o código de barras que o UP Vendas criou no cadastro de cada peça.
 * A loja exporta a lista de produtos do UP (referência + código de barras) e envia aqui.
 * Variação em dúvida fica pendente (bipar à mão); código do UP já gravado só troca com a confirmação da gestora.
 */
export function ImportarCodigosUp({ aoAplicar }: { aoAplicar?: () => void }) {
  const avisar = useAviso();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [r, setR] = useState<Resposta | null>(null);
  const [ocupado, setOcupado] = useState<"" | "previa" | "gravar">("");
  const [trocar, setTrocar] = useState<Set<string>>(new Set());
  const [gestora, setGestora] = useState(false);
  useEffect(() => {
    api<{ usuario: { papel: string } | null }>("/api/sessao")
      .then((s) => setGestora(!s.usuario || s.usuario.papel === "gestora"))
      .catch(() => {});
  }, []);

  async function previa(f: File, mapa: MapeamentoCodigos | null) {
    setOcupado("previa");
    try {
      setR(await enviar(f, mapa, false));
      setTrocar(new Set());
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
      const x = await enviar(arquivo, r.mapeamento, true, [...trocar]);
      const partes = [
        `${x.aplicados ?? 0} código(s) do UP gravado(s)`,
        x.trocados ? `${x.trocados} trocado(s)` : "",
        x.saldosGravados ? `saldo de ${x.saldosGravados} código(s) atualizado` : "",
      ].filter(Boolean);
      avisar(`${partes.join("; ")}${x.falhas?.length ? `; ${x.falhas.length} com problema` : ""}.`, x.falhas?.length ? "erro" : undefined);
      aoAplicar?.();
      // Mostra o resultado já gravado (tudo "igual"), mantendo a lista do que não deu certo.
      const depois = await enviar(arquivo, x.mapeamento, false);
      setR({ ...depois, falhas: x.falhas });
      setTrocar(new Set());
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const res = r?.resultado;
  const trocas = res?.conflitos.filter((c) => c.troca) ?? [];
  const outrosConflitos = res?.conflitos.filter((c) => !c.troca) ?? [];
  const algoParaGravar = !!res && (res.atualizar.length > 0 || trocar.size > 0 || (r?.saldos ?? 0) > 0);
  return (
    <Cartao titulo="Códigos de barras do UP">
      <div className="flex flex-col gap-3 text-sm">
        <ol className="list-decimal pl-5 text-[#6b5560]">
          <li>Cadastre as peças no UP (planilha acima). A planilha vai <b>sem código de barras</b> para o UP criar o dele.</li>
          <li>
            No UP, exporte a <b>lista de produtos</b> em Excel ou CSV com as colunas <b>Referência</b> e <b>Código de barras</b> (se tiver, também Código externo,
            Descrição da grade e <b>Saldo/Estoque</b>).
          </li>
          <li>Envie o arquivo aqui. O app liga cada código à peça pela referência, mostra o que vai mudar e só grava quando você confirmar.</li>
        </ol>
        <p className="text-xs text-[#9a8089]">
          O código do UP vale também para as recompras da peça. Quando o app não tem certeza de qual variação (cor/tamanho) é, a peça fica pendente para bipar
          no pedido ou na ficha da peça. Com a coluna de saldo, o app guarda o estoque do UP para comparar com o do app.
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
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
                  {res.pendentes.length > 0 && <Selo cor="amarelo">{res.pendentes.length} peça(s) para bipar</Selo>}
                  {trocas.length > 0 && <Selo cor="vermelho">{trocas.length} troca(s) de código do UP</Selo>}
                  {outrosConflitos.length > 0 && <Selo cor="vermelho">{outrosConflitos.length} com conflito</Selo>}
                  {res.ignoradas.length > 0 && <Selo cor="cinza">{res.ignoradas.length} linha(s) ignorada(s)</Selo>}
                  {(r.saldos ?? 0) > 0 && <Selo cor="verde">saldo de {r.saldos} código(s)</Selo>}
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

                {trocas.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <b className="text-red-800">A peça já tem outro código do UP — só troca se você confirmar</b>
                      {gestora ? (
                        <Botao variante="secundario" onClick={() => setTrocar(trocar.size === trocas.length ? new Set() : new Set(trocas.map((c) => c.troca!.produtoId)))}>
                          {trocar.size === trocas.length ? "Desmarcar todas" : "Trocar todas"}
                        </Botao>
                      ) : (
                        <span className="text-xs text-[#9a8089]">Só a gestora pode trocar um código do UP.</span>
                      )}
                    </div>
                    <div className="max-h-60 overflow-auto">
                      <table className="tabela w-full text-xs">
                        <thead>
                          <tr>
                            <th>Trocar</th>
                            <th>Referência</th>
                            <th>Peça</th>
                            <th>Código atual (UP)</th>
                            <th>Código da planilha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trocas.map((c) => (
                            <tr key={c.troca!.produtoId}>
                              <td>
                                <input
                                  type="checkbox"
                                  disabled={!gestora}
                                  checked={trocar.has(c.troca!.produtoId)}
                                  onChange={() =>
                                    setTrocar((s) => {
                                      const n = new Set(s);
                                      if (n.has(c.troca!.produtoId)) n.delete(c.troca!.produtoId);
                                      else n.add(c.troca!.produtoId);
                                      return n;
                                    })
                                  }
                                />
                              </td>
                              <td className="font-mono">{c.troca!.referencia}</td>
                              <td>
                                {c.troca!.nome ?? "—"}
                                {c.troca!.variacao ? <span className="text-[#9a8089]"> · {c.troca!.variacao}</span> : null}
                              </td>
                              <td className="font-mono">{c.troca!.atual}</td>
                              <td className="font-mono font-semibold">{c.troca!.novo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {res.pendentes.length > 0 && (
                  <details className="text-xs" open>
                    <summary className="cursor-pointer text-[#6b5560]">Pendentes — bipar à mão ({res.pendentes.length})</summary>
                    <p className="mt-1 text-[#9a8089]">
                      A planilha tem mais (ou menos) variações desta referência do que o app e não deu para saber qual código é de qual cor/tamanho. Bipe o
                      código na ficha da peça ou em &quot;Códigos do UP&quot; no pedido.
                    </p>
                    <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-[#6b5560]">
                      {res.pendentes.slice(0, 300).map((x) => (
                        <li key={x.id}>
                          <Link href={`/produtos/${x.id}`} className="font-mono text-rose-escuro underline">
                            {x.referencia}
                          </Link>{" "}
                          {x.nome ?? ""}
                          {[x.variacao, x.especificacao].filter(Boolean).length ? ` · ${[x.variacao, x.especificacao].filter(Boolean).join(" · ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {[
                  ["Sem peça no app", res.semPar.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.motivo}`)],
                  ["Em dúvida (mais de uma variação com a mesma referência; grave na ficha da peça)", res.ambiguas.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.opcoes.map((o) => o.variacao ?? o.nome).join(" / ")}`)],
                  ["Conflitos", outrosConflitos.map((x) => `linha ${x.linha}: ${x.referencia} (${x.codigoBarras}) — ${x.motivo}`)],
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
                  <Botao onClick={gravar} carregando={ocupado === "gravar"} disabled={!algoParaGravar}>
                    Gravar {res.atualizar.length} código(s) do UP
                    {trocar.size ? ` e trocar ${trocar.size}` : ""}
                    {(r.saldos ?? 0) > 0 ? " e o saldo" : ""}
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
