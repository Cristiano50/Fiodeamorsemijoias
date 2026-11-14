"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Produto } from "@/lib/db/schema";
import { Botao, Cartao, useAviso } from "@/components/ui";
import { api, img } from "@/lib/cliente";
import { ean13Valido } from "@/lib/codigos-up";

/**
 * Bipar ou digitar o código de barras que o UP Vendas criou para cada peça do pedido.
 * O leitor de código de barras "digita" o número e aperta Enter: o app grava e pula para a próxima peça.
 * Recompras não aparecem: herdam o código da peça original.
 */
export function BiparCodigosUp({ produtos, aoGravar, aoFechar }: { produtos: Produto[]; aoGravar: () => void; aoFechar: () => void }) {
  const avisar = useAviso();
  // A lista é fixada ao abrir: a peça bipada continua na tela com o ✓ (o pedido recarrega por baixo).
  const [pendentes] = useState(() => produtos.filter((p) => !p.recompraDe && p.codigoBarrasOrigem !== "up"));
  const [valores, setValores] = useState<Record<string, string>>({});
  const [gravados, setGravados] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const campos = useRef<Record<string, HTMLInputElement | null>>({});

  async function gravar(p: Produto, i: number) {
    const codigo = (valores[p.id] ?? "").replace(/\s+/g, "");
    if (!codigo) return;
    // 13 dígitos com o dígito verificador errado: quase sempre erro de digitação (o leitor não erra).
    if (/^\d{13}$/.test(codigo) && !ean13Valido(codigo)) {
      avisar(`O código ${codigo} não confere (dígito verificador). Confira o número na etiqueta ou no cadastro do UP.`, "erro");
      campos.current[p.id]?.select();
      return;
    }
    setSalvando(p.id);
    try {
      await api(`/api/produtos/${p.id}`, { method: "PATCH", json: { codigoBarras: codigo } });
      setGravados((g) => ({ ...g, [p.id]: codigo }));
      const proximo = pendentes.slice(i + 1).find((x) => !gravados[x.id]);
      if (proximo) campos.current[proximo.id]?.focus();
      aoGravar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
      campos.current[p.id]?.select();
    } finally {
      setSalvando(null);
    }
  }

  const feitos = Object.keys(gravados).length;
  return (
    <Cartao
      titulo={`Códigos de barras do UP (${feitos} de ${pendentes.length})`}
      acoes={
        <Botao variante="fantasma" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <p className="mb-3 text-sm text-[#6b5560]">
        Depois de cadastrar no UP, bipe (ou digite) o código de barras que o UP criou para cada peça e aperte Enter. Para muitas peças, é mais rápido
        importar a lista de produtos do UP em <Link href="/up-vendas" className="text-rose-escuro underline">UP Vendas → Códigos de barras do UP</Link>.
      </p>
      {!pendentes.length ? (
        <p className="text-sm text-emerald-700">Todas as peças deste pedido já têm o código do UP.</p>
      ) : (
        <div className="flex max-h-[60vh] flex-col divide-y divide-borda overflow-auto">
          {pendentes.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.imagemId ? <img src={img(p.imagemId, 120)!} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-rose-claro" />}
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium uppercase">{p.nome ?? p.traducao ?? "Peça"}</div>
                <div className="font-mono text-xs text-[#9a8089]">
                  {p.referencia ?? "sem referência"}
                  {p.variacao ? ` · ${p.variacao}` : ""} · linha {p.linha}
                </div>
              </div>
              {gravados[p.id] ? (
                <span className="font-mono text-sm text-emerald-700">✓ {gravados[p.id]}</span>
              ) : (
                <input
                  ref={(el) => {
                    campos.current[p.id] = el;
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="bipe o código do UP"
                  className="w-48 font-mono"
                  value={valores[p.id] ?? ""}
                  disabled={salvando === p.id || !p.referencia}
                  title={!p.referencia ? "Gere a referência antes" : undefined}
                  onChange={(e) => setValores((v) => ({ ...v, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      gravar(p, i);
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Cartao>
  );
}
