"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Botao } from "@/components/ui";
import { api } from "@/lib/cliente";

function Entrar() {
  const router = useRouter();
  const params = useSearchParams();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro("");
    try {
      await api("/api/login", { method: "POST", json: { senha } });
      router.replace(params.get("voltar") || "/");
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
        <label className="rotulo">Senha</label>
        <input type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} className="mt-1" />
        {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
        <Botao type="submit" carregando={carregando} className="mt-4 w-full">
          Entrar
        </Botao>
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
