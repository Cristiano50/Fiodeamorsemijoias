"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Carregando, Cartao, Selo } from "@/components/ui";
import { api } from "@/lib/cliente";

type Registro = { id: number; criadoEm: string; usuarioNome: string | null; acao: string; entidade: string | null; entidadeId: string | null; resumo: string };

const COR: Record<string, "rose" | "verde" | "amarelo" | "vermelho" | "cinza" | "dourado"> = {
  pedido: "rose",
  produto: "dourado",
  config: "amarelo",
  usuario: "cinza",
  lote_vendas: "verde",
};

export default function HistoricoPage() {
  const [lista, setLista] = useState<Registro[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => api<Registro[]>(`/api/historico?q=${encodeURIComponent(q)}`).then(setLista), 250);
    return () => clearTimeout(t);
  }, [q]);
  const link = (r: Registro) =>
    r.entidade === "pedido" && r.entidadeId ? `/pedidos/${r.entidadeId}` : r.entidade === "produto" && r.entidadeId ? `/produtos/${r.entidadeId}` : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Histórico</h1>
          <p className="text-sm text-[#8a6d78]">Quem mudou fator, frete, cotação, preço, código, configurações, usuários e o que foi excluído ou enviado ao UP.</p>
        </div>
        <input placeholder="Buscar (ex.: fator, BR_2611, nome da pessoa)…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
      </div>
      <Cartao>
        {!lista ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <p className="text-sm text-[#8a6d78]">Nada registrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O quê</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs">{new Date(r.criadoEm).toLocaleString("pt-BR")}</td>
                    <td className="whitespace-nowrap">{r.usuarioNome ?? "—"}</td>
                    <td>
                      <Selo cor={COR[r.entidade ?? ""] ?? "cinza"}>{r.acao}</Selo>
                    </td>
                    <td className="text-sm">
                      {link(r) ? (
                        <Link href={link(r)!} className="hover:underline">
                          {r.resumo}
                        </Link>
                      ) : (
                        r.resumo
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}
