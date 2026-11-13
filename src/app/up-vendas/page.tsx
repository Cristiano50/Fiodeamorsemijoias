"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig, type ConfigCliente } from "@/components/hooks";
import { api, brl } from "@/lib/cliente";

type Resultado = { id: string; referencia: string | null; ok: boolean; mensagem: string; payload?: unknown };
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

  useEffect(() => {
    const ids = params.get("ids");
    const pedido = params.get("pedido");
    const url = pedido ? `/api/produtos?pedido=${pedido}&limite=2000` : `/api/produtos?limite=2000${ids ? "" : "&status=aprovado"}`;
    api<Produto[]>(url).then((l) => setProdutos(ids ? l.filter((p) => ids.split(",").includes(p.id)) : l));
  }, [params]);

  async function salvar() {
    setOcupado("salvar");
    try {
      const mapaCampos = JSON.parse(mapa);
      await api("/api/config", { method: "PUT", json: { chave: "upvendas", valor: { ...cfg, mapaCampos } } });
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

  async function enviar(simular: boolean) {
    setOcupado(simular ? "simular" : "enviar");
    try {
      const r = await api<{ resultados: Resultado[] }>("/api/upvendas/enviar", { method: "POST", json: { ids: produtos.map((p) => p.id), simular } });
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
  const ids = produtos.map((p) => p.id).join(",");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-4xl font-semibold">UP Vendas</h1>
        <p className="max-w-3xl text-sm text-[#8a6d78]">
          O UP Vendas não publica a documentação da API de produtos. O conector abaixo é configurável: peça ao suporte do UP a documentação
          da API de cadastro de produtos e um usuário de integração, e ajuste os caminhos e o mapa de campos. Enquanto isso, use a{" "}
          <b>planilha</b> com os mesmos campos da tela “Cadastro de Produtos Simplificado”.
        </p>
      </div>

      <Cartao titulo={`Produtos para enviar (${produtos.length})`} acoes={
        <>
          <a href={`/api/exportar?formato=xlsx&ids=${ids}`}>
            <Botao variante="secundario">Planilha XLSX</Botao>
          </a>
          <a href={`/api/exportar?formato=csv&ids=${ids}`}>
            <Botao variante="secundario">CSV</Botao>
          </a>
          <Botao variante="secundario" onClick={() => enviar(true)} carregando={ocupado === "simular"} disabled={!produtos.length}>
            Simular envio
          </Botao>
          <Botao onClick={() => enviar(false)} carregando={ocupado === "enviar"} disabled={!produtos.length || !cfg.ativo}>
            Enviar ao UP
          </Botao>
        </>
      }>
        {!cfg.ativo && <p className="mb-3 text-sm text-amber-800">A integração por API está desligada. Ative abaixo depois de configurar e testar a conexão.</p>}
        <div className="max-h-[50vh] overflow-auto">
          <table className="tabela w-full">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Nome</th>
                <th>EAN</th>
                <th>Preço</th>
                <th>Estoque</th>
                <th>Status UP</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => {
                const r = resultados.find((x) => x.id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.referencia ?? "—"}</td>
                    <td>
                      <Link href={`/produtos/${p.id}`} className="hover:underline">
                        {p.nome}
                      </Link>
                    </td>
                    <td className="font-mono text-xs">{p.codigoBarras}</td>
                    <td>{brl(p.precoVenda)}</td>
                    <td>{p.quantidade}</td>
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
            </tbody>
          </table>
        </div>
      </Cartao>

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
