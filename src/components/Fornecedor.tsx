"use client";
import { useState } from "react";
import { Botao, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";

/** Apelido da loja com o nome original (ex.: em chinês) ao lado; sem apelido, só o original. */
export function NomeFornecedor({ nome, apelido, vazio = "Fornecedor não informado" }: { nome: string | null | undefined; apelido?: string | null; vazio?: string }) {
  if (!nome) return <span className="text-[#9a8089]">{vazio}</span>;
  if (!apelido) return <span title={nome}>{nome}</span>;
  return (
    <span title={`Nome original (usado na recompra): ${nome}`}>
      {apelido} <span className="text-[#9a8089]">· {nome}</span>
    </span>
  );
}

/**
 * Renomear o fornecedor no pedido: grava só o apelido (vale para todos os pedidos dele).
 * O nome original continua guardado e é o que a recompra usa para achar as peças já compradas.
 */
export function RenomearFornecedor({ nome, apelido, aoSalvar }: { nome: string | null; apelido: string | null; aoSalvar: () => void }) {
  const avisar = useAviso();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(apelido ?? "");
  const [salvando, setSalvando] = useState(false);

  if (!nome) return <NomeFornecedor nome={nome} />;

  async function salvar(novo: string) {
    setSalvando(true);
    try {
      const r = await api<{ apelido: string | null }>("/api/fornecedores", { method: "PUT", json: { nome, apelido: novo } });
      avisar(r.apelido ? `Fornecedor renomeado para “${r.apelido}”. O nome original continua guardado para a recompra.` : "Apelido removido: volta a aparecer o nome original.");
      setEditando(false);
      aoSalvar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  if (!editando)
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <NomeFornecedor nome={nome} apelido={apelido} />
        <button
          type="button"
          onClick={() => {
            setValor(apelido ?? "");
            setEditando(true);
          }}
          className="text-xs text-rose-escuro underline"
        >
          {apelido ? "renomear" : "dar um nome"}
        </button>
      </span>
    );

  return (
    <span className="mt-1 flex w-full max-w-xl flex-col gap-2 rounded-xl border border-borda bg-white p-3 text-sm">
      <span className="text-xs text-[#8a6d78]">
        Nome original (fica guardado para a recompra): <b className="text-[#4a3540]">{nome}</b>
      </span>
      <span className="flex flex-wrap gap-2">
        <input
          autoFocus
          value={valor}
          maxLength={80}
          placeholder="Ex.: Fornecedor Guangzhou (brincos)"
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar(valor);
            if (e.key === "Escape") setEditando(false);
          }}
          className="min-w-0 flex-1"
        />
        <Botao carregando={salvando} onClick={() => salvar(valor)}>
          Salvar
        </Botao>
        <Botao variante="fantasma" onClick={() => setEditando(false)}>
          Cancelar
        </Botao>
      </span>
      {apelido && (
        <button type="button" onClick={() => salvar("")} className="self-start text-xs text-[#8a6d78] underline">
          Remover o apelido e mostrar só o nome original
        </button>
      )}
      <span className="text-xs text-[#9a8089]">O apelido vale para todos os pedidos deste fornecedor.</span>
    </span>
  );
}
