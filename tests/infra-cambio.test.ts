import { test } from "node:test";
import assert from "node:assert/strict";
import { TTL_COTACAO_HOJE_MS, buscarCotacaoCom, cacheValido, diaEmSaoPaulo, fonteDoCache, type CacheCotacoes, type LinhaCotacao } from "../src/lib/cambio";

/** Cotação PTAX com cache (src/lib/cambio.ts), sem rede: fetch de mentira, cache em memória e relógio fixo. */

const chave = (moeda: string, data: string, tipo: string) => `${moeda}|${data}|${tipo}`;

function cacheEmMemoria(inicial: LinhaCotacao[] = []): CacheCotacoes & { linhas: Map<string, LinhaCotacao> } {
  const linhas = new Map(inicial.map((l) => [chave(l.moeda, l.data, l.tipo), l]));
  return {
    linhas,
    async ler(moeda, data, tipo) {
      return linhas.get(chave(moeda, data, tipo)) ?? null;
    },
    async gravar(l) {
      linhas.set(chave(l.moeda, l.data, l.tipo), { ...l });
    },
  };
}

/** Boletim de fechamento do BCB: Data;Cód;Tipo;Moeda;Compra;Venda;… (só existe nos dias da lista). */
function bcbFalso(boletins: Record<string, { compra: string; venda: string }>, opcoes: { foraDoAr?: boolean } = {}) {
  const pedidos: string[] = [];
  const f = (async (entrada: string | URL | Request) => {
    const url = String(entrada);
    pedidos.push(url);
    if (opcoes.foraDoAr && /bcb\.gov\.br/.test(url)) throw new Error("fetch failed (BCB fora do ar)");
    const m = /fechamento\/(\d{4})(\d{2})(\d{2})\.csv$/.exec(url);
    if (m) {
      const b = boletins[`${m[1]}-${m[2]}-${m[3]}`];
      if (!b) return new Response("", { status: 404 });
      return new Response(`${m[3]}/${m[2]}/${m[1]};220;A;USD;5,0000;5,0006;1;1\n${m[3]}/${m[2]}/${m[1]};178;A;CNY;${b.compra};${b.venda};7,1;7,1\n`);
    }
    if (/olinda\.bcb\.gov\.br/.test(url)) return new Response(JSON.stringify({ value: [] }), { headers: { "content-type": "application/json" } });
    if (/awesomeapi/.test(url)) return new Response(JSON.stringify([{ ask: "0.7800", timestamp: String(Date.UTC(2026, 10, 13, 15) / 1000) }]), { headers: { "content-type": "application/json" } });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { f, pedidos };
}

// Sexta 13/11/2026 tem boletim; sábado 14 e domingo 15 não.
const BOLETINS = { "2026-11-12": { compra: "0,7701", venda: "0,7708" }, "2026-11-13": { compra: "0,7741", venda: "0,7745" } };

test("dia no horário de Brasília (servidor da nuvem roda em UTC)", () => {
  assert.equal(diaEmSaoPaulo(new Date("2026-11-15T02:00:00Z")), "2026-11-14"); // 23h de sábado em Brasília
  assert.equal(diaEmSaoPaulo(new Date("2026-11-15T03:00:00Z")), "2026-11-15");
});

test("validade do que está guardado: data passada é definitiva; hoje vale 30 minutos; valor provisório expira", () => {
  const agora = new Date("2026-11-16T15:00:00Z"); // segunda, meio-dia em Brasília
  const fechamento = "PTAX Banco Central (boletim de fechamento)";
  // Passada, fechamento do próprio dia: definitiva, mesmo guardada há semanas.
  assert.equal(cacheValido({ data: "2026-11-13", dataEfetiva: "2026-11-13", fonte: fechamento, criadoEm: "2026-11-13T20:00:00Z" }, agora), true);
  // Domingo (sem boletim) buscado depois que o dia acabou: vale a sexta, definitiva.
  assert.equal(cacheValido({ data: "2026-11-15", dataEfetiva: "2026-11-13", fonte: fechamento, criadoEm: "2026-11-16T12:00:00Z" }, agora), true);
  // Buscada na manhã do próprio dia (o boletim ainda não tinha saído): provisória; no dia seguinte busca de novo.
  assert.equal(cacheValido({ data: "2026-11-13", dataEfetiva: "2026-11-12", fonte: fechamento, criadoEm: "2026-11-13T12:00:00Z" }, agora), false);
  // Hoje: 30 minutos.
  const hoje = { data: "2026-11-16", dataEfetiva: "2026-11-13", fonte: fechamento };
  assert.equal(cacheValido({ ...hoje, criadoEm: new Date(agora.getTime() - TTL_COTACAO_HOJE_MS + 60_000).toISOString() }, agora), true);
  assert.equal(cacheValido({ ...hoje, criadoEm: new Date(agora.getTime() - TTL_COTACAO_HOJE_MS - 60_000).toISOString() }, agora), false);
  // Mercado (não é PTAX de fechamento) nunca vira definitiva.
  assert.equal(cacheValido({ data: "2026-11-13", dataEfetiva: "2026-11-13", fonte: "PTAX Banco Central (Intermediário)", criadoEm: "2026-11-13T20:00:00Z" }, agora), false);
});

test("busca no Banco Central, guarda e não volta lá: data passada para sempre, hoje por 30 minutos", async () => {
  const cache = cacheEmMemoria();
  const bcb = bcbFalso(BOLETINS);
  let agora = new Date("2026-11-16T15:00:00Z");
  const deps = { fetch: bcb.f, cache, agora: () => agora };

  // Domingo: cai no boletim de sexta e guarda para o domingo e para a sexta.
  const r = await buscarCotacaoCom(deps, "cny", "2026-11-15", "venda");
  assert.deepEqual(r.cotacao, { moeda: "CNY", valor: 0.7745, data: "2026-11-13", fonte: "PTAX Banco Central (boletim de fechamento)", tipo: "venda" });
  assert.deepEqual(r.erros, []);
  assert.ok(cache.linhas.has("CNY|2026-11-15|venda") && cache.linhas.has("CNY|2026-11-13|venda"));
  const idas = bcb.pedidos.length;
  agora = new Date("2026-12-20T15:00:00Z"); // um mês depois
  const deNovo = await buscarCotacaoCom(deps, "CNY", "2026-11-15", "venda");
  assert.equal(deNovo.cotacao?.valor, 0.7745);
  assert.equal(bcb.pedidos.length, idas, "data passada não volta ao Banco Central");
  assert.equal((await buscarCotacaoCom(deps, "CNY", "2026-11-13", "venda")).cotacao?.valor, 0.7745);
  assert.equal(bcb.pedidos.length, idas);

  // Compra e venda são guardadas separadas.
  assert.equal((await buscarCotacaoCom(deps, "CNY", "2026-11-13", "compra")).cotacao?.valor, 0.7741);

  // Hoje (segunda, antes do boletim): usa sexta; 10 minutos depois, do cache; 40 minutos depois, busca de novo.
  agora = new Date("2026-11-16T13:00:00Z");
  await buscarCotacaoCom(deps, "CNY", "2026-11-16", "venda");
  const n = bcb.pedidos.length;
  agora = new Date("2026-11-16T13:10:00Z");
  await buscarCotacaoCom(deps, "CNY", "2026-11-16", "venda");
  assert.equal(bcb.pedidos.length, n);
  agora = new Date("2026-11-16T13:40:00Z");
  await buscarCotacaoCom(deps, "CNY", "2026-11-16", "venda");
  assert.ok(bcb.pedidos.length > n);
});

test("Banco Central fora do ar: usa o último valor guardado para a data, com a fonte dizendo que veio do app", async () => {
  const guardada: LinhaCotacao = {
    moeda: "CNY",
    data: "2026-11-16",
    tipo: "venda",
    cotacao: 0.7745,
    dataEfetiva: "2026-11-13",
    fonte: "PTAX Banco Central (boletim de fechamento)",
    criadoEm: "2026-11-16T12:00:00Z",
  };
  const cache = cacheEmMemoria([guardada]);
  const bcb = bcbFalso(BOLETINS, { foraDoAr: true });
  const r = await buscarCotacaoCom({ fetch: bcb.f, cache, agora: () => new Date("2026-11-16T18:00:00Z") }, "CNY", "2026-11-16", "venda");
  assert.equal(r.cotacao?.valor, 0.7745);
  assert.equal(r.cotacao?.data, "2026-11-13");
  assert.match(r.cotacao?.fonte ?? "", /guardado no app em 16\/11\/2026.*Banco Central não respondeu/);
  assert.equal(r.cotacao?.fonte, fonteDoCache(guardada));
  assert.ok(r.erros.length > 0);
  assert.ok(!bcb.pedidos.some((u) => /awesomeapi/.test(u)), "com valor guardado, não troca pela cotação de mercado");

  // Sem nada guardado: cotação de mercado (AwesomeAPI), que não é guardada como PTAX.
  const vazio = cacheEmMemoria();
  const m = await buscarCotacaoCom({ fetch: bcb.f, cache: vazio, agora: () => new Date("2026-11-16T18:00:00Z") }, "CNY", "2026-11-16", "venda");
  assert.equal(m.cotacao?.fonte, "AwesomeAPI (mercado)");
  assert.equal(vazio.linhas.size, 0);
});

test("entradas: BRL vale 1 sem ir à rede; moeda e data inválidas não viram pedido ao Banco Central; cache com defeito não derruba", async () => {
  const bcb = bcbFalso(BOLETINS);
  assert.deepEqual((await buscarCotacaoCom({ fetch: bcb.f, cache: null }, "BRL", "2026-11-13")).cotacao?.valor, 1);
  assert.match((await buscarCotacaoCom({ fetch: bcb.f, cache: null }, "C'NY", "2026-11-13")).erros[0], /Moeda inválida/);
  assert.match((await buscarCotacaoCom({ fetch: bcb.f, cache: null }, "CNY", "13/11/2026")).erros[0], /Data inválida/);
  assert.match((await buscarCotacaoCom({ fetch: bcb.f, cache: null }, "CNY", "2026-02-30")).erros[0], /Data inválida/);
  assert.equal(bcb.pedidos.length, 0);

  const quebrado: CacheCotacoes = {
    ler: async () => Promise.reject(new Error("banco travado")),
    gravar: async () => Promise.reject(new Error("banco travado")),
  };
  const r = await buscarCotacaoCom({ fetch: bcb.f, cache: quebrado, agora: () => new Date("2026-11-16T15:00:00Z") }, "CNY", "2026-11-13");
  assert.equal(r.cotacao?.valor, 0.7745);
});
