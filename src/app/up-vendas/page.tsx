"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig, type ConfigCliente } from "@/components/hooks";
import { api, brl } from "@/lib/cliente";
import { ImportarCodigosUp } from "@/components/ImportarCodigosUp";
import { CodigoBarrasCelula } from "@/components/CodigoBarrasCelula";
import { estoqueEntrada } from "@/lib/estoque";
import { codigoParaUp } from "@/lib/upvendas-codigo";
import { linhasRecompraUp, separarParaUp } from "@/lib/upvendas-planilha";

type Resultado = { id: string; referencia: string | null; ok: boolean; mensagem: string; recompra?: boolean; payload?: unknown };
type UpCfg = {
  ativo: boolean;
  baseUrl: string;
  dominio: string;
  usuario: string;
  caminhoLogin: string;
  caminhoProdutos: string;
  metodoCriar: string;
  campoToken: string;
  empresa: string;
  tabelaPreco: string;
  mapaCampos: Record<string, string>;
};

function UpVendasConteudo() {
  const { config, recarregar } = useConfig();
  if (!config) return <Carregando />;
  return <UpVendasTela config={config} recarregar={recarregar} />;
}

function UpVendasTela({ config, recarregar }: { config: ConfigCliente; recarregar: () => Promise<void> }) {
  const params = useSearchParams();
  const avisar = useAviso();
  const [cfg, setCfg] = useState<UpCfg>(() => config.upvendas as unknown as UpCfg);
  const [senha, setSenha] = useState("");
  const [mapa, setMapa] = useState(() => JSON.stringify((config.upvendas as unknown as UpCfg).mapaCampos, null, 2));
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [ocupado, setOcupado] = useState("");
  const [versao, setVersao] = useState(0); // recarrega a lista depois de importar os códigos do UP

  useEffect(() => {
    const ids = params.get("ids");
    const pedido = params.get("pedido");
    const url = pedido ? `/api/produtos?pedido=${pedido}&limite=2000` : `/api/produtos?limite=2000${ids ? "" : "&status=aprovado"}`;
    api<Produto[]>(url).then((l) => setProdutos(ids ? l.filter((p) => ids.split(",").includes(p.id)) : l));
  }, [params, versao]);

  async function salvar() {
    setOcupado("salvar");
    try {
      const mapaCampos = JSON.parse(mapa);
      // Trocar o endereço do UP apaga a senha salva (a senha não vai para um endereço novo sem ser digitada).
      const r = await api<{ aviso?: string }>("/api/config", { method: "PUT", json: { chave: "upvendas", valor: { ...cfg, mapaCampos } } });
      if (r?.aviso) avisar(r.aviso, "info");
      if (senha) await api("/api/config", { method: "PUT", json: { chave: "segredos", valor: { UPVENDAS_SENHA: senha } } });
      setSenha("");
      await recarregar();
      avisar("Configuração do UP Vendas salva.");
    } catch (e) {
      avisar(e instanceof SyntaxError ? "Mapa de campos não é um JSON válido." : e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  async function testar() {
    setOcupado("testar");
    try {
      const r = await api<{ mensagem: string }>("/api/upvendas/testar", { method: "POST" });
      avisar(r.mensagem);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  // Produtos novos (cadastro completo) × recompras (o produto já existe no UP: só entrada de estoque).
  const { novos, recompras } = separarParaUp(produtos);
  const ctxCodigo = { codigoNoUp: config.sistema.codigoNoUp === "code128" ? ("code128" as const) : ("ean13" as const), origemCodigoBarras: config.sistema.origemCodigoBarras === "app" ? ("app" as const) : ("upvendas" as const) };
  const entrada = linhasRecompraUp(recompras, ctxCodigo);
  const semConferencia = produtos.filter((p) => p.pedidoId && p.quantidadeRecebida == null).length;
  const aConfirmar = produtos.filter((p) => !p.recompraDe && (p.recompraCandidatas?.length ?? 0) > 0).length;
  // A planilha usa a mesma seleção da tela (pedido, peças escolhidas ou todos os aprovados); o servidor separa novos e recompras.
  const pedidoSel = params.get("pedido");
  const idsSel = params.get("ids");
  const selecao = pedidoSel ? `pedido=${encodeURIComponent(pedidoSel)}` : idsSel ? `ids=${encodeURIComponent(idsSel)}` : "status=aprovado";

  async function enviar(simular: boolean) {
    setOcupado(simular ? "simular" : "enviar");
    try {
      const r = await api<{ resultados: Resultado[] }>("/api/upvendas/enviar", { method: "POST", json: { ids: novos.map((p) => p.id), simular } });
      setResultados(r.resultados);
      const ok = r.resultados.filter((x) => x.ok).length;
      avisar(`${simular ? "Simulação" : "Envio"}: ${ok} de ${r.resultados.length} ok.`, ok === r.resultados.length ? "ok" : "erro");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  const set = (k: keyof UpCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCfg((c) => ({ ...c, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-4xl font-semibold">UP Vendas</h1>
        <p className="max-w-3xl text-sm text-[#8a6d78]">
          São duas planilhas: <b>produtos novos</b> (cadastro completo, com os mesmos campos da tela “Cadastro de Produtos Simplificado”) e <b>recompras</b> (peças que já
          existem no UP: só a entrada no estoque). A quantidade é sempre a que entrou na loja na conferência da chegada (recebidas − com defeito). O envio direto pela API é
          configurável: peça ao suporte do UP a documentação da API de cadastro de produtos e um usuário de integração.
        </p>
      </div>

      {(semConferencia > 0 || aConfirmar > 0) && (
        <div className="flex flex-col gap-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {semConferencia > 0 && <span>⚠ {semConferencia} peça(s) de pedido ainda sem conferência na chegada: a quantidade vai pela pedida. Confira a chegada no pedido antes, se a mercadoria já chegou.</span>}
          {aConfirmar > 0 && <span>⚠ {aConfirmar} peça(s) com recompra a confirmar no pedido: confirme antes de mandar ao UP (recompra não é cadastrada de novo).</span>}
        </div>
      )}

      <Cartao
        titulo={`1. Produtos novos (${novos.length})`}
        acoes={
          <>
            <a href={`/api/exportar?formato=xlsx&tipo=novos&${selecao}`} className={novos.length ? "" : "pointer-events-none opacity-50"}>
              <Botao variante="secundario">Planilha de produtos novos</Botao>
            </a>
            <a href={`/api/exportar?formato=csv&tipo=novos&${selecao}`} className={novos.length ? "" : "pointer-events-none opacity-50"}>
              <Botao variante="fantasma">CSV</Botao>
            </a>
            <Botao variante="secundario" onClick={() => enviar(true)} carregando={ocupado === "simular"} disabled={!novos.length}>
              Simular envio
            </Botao>
            <Botao onClick={() => enviar(false)} carregando={ocupado === "enviar"} disabled={!novos.length || !cfg.ativo}>
              Enviar ao UP
            </Botao>
          </>
        }
      >
        <p className="mb-3 text-sm text-[#6b5560]">
          <b>Como usar no UP:</b> importe esta planilha no cadastro de produtos (ou cadastre cada linha na tela “Cadastro de Produtos Simplificado”). O “Saldo Estoque” já é a
          quantidade que entrou. Depois, traga os códigos de barras que o UP criou (quadro “Códigos de barras do UP”, abaixo).
        </p>
        {!cfg.ativo && <p className="mb-3 text-sm text-amber-800">A integração por API está desligada. Ative abaixo depois de configurar e testar a conexão.</p>}
        <div className="max-h-[50vh] overflow-auto">
          <table className="tabela w-full min-w-[640px]">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Nome</th>
                <th>Código de barras</th>
                <th>Preço</th>
                <th>Saldo</th>
                <th>Status UP</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {novos.map((p) => {
                const r = resultados.find((x) => x.id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.referencia ?? "—"}</td>
                    <td>
                      <Link href={`/produtos/${p.id}`} className="hover:underline">
                        {p.nome}
                      </Link>
                    </td>
                    <td>
                      <CodigoBarrasCelula codigo={p.codigoBarras} origem={p.codigoBarrasOrigem} />
                    </td>
                    <td>{brl(p.precoVenda)}</td>
                    <td>
                      {estoqueEntrada(p)}
                      {p.quantidadeRecebida != null && estoqueEntrada(p) !== p.quantidade && <div className="text-xs text-[#9a8089]">pedido {p.quantidade}</div>}
                    </td>
                    <td>
                      <Selo cor={p.upStatus === "enviado" ? "verde" : p.upStatus === "erro" ? "vermelho" : "cinza"}>{p.upStatus ?? "—"}</Selo>
                    </td>
                    <td className="max-w-md text-xs">
                      {r && (
                        <>
                          <span className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.mensagem}</span>
                          {r.payload != null && (
                            <details>
                              <summary className="cursor-pointer text-[#9a8089]">JSON</summary>
                              <pre className="max-h-48 overflow-auto rounded bg-stone-50 p-2 text-[0.65rem]">{JSON.stringify(r.payload, null, 2)}</pre>
                            </details>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!novos.length && (
                <tr>
                  <td colSpan={7} className="text-sm text-[#9a8089]">
                    Nenhum produto novo nesta seleção.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Cartao>

      <Cartao
        titulo={`2. Recompras (${recompras.length})`}
        acoes={
          <>
            <a href={`/api/exportar?formato=xlsx&tipo=recompras&${selecao}`} className={entrada.linhas.length ? "" : "pointer-events-none opacity-50"}>
              <Botao variante="secundario">Planilha de recompras</Botao>
            </a>
            <a href={`/api/exportar?formato=csv&tipo=recompras&${selecao}`} className={entrada.linhas.length ? "" : "pointer-events-none opacity-50"}>
              <Botao variante="fantasma">CSV</Botao>
            </a>
          </>
        }
      >
        <p className="mb-3 text-sm text-[#6b5560]">
          <b>Como usar no UP:</b> estas peças já estão cadastradas no UP (mesmo código de barras). <b>Não cadastre de novo</b>: faça a entrada de estoque de cada código com a
          quantidade da planilha (bipe o código e digite a quantidade, ou importe a planilha na entrada de estoque, se o seu UP tiver essa opção).
        </p>
        {entrada.semCodigo > 0 && (
          <p className="mb-3 text-sm text-amber-800">
            ⚠ {entrada.semCodigo} recompra(s) sem o código de barras do UP: ache pela referência no UP ou traga os códigos (quadro “Códigos de barras do UP”).
          </p>
        )}
        {entrada.semEntrada > 0 && <p className="mb-3 text-xs text-[#9a8089]">{entrada.semEntrada} recompra(s) sem nenhuma peça que entrou ficaram fora da planilha.</p>}
        <div className="max-h-[50vh] overflow-auto">
          <table className="tabela w-full min-w-[520px]">
            <thead>
              <tr>
                <th>Código de barras</th>
                <th>Quantidade</th>
                <th>Referência</th>
                <th>Nome</th>
              </tr>
            </thead>
            <tbody>
              {recompras.map((p) => {
                const codigo = codigoParaUp(p, ctxCodigo);
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{codigo || <Selo cor="amarelo">sem código do UP</Selo>}</td>
                    <td>
                      <b>{estoqueEntrada(p)}</b>
                      {p.quantidadeRecebida != null && estoqueEntrada(p) !== p.quantidade && <span className="text-xs text-[#9a8089]"> (pedido {p.quantidade})</span>}
                    </td>
                    <td className="font-mono text-xs">{p.referencia ?? "—"}</td>
                    <td>
                      <Link href={`/produtos/${p.id}`} className="hover:underline">
                        {p.nome}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!recompras.length && (
                <tr>
                  <td colSpan={4} className="text-sm text-[#9a8089]">
                    Nenhuma recompra nesta seleção.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Cartao>

      <ImportarCodigosUp aoAplicar={() => setVersao((v) => v + 1)} />

      <Cartao titulo="Conexão com a API">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Campo rotulo="Integração ativa">
            <select value={cfg.ativo ? "1" : "0"} onChange={(e) => setCfg({ ...cfg, ativo: e.target.value === "1" })}>
              <option value="0">Não (só planilha)</option>
              <option value="1">Sim</option>
            </select>
          </Campo>
          <Campo rotulo="Servidor" className="md:col-span-3">
            <input value={cfg.baseUrl} onChange={set("baseUrl")} />
          </Campo>
          <Campo rotulo="Domínio">
            <input value={cfg.dominio} onChange={set("dominio")} />
          </Campo>
          <Campo rotulo="Usuário">
            <input value={cfg.usuario} onChange={set("usuario")} />
          </Campo>
          <Campo rotulo="Senha" dica={config.segredos.UPVENDAS_SENHA ? `definida (${config.segredos.UPVENDAS_SENHA}) — deixe em branco para manter` : "não definida"}>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
          </Campo>
          <Campo rotulo="Tabela de preço no UP">
            <input value={cfg.tabelaPreco} onChange={set("tabelaPreco")} />
          </Campo>
          <Campo rotulo="Caminho do login">
            <input value={cfg.caminhoLogin} onChange={set("caminhoLogin")} />
          </Campo>
          <Campo rotulo="Onde vem o token" dica='"header:Authorization" ou "json:token"'>
            <input value={cfg.campoToken} onChange={set("campoToken")} />
          </Campo>
          <Campo rotulo="Caminho de produtos">
            <input value={cfg.caminhoProdutos} onChange={set("caminhoProdutos")} />
          </Campo>
          <Campo rotulo="Método">
            <select value={cfg.metodoCriar} onChange={set("metodoCriar")}>
              <option>POST</option>
              <option>PUT</option>
            </select>
          </Campo>
          <Campo rotulo="Mapa de campos (app → UP), em JSON" className="md:col-span-4" dica="Use ponto para campos aninhados, ex.: grade.0.codigoBarras">
            <textarea rows={10} value={mapa} onChange={(e) => setMapa(e.target.value)} className="font-mono text-xs" />
          </Campo>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="secundario" onClick={testar} carregando={ocupado === "testar"}>
            Testar login
          </Botao>
          <Botao onClick={salvar} carregando={ocupado === "salvar"}>
            Salvar
          </Botao>
        </div>
      </Cartao>
    </div>
  );
}

export default function UpVendasPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <UpVendasConteudo />
    </Suspense>
  );
}
