"use client";
import { useEffect, useState } from "react";
import { Carregando, Cartao } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/cliente";

type Doc = { id: string; titulo: string; texto: string };

export default function EspecialistasPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [aba, setAba] = useState("gestor-estoque");
  useEffect(() => {
    api<Doc[]>("/api/especialistas").then(setDocs);
  }, []);
  if (!docs) return <Carregando />;
  const doc = docs.find((d) => d.id === aba) ?? docs[0];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-4xl font-semibold">Especialistas</h1>
        <p className="max-w-3xl text-sm text-[#8a6d78]">
          Quatro especialistas (gestor de estoque, contador, administrador e marketing) definiram as regras do app: taxonomia, códigos,
          NCM, custo de importação, precificação, identidade visual e nomes. Eles também avaliam cada pedido importado (botão “Parecer dos
          especialistas” no pedido) e estão disponíveis como subagentes do Claude Code em <code>.claude/agents/</code>.
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {docs.map((d) => (
          <button key={d.id} onClick={() => setAba(d.id)} className={`rounded-full px-3 py-1 text-sm ${aba === d.id ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
            {d.titulo}
          </button>
        ))}
      </div>
      <Cartao>
        <Markdown texto={doc.texto} />
      </Cartao>
    </div>
  );
}
