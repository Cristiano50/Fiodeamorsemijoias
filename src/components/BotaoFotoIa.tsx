"use client";
import { useState } from "react";
import { useAviso } from "./ui";
import { api } from "@/lib/cliente";

type Resultado = { imagemId: string; aprovada: boolean | null; avaliacao: { nota: number; problemas?: string[] } | null; tentativas: unknown[] };

/** Botão "Criar foto com IA": gera a foto da peça no expositor e passa pela aprovação do marketing. */
export function BotaoFotoIa({ produtoId, aoTerminar, compacto = false }: { produtoId: string; aoTerminar?: (r: Resultado) => void; compacto?: boolean }) {
  const avisar = useAviso();
  const [gerando, setGerando] = useState(false);
  async function gerar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setGerando(true);
    try {
      const r = await api<Resultado>(`/api/produtos/${produtoId}/ia`, { method: "POST", json: {} });
      if (r.aprovada === null) avisar("Foto criada. Sem avaliação do marketing: configure a chave do Claude.", "info");
      else if (r.aprovada) avisar(`Foto aprovada pelo marketing — nota ${r.avaliacao?.nota.toFixed(1)}.`);
      else avisar(`Marketing não aprovou (nota ${r.avaliacao?.nota.toFixed(1)}): ${r.avaliacao?.problemas?.[0] ?? "veja no estúdio"}`, "erro");
      aoTerminar?.(r);
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
    } finally {
      setGerando(false);
    }
  }
  return (
    <button
      onClick={gerar}
      disabled={gerando}
      title="A IA cria a foto da peça no expositor e o marketing aprova"
      className={`inline-flex items-center justify-center gap-1 rounded-full bg-rose-escuro font-medium text-white transition hover:bg-[#7a4c5e] disabled:opacity-60 ${compacto ? "px-2 py-0.5 text-[0.65rem]" : "w-full px-3 py-1.5 text-xs"}`}
    >
      {gerando ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "✦"}
      {gerando ? "Criando…" : compacto ? "Foto IA" : "Criar foto com IA"}
    </button>
  );
}
