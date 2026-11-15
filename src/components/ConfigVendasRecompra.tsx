"use client";
import { useState } from "react";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig, type ConfigCliente } from "@/components/hooks";
import { api, brl } from "@/lib/cliente";
import { lerNumeroBr, numeroParaCampo } from "@/lib/numeros";
import { faixasDePreco } from "@/lib/vendas-calculo";

/** Campos numéricos desta aba (todos em Configurações → sistema). */
const CAMPOS = [
  "maletasAtivas",
  "reservaVitrine",
  "loteMinimoPadrao",
  "orcamentoMensalRecompra",
  "diasForaDaCurva",
  "prazoReposicaoDias",
  "diasEstoqueParado",
  "maletaPecasAlvo",
] as const;
type CampoNumero = (typeof CAMPOS)[number];

const PADRAO: Record<CampoNumero, number> = {
  maletasAtivas: 10,
  reservaVitrine: 3,
  loteMinimoPadrao: 1,
  orcamentoMensalRecompra: 0,
  diasForaDaCurva: 60,
  prazoReposicaoDias: 45,
  diasEstoqueParado: 120,
  maletaPecasAlvo: 85,
};

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "60; 120; 250" → [60, 120, 250] (aceita vírgula decimal: "59,90; 120"). Inválido → null. */
function lerFaixas(texto: string): number[] | null {
  const partes = texto
    .split(/[;\s]+|,(?=\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const nums = partes.map((p) => lerNumeroBr(p));
  if (nums.some((n) => n == null || !(n > 0))) return null;
  const lista = [...new Set(nums as number[])].sort((a, b) => a - b);
  return lista.length <= 8 ? lista : null;
}

/**
 * Configurações → Vendas e recompra: freios da recompra (maletas ativas, reserva da vitrine, lote, orçamento),
 * curva ABC das peças novas, faixas de preço da análise de vendas, prazo de reposição, "parado" e peças por maleta.
 */
export function ConfigVendasRecompra() {
  const { config, recarregar } = useConfig();
  if (!config) return <Carregando />;
  return <Formulario config={config} recarregar={recarregar} />;
}

function Formulario({ config, recarregar }: { config: ConfigCliente; recarregar: () => Promise<void> }) {
  const avisar = useAviso();
  const sistema = config.sistema as unknown as Record<string, unknown>;
  const [valores, setValores] = useState<Record<CampoNumero, string>>(
    () => Object.fromEntries(CAMPOS.map((c) => [c, numeroParaCampo(Number(sistema[c] ?? PADRAO[c]))])) as Record<CampoNumero, string>,
  );
  const [faixas, setFaixas] = useState(() => (Array.isArray(sistema.faixasPrecoVenda) ? (sistema.faixasPrecoVenda as number[]) : [60, 120, 250]).map((n) => numeroParaCampo(n)).join("; "));
  const [salvando, setSalvando] = useState(false);

  const numero = (c: CampoNumero) => lerNumeroBr(valores[c]);
  const set = (c: CampoNumero) => (e: React.ChangeEvent<HTMLInputElement>) => setValores((v) => ({ ...v, [c]: e.target.value }));
  const faixasLidas = lerFaixas(faixas);
  const teto = Math.max(0, Math.floor(numero("maletasAtivas") ?? 0)) + Math.max(0, Math.floor(numero("reservaVitrine") ?? 0));
  const orcamento = numero("orcamentoMensalRecompra") ?? 0;

  async function salvar() {
    const novos: Record<string, number | number[]> = {};
    for (const c of CAMPOS) {
      const n = numero(c);
      const dinheiro = c === "orcamentoMensalRecompra";
      if (n == null || n < 0 || (!dinheiro && !Number.isInteger(n))) return avisar(`Confira o campo “${ROTULOS[c]}”: use ${dinheiro ? "um valor em reais (0 = sem orçamento)" : "um número inteiro"}.`, "erro");
      novos[c] = dinheiro ? Math.round(n * 100) / 100 : n;
    }
    if ((novos.loteMinimoPadrao as number) < 1) return avisar("O lote mínimo padrão é pelo menos 1 (1 = sem arredondar).", "erro");
    if ((novos.prazoReposicaoDias as number) < 1 || (novos.diasEstoqueParado as number) < 1) return avisar("Prazo de reposição e dias para “parado” precisam ser maiores que zero.", "erro");
    if ((novos.maletaPecasAlvo as number) < 1) return avisar("Peças por maleta precisa ser pelo menos 1.", "erro");
    if (!faixasLidas) return avisar("Faixas de preço: escreva os limites em reais separados por ponto e vírgula (ex.: 60; 120; 250), até 8 limites.", "erro");
    novos.faixasPrecoVenda = faixasLidas;
    setSalvando(true);
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { ...config.sistema, ...novos } } });
      await recarregar();
      avisar("Vendas e recompra: configuração salva.");
    } catch (e) {
      avisar(mensagem(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const campo = (c: CampoNumero, dica: React.ReactNode, decimal = false) => (
    <Campo rotulo={ROTULOS[c]} dica={dica}>
      <input inputMode={decimal ? "decimal" : "numeric"} value={valores[c]} onChange={set(c)} />
    </Campo>
  );

  return (
    <div className="flex flex-col gap-4">
      <Cartao
        titulo="Recompra com freio"
        acoes={
          <Botao carregando={salvando} onClick={salvar}>
            Salvar
          </Botao>
        }
      >
        <p className="mb-3 text-sm text-[#6b5560]">
          A lista de recompra parte do giro de cada peça e passa por freios: a leitura da curva ABC, o <b>teto por modelo</b>, o <b>lote do fornecedor</b> e o{" "}
          <b>orçamento do mês</b>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campo("maletasAtivas", "quantas maletas estão rodando")}
          {campo("reservaVitrine", "peças de cada modelo que ficam na loja")}
          <div className="rounded-xl bg-creme p-3 text-sm text-[#6b5560]">
            Teto por modelo: <b>{teto || "sem teto"}</b>
            <span className="block text-xs text-[#9a8089]">estoque + a caminho + recompra não passam disso (maletas + vitrine)</span>
          </div>
          {campo("loteMinimoPadrao", "múltiplo que o fornecedor aceita (1 = sem arredondar); cada fornecedor pode ter o seu")}
          {campo("orcamentoMensalRecompra", orcamento > 0 ? `a lista avisa quando passar de ${brl(orcamento)}` : "0 = sem orçamento", true)}
        </div>
      </Cartao>

      <Cartao titulo="Análise de vendas">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campo("diasForaDaCurva", "peças com menos dias desde a chegada ficam fora da curva ABC, como “novas”")}
          {campo("prazoReposicaoDias", "da China até a prateleira; base do ponto de reposição")}
          {campo("diasEstoqueParado", "sem venda há mais dias que isso = parado")}
          <Campo
            rotulo="Faixas de preço de venda (R$)"
            className="sm:col-span-2 lg:col-span-3"
            dica={
              faixasLidas ? (
                <span className="flex flex-wrap gap-1">
                  {faixasDePreco(faixasLidas).map((f) => (
                    <Selo key={f.chave} cor="cinza">
                      {f.nome}
                    </Selo>
                  ))}
                </span>
              ) : (
                <span className="text-red-700">escreva os limites separados por ponto e vírgula, ex.: 60; 120; 250</span>
              )
            }
          >
            <input inputMode="decimal" value={faixas} onChange={(e) => setFaixas(e.target.value)} placeholder="60; 120; 250" />
          </Campo>
        </div>
      </Cartao>

      <Cartao titulo="Maleta">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campo("maletaPecasAlvo", "a sugestão fecha nesse número; o valor máximo (teto) é escolhido em cada maleta")}
        </div>
        <div className="mt-4 flex justify-end">
          <Botao carregando={salvando} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </Cartao>
    </div>
  );
}

const ROTULOS: Record<CampoNumero, string> = {
  maletasAtivas: "Maletas ativas",
  reservaVitrine: "Reserva da vitrine",
  loteMinimoPadrao: "Lote mínimo padrão",
  orcamentoMensalRecompra: "Orçamento mensal da recompra (R$)",
  diasForaDaCurva: "Dias fora da curva ABC (novas)",
  prazoReposicaoDias: "Prazo de reposição (dias)",
  diasEstoqueParado: "Parado depois de (dias)",
  maletaPecasAlvo: "Peças por maleta",
};
