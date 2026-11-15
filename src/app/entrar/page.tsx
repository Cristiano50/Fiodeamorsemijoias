"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Botao, Carregando } from "@/components/ui";
import { api } from "@/lib/cliente";
import { MENSAGEM_ABERTO_REMOTO, caminhoInterno } from "@/lib/acesso";

function Entrar() {
  const router = useRouter();
  const params = useSearchParams();
  const [modo, setModo] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  // Só caminho do próprio app: "voltar=//outro-site" ou "voltar=https://…" vai para o início.
  const voltar = caminhoInterno(params.get("voltar"));

  useEffect(() => {
    api<{ modo: string; local?: boolean }>("/api/sessao?modo=1")
      .then((r) => (r.modo === "aberto" && r.local ? router.replace(voltar) : setModo(r.modo)))
      .catch(() => setModo("usuarios"));
  }, [router, voltar]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro("");
    try {
      await api("/api/login", { method: "POST", json: { login, senha } });
      router.replace(voltar);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-rose-claro to-creme p-4">
      <form onSubmit={enviar} className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo-fiodeamor.png" alt="Fio de Amor Semijoias" className="mx-auto mb-6 w-56" />
        {!modo ? (
          <Carregando />
        ) : modo === "aberto" ? (
          // Acesso livre (sem usuários e sem senha): só o computador do servidor abre o app.
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{MENSAGEM_ABERTO_REMOTO}</p>
        ) : (
          <>
            {modo === "usuarios" && (
              <>
                <label className="rotulo">Usuário</label>
                <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} className="mb-3 mt-1" />
              </>
            )}
            <label className="rotulo">{modo === "senha" ? "Senha da equipe" : "Senha"}</label>
            <input
              type="password"
              autoFocus={modo === "senha"}
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1"
            />
            {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
            <Botao type="submit" carregando={carregando} className="mt-4 w-full">
              Entrar
            </Botao>
          </>
        )}
      </form>
    </div>
  );
}

export default function EntrarPage() {
  return (
    <Suspense>
      <Entrar />
    </Suspense>
  );
}
