"use client";
import { useState } from "react";
import { api } from "@/lib/cliente";
import { lerNumeroBr, numeroParaCampo } from "@/lib/numeros";
import { textoValorMoeda } from "@/lib/conta-fornecedor";
import type { ResumoConferencia, SituacaoRecebimento } from "@/lib/recebimento";

/* Peças compartilhadas pelos quadros da tela do pedido (chegada, custo verdadeiro, créditos),
   pelo relatório para o fornecedor e pela tela de fornecedores. */

/** Resposta de GET/PATCH/POST /api/pedidos/:id/recebimento. */
export interface LinhaRecebimento {
  id: string;
  linha: number | null;
  codigoFornecedor: string | null;
  especificacao: string | null;
  nome: string | null;
  referencia: string | null;
  imagemId: string | null;
  quantidade: number;
  quantidadeRecebida: number | null;
  quantidadeDefeito: number;
  defeitoImagemId: string | null;
  defeitoObs: string | null;
  precoOrigem: number | null;
  recompra: boolean;
}

export interface CreditoTela {
  id: string;
  descricao: string;
  quantidade: number;
  valorMoeda: number;
  moeda: string;
  status: string;
  criadoEm: string;
  atualizadoEm: string;
  pedidoId: string | null;
  pedidoNumero: string | null;
  abatidoPedidoId: string | null;
  abatidoPedidoNumero: string | null;
  motivoNaoAbater: string | null;
}

export interface DadosRecebimento {
  pedido: {
    id: string;
    numero: string | null;
    fornecedor: string | null;
    fornecedorApelido: string | null;
    moeda: string;
    dataCompra: string | null;
    dataChegada: string | null;
    recebimento: SituacaoRecebimento | null;
    conferidoEm: string | null;
    conferidoPor: string | null;
  };
  linhas: LinhaRecebimento[];
  resumo: ResumoConferencia;
  creditos: CreditoTela[];
  gestora: boolean;
  avisos?: string[];
}

/** Valor na moeda do pedido: "¥ 45,00", "US$ 3,50" ou "R$ 12,00". */
export const valorMoeda = textoValorMoeda;

export const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * GET que devolve null quando a pessoa não pode ver (403: só a gestora). Assim o quadro some para a
 * funcionária em vez de mostrar erro. Outros erros seguem como no api() (401 leva ao login).
 */
export async function apiSeGestora<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 403) return null;
  if (!res.ok) return api<T>(url);
  return (await res.json()) as T;
}

/**
 * Campo de número digitado no jeito brasileiro ("850,50", "1.234,56"); grava ao sair do campo ou no Enter.
 * Vazio grava null. Quando o valor salvo muda, o campo volta a mostrar o valor salvo.
 */
export function CampoNumero(props: {
  valor: number | null | undefined;
  aoSalvar: (v: number | null) => void;
  casas?: number;
  milhar?: boolean;
  inteiro?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  rotulo?: string;
}) {
  return <CampoNumeroInterno key={String(props.valor ?? "")} {...props} />;
}

function CampoNumeroInterno({
  valor,
  aoSalvar,
  casas = 2,
  milhar = true,
  inteiro = false,
  placeholder,
  className = "",
  disabled,
  rotulo,
}: Parameters<typeof CampoNumero>[0]) {
  const [texto, setTexto] = useState(() => numeroParaCampo(valor, casas));
  function gravar() {
    const t = texto.trim();
    if (!t) {
      if (valor != null) aoSalvar(null);
      return;
    }
    const n = lerNumeroBr(t, { milhar });
    if (n == null || (inteiro && !Number.isInteger(n))) {
      setTexto(numeroParaCampo(valor, casas));
      return;
    }
    if (n !== valor) aoSalvar(n);
  }
  return (
    <input
      inputMode={inteiro ? "numeric" : "decimal"}
      value={texto}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={rotulo}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={gravar}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={className}
    />
  );
}

/** Espera as fotos da área terminarem de carregar (as "lazy" também), para a impressão sair completa. */
export function esperarImagens(raiz: Element | null, limiteMs = 10000): Promise<void> {
  const imgs = raiz ? Array.from(raiz.querySelectorAll("img")) : [];
  const todas = Promise.all(
    imgs.map((im) => {
      if (im.loading === "lazy") im.loading = "eager";
      return im.complete
        ? null
        : new Promise((ok) => {
            im.addEventListener("load", ok, { once: true });
            im.addEventListener("error", ok, { once: true });
          });
    }),
  );
  return Promise.race([todas.then(() => undefined), new Promise<void>((ok) => setTimeout(ok, limiteMs))]);
}
