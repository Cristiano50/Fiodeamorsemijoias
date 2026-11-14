"use client";
import { useCallback, useEffect, useState } from "react";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "./ui";
import { api } from "@/lib/cliente";

type Usuario = { id: string; nome: string; login: string; papel: "gestora" | "funcionario"; ativo: boolean; criadoEm: string };

/** Usuários e permissões (Configurações → Usuários). */
export function ConfigUsuarios() {
  const avisar = useAviso();
  const [modo, setModo] = useState<string | null>(null);
  const [lista, setLista] = useState<Usuario[]>([]);
  const [novo, setNovo] = useState({ nome: "", login: "", senha: "", papel: "funcionario" });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(
    () =>
      api<{ modo: string }>("/api/sessao").then(async (s) => {
        setModo(s.modo);
        if (s.modo === "usuarios") setLista(await api<Usuario[]>("/api/usuarios"));
      }),
    [],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  async function criar() {
    setSalvando(true);
    try {
      const r = await api<{ primeiro?: boolean }>("/api/usuarios", { method: "POST", json: novo });
      avisar(r.primeiro ? "Conta da gestora criada. A partir de agora o app pede login." : "Usuário criado.");
      setNovo({ nome: "", login: "", senha: "", papel: "funcionario" });
      if (r.primeiro) window.location.reload();
      else carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const alterar = async (id: string, dados: Partial<Usuario> & { senha?: string }, msg: string) => {
    try {
      await api("/api/usuarios", { method: "PATCH", json: { id, ...dados } });
      avisar(msg);
      carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  };

  if (!modo) return <Carregando />;
  const primeiro = modo !== "usuarios";
  return (
    <div className="flex flex-col gap-4">
      <Cartao titulo="Permissões">
        <ul className="ml-5 list-disc text-sm text-[#6b5560]">
          <li>
            <b>Gestora:</b> tudo, incluindo Configurações, fator abaixo do mínimo, excluir pedidos e produtos, enviar ao UP, histórico, gastos com IA e backup.
          </li>
          <li>
            <b>Funcionário(a):</b> importar pedidos, revisar peças, escolher o fator (a partir do mínimo), gerar fotos, etiquetas, planilha, vendas e maleta.
          </li>
          <li>Toda alteração de fator, frete, cotação, preço, código e exclusão fica no Histórico, com o nome de quem fez.</li>
        </ul>
        {primeiro && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Hoje o app está {modo === "senha" ? "com a senha única da equipe" : "aberto, sem login"}. Crie a <b>conta da gestora</b> abaixo: a partir daí cada pessoa entra com o seu
            usuário e senha.
          </p>
        )}
      </Cartao>

      <Cartao titulo={primeiro ? "Criar a conta da gestora" : "Novo usuário"}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Campo rotulo="Nome">
            <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </Campo>
          <Campo rotulo="Usuário (login)">
            <input value={novo.login} autoComplete="off" onChange={(e) => setNovo({ ...novo, login: e.target.value.toLowerCase().replace(/\s/g, "") })} />
          </Campo>
          <Campo rotulo="Senha (mín. 6)">
            <input type="password" autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
          </Campo>
          <Campo rotulo="Papel">
            <select value={primeiro ? "gestora" : novo.papel} disabled={primeiro} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
              <option value="funcionario">Funcionário(a)</option>
              <option value="gestora">Gestora</option>
            </select>
          </Campo>
          <div className="flex items-end">
            <Botao onClick={criar} carregando={salvando} className="w-full">
              {primeiro ? "Criar gestora" : "Criar usuário"}
            </Botao>
          </div>
        </div>
      </Cartao>

      {!primeiro && (
        <Cartao titulo={`Usuários (${lista.length})`}>
          <table className="tabela w-full">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Login</th>
                <th>Papel</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id}>
                  <td>{u.nome}</td>
                  <td className="font-mono text-xs">{u.login}</td>
                  <td>
                    <select
                      value={u.papel}
                      className="w-40"
                      onChange={(e) => alterar(u.id, { papel: e.target.value as Usuario["papel"] }, "Papel alterado.")}
                    >
                      <option value="funcionario">Funcionário(a)</option>
                      <option value="gestora">Gestora</option>
                    </select>
                  </td>
                  <td>{u.ativo ? <Selo cor="verde">ativo</Selo> : <Selo cor="cinza">desativado</Selo>}</td>
                  <td className="whitespace-nowrap">
                    <Botao
                      variante="fantasma"
                      onClick={() => {
                        const senha = prompt(`Nova senha para ${u.nome} (mín. 6 caracteres):`);
                        if (senha) alterar(u.id, { senha }, "Senha trocada.");
                      }}
                    >
                      Trocar senha
                    </Botao>
                    <Botao variante={u.ativo ? "perigo" : "secundario"} onClick={() => alterar(u.id, { ativo: !u.ativo }, u.ativo ? "Usuário desativado." : "Usuário reativado.")}>
                      {u.ativo ? "Desativar" : "Reativar"}
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
      )}
    </div>
  );
}
