"use client";
import { useState } from "react";
import { Botao, Campo, Cartao, useAviso } from "@/components/ui";
import type { ConfigCliente } from "@/components/hooks";
import { api } from "@/lib/cliente";
import { numeroParaCampo } from "@/lib/numeros";
import { lerPercentual, lerValorPorPeca } from "@/lib/custo-real";

/**
 * Padrões de perdas/defeitos (%) e de embalagem/etiqueta (R$ por peça) dos pedidos novos (item 27).
 * Em cada pedido, a gestora muda no quadro "Custo verdadeiro". Pedidos já importados não mudam.
 *
 * Uso em Configurações → "Câmbio e custos": <ConfigCustosPadrao config={config} recarregar={recarregar} />
 * Salva o objeto "sistema" inteiro (PUT /api/config) partindo do config atual e chama recarregar().
 */
export function ConfigCustosPadrao({ config, recarregar }: { config: ConfigCliente; recarregar: () => Promise<void> }) {
  const avisar = useAviso();
  const sistema = config.sistema as unknown as Record<string, unknown>;
  const [perdas, setPerdas] = useState(() => numeroParaCampo(Number(sistema.perdasPctPadrao) || 0));
  const [embalagem, setEmbalagem] = useState(() => numeroParaCampo(Number(sistema.embalagemPorPecaPadrao) || 0));
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const p = lerPercentual(perdas);
    const e = lerValorPorPeca(embalagem);
    if (p === undefined) return avisar("Perdas e defeitos: use um percentual de 0 a 100 (ex.: 2 ou 2,5).", "erro");
    if (e === undefined) return avisar("Embalagem e etiqueta: use um valor em reais por peça (ex.: 0,40).", "erro");
    setSalvando(true);
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { ...sistema, perdasPctPadrao: p ?? 0, embalagemPorPecaPadrao: e ?? 0 } } });
      await recarregar();
      setPerdas(numeroParaCampo(p ?? 0));
      setEmbalagem(numeroParaCampo(e ?? 0));
      avisar("Padrões salvos. Valem para os próximos pedidos.");
    } catch (erro) {
      avisar(erro instanceof Error ? erro.message : String(erro), "erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Perdas e embalagem dos pedidos novos">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Perdas e defeitos (%)" dica="Provisão para peças quebradas, oxidadas ou que faltaram, sobre o valor da mercadoria. 0 = sem provisão.">
          <input inputMode="decimal" value={perdas} onChange={(ev) => setPerdas(ev.target.value)} placeholder="ex.: 2" />
        </Campo>
        <Campo rotulo="Embalagem e etiqueta (R$ por peça)" dica="Saquinho, etiqueta e cartela, somados ao custo de cada peça. 0 = não soma.">
          <input inputMode="decimal" value={embalagem} onChange={(ev) => setEmbalagem(ev.target.value)} placeholder="ex.: 0,40" />
        </Campo>
      </div>
      <p className="mt-3 text-sm text-[#8a6d78]">Cada pedido novo começa com esses valores. Para mudar só um pedido, use o quadro “Custo verdadeiro” na tela do pedido.</p>
      <div className="mt-4 flex justify-end">
        <Botao carregando={salvando} onClick={salvar}>
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}
