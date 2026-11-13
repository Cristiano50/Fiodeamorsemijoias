import "server-only";

/**
 * Cotação do dia da compra.
 * 1) PTAX do Banco Central (boletim de Fechamento) — fonte oficial.
 *    Se a data não tem cotação (fim de semana/feriado), usa o último dia útil anterior.
 * 2) Alternativa: AwesomeAPI (economia.awesomeapi.com.br), caso o BCB esteja fora do ar.
 * 3) Se nada responder, o usuário informa a cotação manualmente na tela do pedido.
 */

export interface Cotacao {
  moeda: string;
  valor: number; // R$ por 1 unidade da moeda
  data: string; // AAAA-MM-DD da cotação efetivamente usada
  fonte: string;
  tipo: "venda" | "compra";
}

const mmddyyyy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;

async function ptax(moeda: string, data: string, tipo: "venda" | "compra"): Promise<Cotacao | null> {
  const fim = new Date(`${data}T12:00:00Z`);
  const ini = new Date(fim.getTime() - 10 * 86400000);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${moeda}'&@dataInicial='${mmddyyyy(ini)}'&@dataFinalCotacao='${mmddyyyy(fim)}'` +
    "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim";
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!res.ok) throw new Error(`BCB respondeu ${res.status}`);
  const json = (await res.json()) as {
    value: { cotacaoCompra: number; cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string }[];
  };
  const fechamentos = json.value.filter((v) => v.tipoBoletim?.startsWith("Fechamento"));
  const lista = fechamentos.length ? fechamentos : json.value;
  const ultimo = lista.at(-1);
  if (!ultimo) return null;
  return {
    moeda,
    valor: tipo === "venda" ? ultimo.cotacaoVenda : ultimo.cotacaoCompra,
    data: ultimo.dataHoraCotacao.slice(0, 10),
    fonte: `PTAX Banco Central (${ultimo.tipoBoletim})`,
    tipo,
  };
}

async function awesome(moeda: string, data: string): Promise<Cotacao | null> {
  const fim = data.replaceAll("-", "");
  const iniD = new Date(`${data}T12:00:00Z`);
  iniD.setUTCDate(iniD.getUTCDate() - 7);
  const ini = iniD.toISOString().slice(0, 10).replaceAll("-", "");
  const url = `https://economia.awesomeapi.com.br/json/daily/${moeda}-BRL/10?start_date=${ini}&end_date=${fim}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`AwesomeAPI respondeu ${res.status}`);
  const lista = (await res.json()) as { ask: string; timestamp: string }[];
  if (!lista.length) return null;
  const maisRecente = [...lista].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
  return {
    moeda,
    valor: Number(maisRecente.ask),
    data: new Date(Number(maisRecente.timestamp) * 1000).toISOString().slice(0, 10),
    fonte: "AwesomeAPI (mercado)",
    tipo: "venda",
  };
}

export async function buscarCotacao(
  moeda: string,
  data: string,
  tipo: "venda" | "compra" = "venda",
): Promise<{ cotacao: Cotacao | null; erros: string[] }> {
  if (moeda === "BRL") return { cotacao: { moeda, valor: 1, data, fonte: "BRL", tipo }, erros: [] };
  const erros: string[] = [];
  for (const fonte of [() => ptax(moeda, data, tipo), () => awesome(moeda, data)]) {
    try {
      const c = await fonte();
      if (c && c.valor > 0) return { cotacao: c, erros };
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { cotacao: null, erros };
}
