import { Selo } from "@/components/ui";

/** Código de barras com a origem: do UP (o que vale no caixa), do app (EAN interno) ou aguardando o UP. */
export function CodigoBarrasCelula({ codigo, origem }: { codigo: string | null | undefined; origem: string | null | undefined }) {
  if (!codigo)
    return (
      <span title="Cadastre no UP e importe os códigos (UP Vendas → Códigos de barras do UP) ou bipe o código no pedido">
        <Selo cor="amarelo">aguardando UP</Selo>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{codigo}</span>
      {origem === "up" ? (
        <span title="Código criado pelo UP Vendas">
          <Selo cor="verde">UP</Selo>
        </span>
      ) : (
        <span title="EAN interno criado pelo app (o UP não conhece este código)">
          <Selo cor="cinza">app</Selo>
        </span>
      )}
    </span>
  );
}
