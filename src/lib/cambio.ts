import { and, eq } from "drizzle-orm";

/**
 * Cotação do dia da compra (PTAX de fechamento do Banco Central).
 * 1) Boletim diário de fechamento do BCB (www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv):
 *    traz TODAS as moedas, inclusive o yuan (CNY). A API Olinda do BCB só tem 10 moedas e não tem CNY.
 *    Se a data não tem boletim (fim de semana/feriado ou antes das ~13h), usa o último dia útil anterior.
 * 2) API Olinda do BCB (USD, EUR e outras 8 moedas).
 * 3) AwesomeAPI (mercado), se o BCB estiver fora do ar e não houver valor guardado.
 * 4) Se nada responder, o usuário informa a cotação manualmente na tela do pedido.
 *
 * Cache na tabela `cotacoes` (moeda, data pedida, tipo):
 *  - data passada: definitiva (o fechamento daquele dia não muda mais), sem ir ao Banco Central de novo;
 *  - hoje (ou data à frente): vale por 30 minutos;
 *  - Banco Central fora do ar: usa o último valor guardado para a data, com a fonte dizendo que veio do app.
 *
 * Sem "server-only" para os testes (tests/infra-cambio.test.ts) importarem: o banco só é carregado (import dinâmico)
 * quando buscarCotacao() roda no servidor. Nos testes, use buscarCotacaoCom() com fetch e cache de mentira.
 */

export interface Cotacao {
  moeda: string;
  valor: number; // R$ por 1 unidade da moeda
  data: string; // AAAA-MM-DD da cotação efetivamente usada
  fonte: string;
  tipo: "venda" | "compra";
}

/** Linha da tabela cotacoes (src/lib/db/schema.ts). */
export interface LinhaCotacao {
  moeda: string;
  data: string; // data pedida (AAAA-MM-DD)
  tipo: string; // venda | compra
  cotacao: number;
  dataEfetiva: string | null; // dia útil de onde veio a cotação
  fonte: string | null;
  criadoEm: string; // ISO de quando foi buscada no Banco Central
}

export interface CacheCotacoes {
  ler(moeda: string, data: string, tipo: string): Promise<LinhaCotacao | null>;
  gravar(linha: LinhaCotacao): Promise<void>;
}

export interface DependenciasCotacao {
  fetch?: typeof fetch;
  cache?: CacheCotacoes | null; // null = sem cache
  agora?: () => Date;
}

type Resultado = { cotacao: Cotacao | null; erros: string[] };

/** Quanto tempo vale a cotação de hoje guardada (o boletim do dia sai por volta das 13h). */
export const TTL_COTACAO_HOJE_MS = 30 * 60 * 1000;

const FUSO = "America/Sao_Paulo";

