"use client";
import { useState } from "react";
import { useAviso } from "@/components/ui";
import { lerNumeroBr, numeroParaCampo } from "@/lib/numeros";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "onBlur" | "inputMode"> & {
  valor: number | null | undefined;
  aoSalvar: (novo: number | null) => void;
  casas?: number; // casas mostradas: 2 (dinheiro, fator), 4 (cotação)
  milhar?: boolean; // dinheiro: "1.234" = mil duzentos e trinta e quatro; false em cotação e fator ("0.775" = 0,775)
  inteiro?: boolean; // quantidade
  positivo?: boolean; // maior que zero (fator, cotação)
  vazio?: boolean; // pode apagar (salva null)
  rotulo?: string; // nome do campo na mensagem de erro
};

/**
 * Campo de número no jeito brasileiro: "850,50", "850.50" e "1.234,56" valem (lerNumeroBr).
 * Texto inválido mostra a mensagem e não grava. Ao sair do campo (ou Enter), só salva se o valor mudou.
 * Quando o valor muda por fora (recarregou), o campo mostra o valor novo.
 */
export function CampoNumero(props: Props) {
  return <Interno key={String(props.valor ?? "")} {...props} />;
}

function Interno({ valor, aoSalvar, casas = 2, milhar = true, inteiro = false, positivo = false, vazio = true, rotulo = "o campo", className = "", ...resto }: Props) {
  const avisar = useAviso();
  const [texto, setTexto] = useState(() => numeroParaCampo(valor, casas));
  const [invalido, setInvalido] = useState(false);
  const exemplo = inteiro ? "12" : casas >= 4 ? "0,7745" : positivo ? "10 ou 8,5" : "850,50";

  function sair() {
    const t = texto.trim();
    if (!t) {
      if (valor == null) return setInvalido(false);
      if (!vazio) {
        setInvalido(true);
        avisar(`Preencha ${rotulo} (ex.: ${exemplo}).`, "erro");
        return;
      }
      setInvalido(false);
      aoSalvar(null);
      return;
    }
    const n = lerNumeroBr(t, { milhar });
    if (n == null || n < 0 || (inteiro && !Number.isInteger(n)) || (positivo && n <= 0)) {
      setInvalido(true);
      avisar(`Valor inválido em ${rotulo}: "${t}". Digite só números, ex.: ${exemplo}.`, "erro");
      return;
    }
    setInvalido(false);
    if (valor != null && Math.abs(n - valor) < 1e-9) {
      setTexto(numeroParaCampo(valor, casas)); // mesmo valor: só arruma o jeito de mostrar
      return;
    }
    aoSalvar(n);
  }

  return (
    <input
      {...resto}
      inputMode={inteiro ? "numeric" : "decimal"}
      value={texto}
      aria-invalid={invalido || undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={sair}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${className} ${invalido ? "border-red-500 ring-1 ring-red-400" : ""}`}
    />
  );
}
