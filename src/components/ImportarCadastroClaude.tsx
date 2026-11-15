"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Botao, Cartao, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";

type Pacote = { formato: string; versao: number; id: string; pedido: { numero?: string | null; fornecedor?: string | null }; itens: unknown[] };
type Resposta = {
  pedidoId: string;
  concluido: boolean;
  recebidos: number;
  recompras: number;
  aConfirmar?: number;
  jaImportado: boolean;
  avisos: string[];
  referenciasTrocadas: unknown[];
};

/** Divide os itens em partes de até ~3 MB (limite de 4,5 MB por requisição na Vercel). */
export function dividirEmPartes<T>(itens: T[], limite = 3_000_000): T[][] {
  const partes: T[][] = [];
  let atual: T[] = [];
  let tamanho = 0;
  for (const it of itens) {
    const t = JSON.stringify(it).length;
    if (atual.length && tamanho + t > limite) {
      partes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(it);
    tamanho += t;
  }
  if (atual.length || !partes.length) partes.push(atual);
  return partes;
}

/** "Importar pedido → Cadastro feito no Claude": recebe o arquivo cadastro-….json que a skill entrega. */
export function ImportarCadastroClaude() {
  const avisar = useAviso();
  const router = useRouter();
  const [progresso, setProgresso] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);

  async function importar(arquivo: File) {
    setOcupado(true);
    try {
      let pacote: Pacote;
      try {
        pacote = JSON.parse(await arquivo.text()) as Pacote;
      } catch {
        throw new Error("O arquivo não é um JSON válido. Use o cadastro-….json que a skill entregou.");
      }
      if (pacote.formato !== "fiodeamor-cadastro") throw new Error("Este arquivo não é um cadastro da skill do Claude.");
      const partes = dividirEmPartes(pacote.itens);
      let r: Resposta | null = null;
      const avisos: string[] = []; // de todas as partes (a 1ª traz os da cotação e do fator do pedido)
      for (let i = 0; i < partes.length; i++) {
        setProgresso(`Enviando parte ${i + 1} de ${partes.length}…`);
        r = await api<Resposta>("/api/skill/cadastro", {
          method: "POST",
          json: { ...pacote, itens: partes[i], parte: i + 1, partes: partes.length, totalItens: pacote.itens.length },
        });
        avisos.push(...r.avisos);
        if (r.jaImportado) break;
      }
      if (!r) return;
      avisar(
        r.jaImportado
          ? "Este cadastro já estava no app; abri o pedido."
          : `Cadastro importado: ${r.recebidos} peça(s)${r.recompras ? `, ${r.recompras} recompra(s)` : ""}${r.aConfirmar ? `, ${r.aConfirmar} recompra(s) a confirmar` : ""}.${avisos.length ? " Veja os avisos." : ""}`,
      );
      for (const a of [...new Set(avisos)]) avisar(a, "erro");
      router.push(`/pedidos/${r.pedidoId}`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado(false);
      setProgresso("");
    }
  }

  return (
    <Cartao titulo="Cadastro feito no Claude">
      <div className="flex flex-col gap-2 text-sm text-[#6b5560]">
        <p>
          Fez o cadastro com a skill <b className="font-mono">fiodeamor-cadastro</b> no Claude? Envie aqui o arquivo <span className="font-mono">cadastro-….json</span> que ela
          entregou: o pedido entra com fotos, nomes, classificação, referências e preços, e o app confere a recompra. Na versão conectada da skill, isso
          acontece sozinho. <Link href="/configuracoes" className="text-rose-escuro underline">Configurações → Skill do Claude</Link>
        </p>
        <label className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".json,application/json" disabled={ocupado} onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
          {ocupado && <Botao carregando>{progresso || "Importando…"}</Botao>}
        </label>
      </div>
    </Cartao>
  );
}
