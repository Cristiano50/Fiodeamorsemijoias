import "server-only";

/**
 * Cotação do dia da compra (PTAX de fechamento do Banco Central).
 * 1) Boletim diário de fechamento do BCB (www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv):
 *    traz TODAS as moedas, inclusive o yuan (CNY). A API Olinda do BCB só tem 10 moedas e não tem CNY.
 *    Se a data não tem boletim (fim de semana/feriado ou antes das ~13h), usa o último dia útil anterior.
 * 2) API Olinda do BCB (USD, EUR e outras 8 moedas).
 * 3) AwesomeAPI (mercado), se o BCB estiver fora do ar.
 * 4) Se nada responder, o usuário informa a cotação manualmente na tela do pedido.
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

/** Boletim de fechamento PTAX (CSV): Data;Cód;Tipo;Moeda;Compra;Venda;Paridade compra;Paridade venda */
async function boletimBcb(moeda: string, data: string, tipo: "venda" | "compra"): Promise<Cotacao | null> {
  const dia = new Date(`${data}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    const aaaammdd = dia.toISOString().slice(0, 10).replaceAll("-", "");
    const res = await fetch(`https://www4.bcb.gov.br/Download/fechamento/${aaaammdd}.csv`, { signal: AbortSignal.timeout(12000), cache: "no-store" });
    if (res.ok) {
      const linha = (await res.text()).split(/\r?\n/).find((l) => l.split(";")[3]?.trim().toUpperCase() === moeda);
      if (!linha) return null; // moeda não existe no boletim
      const c = linha.split(";");
      const valor = Number((tipo === "venda" ? c[5] : c[4]).replace(",", "."));
      const [dd, mm, aaaa] = c[0].split("/");
      return { moeda, valor, data: `${aaaa}-${mm}-${dd}`, fonte: "PTAX Banco Central (boletim de fechamento)", tipo };
    }
    if (res.status !== 404) throw new Error(`BCB (boletim) respondeu ${res.status}`);
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  return null;
}

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
  for (const fonte of [() => boletimBcb(moeda, data, tipo), () => ptax(moeda, data, tipo), () => awesome(moeda, data)]) {
    try {
      const c = await fonte();
      if (c && c.valor > 0) return { cotacao: c, erros };
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { cotacao: null, erros };
}