/** Dia (AAAA-MM-DD) no horário de Brasília — o servidor na nuvem roda em UTC. */
export function diaEmSaoPaulo(d: Date): string {
  try {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
    const dia = `${p("year")}-${p("month")}-${p("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) return dia;
  } catch {
    /* Node sem fusos (ICU reduzido): Brasília é UTC−3 o ano todo desde 2019 */
  }
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export const hojeEmSaoPaulo = () => diaEmSaoPaulo(new Date());

const ehFechamento = (fonte: string | null | undefined) => /fechamento/i.test(fonte ?? "");

/**
 * A cotação guardada ainda vale?
 *  - data passada e fechamento do próprio dia (ou buscada depois que o dia acabou, ex.: feriado → dia útil anterior): sempre;
 *  - hoje, data à frente ou valor provisório (buscado de manhã, antes do boletim do dia): por 30 minutos.
 */
export function cacheValido(l: Pick<LinhaCotacao, "data" | "dataEfetiva" | "fonte" | "criadoEm">, agora: Date): boolean {
  const gravadoEm = Date.parse(l.criadoEm);
  if (!Number.isFinite(gravadoEm)) return false;
  const hoje = diaEmSaoPaulo(agora);
  if (l.data < hoje && ehFechamento(l.fonte) && (l.dataEfetiva === l.data || diaEmSaoPaulo(new Date(gravadoEm)) > l.data)) return true;
  const idade = agora.getTime() - gravadoEm;
  return idade >= 0 && idade < TTL_COTACAO_HOJE_MS;
}

const dataHora = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
};

/** Fonte de um valor guardado usado porque o Banco Central não respondeu. */
export const fonteDoCache = (l: Pick<LinhaCotacao, "fonte" | "criadoEm">) =>
  `${l.fonte || "PTAX Banco Central"} · valor guardado no app em ${dataHora(l.criadoEm)} (o Banco Central não respondeu agora)`;

const daLinha = (l: LinhaCotacao, tipo: "venda" | "compra"): Cotacao => ({
  moeda: l.moeda,
  valor: l.cotacao,
  data: l.dataEfetiva ?? l.data,
  fonte: l.fonte || "PTAX Banco Central",
  tipo,
});

const mmddyyyy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;

const dataValida = (data: string) => /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(Date.parse(`${data}T12:00:00Z`)) && new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) === data;

/** Boletim de fechamento PTAX (CSV): Data;Cód;Tipo;Moeda;Compra;Venda;Paridade compra;Paridade venda */
async function boletimBcb(f: typeof fetch, moeda: string, data: string, tipo: "venda" | "compra"): Promise<Cotacao | null> {
  const dia = new Date(`${data}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    const aaaammdd = dia.toISOString().slice(0, 10).replaceAll("-", "");
    const res = await f(`https://www4.bcb.gov.br/Download/fechamento/${aaaammdd}.csv`, { signal: AbortSignal.timeout(12000), cache: "no-store" });
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

async function ptax(f: typeof fetch, moeda: string, data: string, tipo: "venda" | "compra"): Promise<Cotacao | null> {
  const fim = new Date(`${data}T12:00:00Z`);
  const ini = new Date(fim.getTime() - 10 * 86400000);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${moeda}'&@dataInicial='${mmddyyyy(ini)}'&@dataFinalCotacao='${mmddyyyy(fim)}'` +
    "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim";
  const res = await f(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
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

async function awesome(f: typeof fetch, moeda: string, data: string): Promise<Cotacao | null> {
  const fim = data.replaceAll("-", "");
  const iniD = new Date(`${data}T12:00:00Z`);
  iniD.setUTCDate(iniD.getUTCDate() - 7);
  const ini = iniD.toISOString().slice(0, 10).replaceAll("-", "");
  const url = `https://economia.awesomeapi.com.br/json/daily/${moeda}-BRL/10?start_date=${ini}&end_date=${fim}`;
  const res = await f(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
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

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Guarda a cotação do Banco Central para a data pedida (e, se veio de outro dia útil, para aquele dia também). */
async function guardar(cache: CacheCotacoes | null, c: Cotacao, dataPedida: string, agora: Date) {
  if (!cache) return;
  const base = { moeda: c.moeda, tipo: c.tipo, cotacao: c.valor, dataEfetiva: c.data, fonte: c.fonte, criadoEm: agora.toISOString() };
  try {
    await cache.gravar({ ...base, data: dataPedida });
    if (c.data !== dataPedida && ehFechamento(c.fonte) && dataValida(c.data)) await cache.gravar({ ...base, data: c.data });
  } catch (e) {
    console.warn("[cambio] não guardou a cotação:", mensagem(e));
  }
}

/** buscarCotacao com as dependências trocáveis (fetch, cache e relógio) — usado nos testes. */
export async function buscarCotacaoCom(deps: DependenciasCotacao, moedaPedida: string, dataPedida: string, tipo: "venda" | "compra" = "venda"): Promise<Resultado> {
  const moeda = String(moedaPedida ?? "").trim().toUpperCase();
  const data = String(dataPedida ?? "").trim();
  if (moeda === "BRL") return { cotacao: { moeda, valor: 1, data, fonte: "BRL", tipo }, erros: [] };
  if (!/^[A-Z]{3}$/.test(moeda)) return { cotacao: null, erros: [`Moeda inválida: "${moedaPedida}" (use o código de 3 letras, ex.: CNY).`] };
  if (!dataValida(data)) return { cotacao: null, erros: [`Data inválida: "${dataPedida}" (use AAAA-MM-DD).`] };
  const f = deps.fetch ?? fetch;
  const agora = deps.agora?.() ?? new Date();
  const cache = deps.cache ?? null;

  let salva: LinhaCotacao | null = null;
  if (cache) {
    try {
      salva = await cache.ler(moeda, data, tipo);
    } catch (e) {
      console.warn("[cambio] não leu a cotação guardada:", mensagem(e));
    }
  }
  if (salva && salva.cotacao > 0 && cacheValido(salva, agora)) return { cotacao: daLinha(salva, tipo), erros: [] };

  const erros: string[] = [];
  for (const fonte of [() => boletimBcb(f, moeda, data, tipo), () => ptax(f, moeda, data, tipo)]) {
    try {
      const c = await fonte();
      if (c && c.valor > 0) {
        await guardar(cache, c, data, agora);
        return { cotacao: c, erros };
      }
    } catch (e) {
      erros.push(mensagem(e));
    }
  }
  // Banco Central fora do ar (ou sem a moeda): o último valor guardado para esta data, avisando na fonte.
  if (salva && salva.cotacao > 0) return { cotacao: { ...daLinha(salva, tipo), fonte: fonteDoCache(salva) }, erros };
  try {
    const c = await awesome(f, moeda, data);
    if (c && c.valor > 0) return { cotacao: c, erros };
  } catch (e) {
    erros.push(mensagem(e));
  }
  return { cotacao: null, erros };
}

/** Cache na tabela cotacoes (import dinâmico: o banco só é carregado no servidor). */
async function cacheDoBanco(): Promise<CacheCotacoes | null> {
  try {
    const { getDb, schema } = await import("./db");
    const db = await getDb();
    const t = schema.cotacoes;
    return {
      async ler(moeda, data, tipo) {
        const [l] = await db
          .select()
          .from(t)
          .where(and(eq(t.moeda, moeda), eq(t.data, data), eq(t.tipo, tipo)))
          .limit(1);
        return l ?? null;
      },
      async gravar(l) {
        await db
          .insert(t)
          .values(l)
          .onConflictDoUpdate({ target: [t.moeda, t.data, t.tipo], set: { cotacao: l.cotacao, dataEfetiva: l.dataEfetiva, fonte: l.fonte, criadoEm: l.criadoEm } });
      },
    };
  } catch (e) {
    console.warn("[cambio] cotações guardadas indisponíveis:", mensagem(e));
    return null;
  }
}

const emAndamento = new Map<string, Promise<Resultado>>();

export async function buscarCotacao(moeda: string, data: string, tipo: "venda" | "compra" = "venda"): Promise<Resultado> {
  const chave = `${String(moeda).trim().toUpperCase()}|${String(data).trim()}|${tipo}`;
  const atual = emAndamento.get(chave);
  if (atual) return atual; // a mesma cotação pedida ao mesmo tempo (ex.: duas telas): uma ida só ao Banco Central
  const p = (async () => {
    const semCache = String(moeda).trim().toUpperCase() === "BRL";
    return buscarCotacaoCom({ cache: semCache ? null : await cacheDoBanco() }, moeda, data, tipo);
  })();
  emAndamento.set(chave, p);
  try {
    return await p;
  } finally {
    emAndamento.delete(chave);
  }
}
