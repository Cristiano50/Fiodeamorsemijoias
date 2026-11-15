/**
 * Painel semanal (item 28): vendas da semana e do mês × período anterior, sell-through de cada pedido
 * aos 30/60/90 dias da chegada, estoque parado, capital em estoque, cobertura em dias e o backup fora do computador.
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/dados-painel.test.ts.
 */
import { chegadaDe, chaveDoProduto, diasEntre, entradaDaLinha, ligarVenda, somarDias, type IndiceProdutos, type SkuAnalise, type VendaBase } from "./vendas-calculo";

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/* ------------------------------------------------------ vendas no tempo */

export interface VendaResumo {
  data: string | null;
  quantidade: number;
  receita: number;
}

export interface Janela {
  inicio: string;
  fim: string;
  receita: number;
  pecas: number;
}

export interface Comparacao {
  atual: Janela;
  anterior: Janela;
  /** Variação da receita (0,12 = +12%); nula sem receita no período anterior. */
  variacao: number | null;
}

function somarJanela(vendas: VendaResumo[], inicio: string, fim: string): Janela {
  let receita = 0;
  let pecas = 0;
  for (const v of vendas) {
    if (!v.data || v.data < inicio || v.data > fim) continue;
    receita += v.receita;
    pecas += v.quantidade;
  }
  return { inicio, fim, receita: r2(receita), pecas: r2(pecas) };
}

const comparar = (atual: Janela, anterior: Janela): Comparacao => ({
  atual,
  anterior,
  variacao: anterior.receita > 0 ? r4(atual.receita / anterior.receita - 1) : null,
});

/** Últimos 7 dias até `fim` × os 7 dias antes. */
export function vendasDaSemana(vendas: VendaResumo[], fim: string): Comparacao {
  return comparar(somarJanela(vendas, somarDias(fim, -6), fim), somarJanela(vendas, somarDias(fim, -13), somarDias(fim, -7)));
}

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1–12

/** Do dia 1 até `fim` × o mesmo trecho do mês anterior (até o mesmo dia, ou o último dia se o mês for mais curto). */
export function vendasDoMes(vendas: VendaResumo[], fim: string): Comparacao {
  const [ano, mes, dia] = fim.split("-").map(Number);
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const diaAnt = Math.min(dia, ultimoDiaDoMes(anoAnt, mesAnt));
  const dois = (n: number) => String(n).padStart(2, "0");
  return comparar(
    somarJanela(vendas, `${ano}-${dois(mes)}-01`, fim),
    somarJanela(vendas, `${anoAnt}-${dois(mesAnt)}-01`, `${anoAnt}-${dois(mesAnt)}-${dois(diaAnt)}`),
  );
}

/* --------------------------------------------- sell-through por pedido */

export interface SellThroughPedido {
  pedidoId: string;
  numero: string | null;
  fornecedor: string | null;
  chegada: string;
  chegadaEstimada: boolean;
  diasDesdeChegada: number;
  entrou: number;
  vendidasAteAgora: number;
  sellThroughAteAgora: number;
  /** Sell-through aos N dias da chegada (nulo enquanto o pedido não completou N dias). */
  marcos: { dias: number; vendidas: number | null; sellThrough: number | null }[];
}

/**
 * Sell-through de cada pedido aos 30/60/90 dias da chegada. As vendas de um SKU vão para as linhas na ordem
 * em que chegaram (a peça mais antiga sai primeiro); devoluções desfazem as últimas saídas.
 */
export function sellThroughPorPedido(
  idx: IndiceProdutos,
  vendas: VendaBase[],
  hoje: string,
  opcoes: { marcos?: number[]; limite?: number } = {},
): SellThroughPedido[] {
  const marcos = opcoes.marcos ?? [30, 60, 90];
  type Linha = { pedidoId: string; chegada: string; capacidade: number; alocacoes: { data: string; q: number }[] };
  const linhasPorSku = new Map<string, Linha[]>();
  const pedidos = new Map<string, { numero: string | null; fornecedor: string | null; chegada: string; estimada: boolean; entrou: number; linhas: Linha[] }>();
  for (const p of idx.ordenados) {
    if (!p.pedidoId) continue;
    const ch = chegadaDe(p, hoje);
    if (!ch.chegou || !ch.data) continue;
    const entrou = entradaDaLinha(p);
    const linha: Linha = { pedidoId: p.pedidoId, chegada: ch.data, capacidade: entrou, alocacoes: [] };
    const chave = chaveDoProduto(p, idx);
    linhasPorSku.set(chave, [...(linhasPorSku.get(chave) ?? []), linha]);
    let ped = pedidos.get(p.pedidoId);
    if (!ped) {
      ped = { numero: p.numeroPedido ?? null, fornecedor: p.fornecedor, chegada: ch.data, estimada: ch.estimada, entrou: 0, linhas: [] };
      pedidos.set(p.pedidoId, ped);
    }
    if (ch.data < ped.chegada) {
      ped.chegada = ch.data;
      ped.estimada = ch.estimada;
    }
    ped.entrou += entrou;
    ped.linhas.push(linha);
  }
  for (const lista of linhasPorSku.values()) lista.sort((a, b) => a.chegada.localeCompare(b.chegada) || a.pedidoId.localeCompare(b.pedidoId));

  const vendasPorSku = new Map<string, { data: string; q: number }[]>();
  for (const v of vendas) {
    if (!v.data || !v.quantidade) continue;
    const { produto } = ligarVenda(v, idx);
    if (!produto) continue;
    const chave = chaveDoProduto(produto, idx);
    if (!linhasPorSku.has(chave)) continue;
    vendasPorSku.set(chave, [...(vendasPorSku.get(chave) ?? []), { data: v.data, q: v.quantidade }]);
  }
  for (const [chave, lista] of vendasPorSku) {
    const linhas = linhasPorSku.get(chave)!;
    const pilha: { data: string; q: number }[] = []; // saídas na ordem, para a devolução desfazer as últimas
    lista.sort((a, b) => a.data.localeCompare(b.data) || b.q - a.q);
    for (const v of lista) {
      if (v.q > 0) {
        let resta = v.q;
        // Primeiro as linhas que já tinham chegado na data da venda; se nenhuma, a mais antiga (data inconsistente).
        const ordem = [...linhas.filter((l) => l.chegada <= v.data), ...linhas.filter((l) => l.chegada > v.data)];
        for (const l of ordem) {
          if (resta <= 1e-9) break;
          const usado = l.alocacoes.reduce((s, a) => s + a.q, 0);
          const livre = l.capacidade - usado;
          if (livre <= 1e-9) continue;
          const aloc = { data: v.data, q: Math.min(livre, resta) };
          l.alocacoes.push(aloc);
          pilha.push(aloc);
          resta -= aloc.q;
        }
      } else {
        let devolver = -v.q;
        while (devolver > 1e-9 && pilha.length) {
          const topo = pilha[pilha.length - 1]; // a mesma alocação que está na linha: mexer aqui desfaz lá
          const q = Math.min(topo.q, devolver);
          topo.q -= q;
          devolver -= q;
          if (topo.q <= 1e-9) pilha.pop();
        }
      }
    }
  }

  const out: SellThroughPedido[] = [];
  for (const [pedidoId, ped] of pedidos) {
    if (ped.entrou <= 0) continue;
    const vendidasAte = (limite: string | null) => r2(ped.linhas.reduce((s, l) => s + l.alocacoes.filter((a) => !limite || a.data <= limite).reduce((t, a) => t + a.q, 0), 0));
    const dias = Math.max(0, diasEntre(ped.chegada, hoje));
    const agora = vendidasAte(null);
    out.push({
      pedidoId,
      numero: ped.numero,
      fornecedor: ped.fornecedor,
      chegada: ped.chegada,
      chegadaEstimada: ped.estimada,
      diasDesdeChegada: dias,
      entrou: ped.entrou,
      vendidasAteAgora: agora,
      sellThroughAteAgora: r4(Math.min(1, agora / ped.entrou)),
      marcos: marcos.map((n) => {
        if (dias < n) return { dias: n, vendidas: null, sellThrough: null };
        const vendidas = vendidasAte(somarDias(ped.chegada, n));
        return { dias: n, vendidas, sellThrough: r4(Math.min(1, vendidas / ped.entrou)) };
      }),
    });
  }
  out.sort((a, b) => b.chegada.localeCompare(a.chegada) || a.pedidoId.localeCompare(b.pedidoId));
  return opcoes.limite ? out.slice(0, opcoes.limite) : out;
}

/* ------------------------------------------------------------ estoque */

export interface IndicadoresEstoque {
  pecas: number;
  /** Capital em estoque: custo × estoque. */
  capital: number;
  capitalParado: number;
  pecasParadas: number;
  /** Parte do capital em estoque que está parada (0 a 1). */
  pctParado: number | null;
  /** Venda média de peças por dia na janela (até a última venda importada). */
  vendaMediaDiaria: number;
  janelaDias: number;
  /** Estoque ÷ venda média diária (nula sem vendas na janela). */
  coberturaDias: number | null;
  /** Peças com estoque e sem custo (ficam fora do capital). */
  semCusto: number;
}

/**
 * Indicadores do estoque estimado: % parado (pelo capital), capital (custo × estoque) e cobertura em dias
 * (estoque ÷ venda média diária dos últimos `janela` dias até a última venda importada).
 */
export function indicadoresEstoque(skus: SkuAnalise[], vendas: VendaResumo[], fim: string | null, janela = 90): IndicadoresEstoque {
  let pecas = 0;
  let capital = 0;
  let capitalParado = 0;
  let pecasParadas = 0;
  let semCusto = 0;
  for (const s of skus) {
    if (s.estoque <= 0) continue;
    pecas += s.estoque;
    if (s.custo == null) semCusto++;
    const valor = s.estoque * (s.custo ?? 0);
    capital += valor;
    if (s.status === "parado") {
      capitalParado += valor;
      pecasParadas += s.estoque;
    }
  }
  let vendidas = 0;
  let janelaDias = 0;
  if (fim) {
    const datas = vendas.map((v) => v.data).filter((d): d is string => !!d && d <= fim).sort();
    if (datas.length) {
      const inicio = datas[0] > somarDias(fim, -(janela - 1)) ? datas[0] : somarDias(fim, -(janela - 1));
      janelaDias = diasEntre(inicio, fim) + 1;
      for (const v of vendas) if (v.data && v.data >= inicio && v.data <= fim) vendidas += v.quantidade;
    }
  }
  const vendaMediaDiaria = janelaDias > 0 ? Math.max(0, vendidas) / janelaDias : 0;
  return {
    pecas: r2(pecas),
    capital: r2(capital),
    capitalParado: r2(capitalParado),
    pecasParadas: r2(pecasParadas),
    pctParado: capital > 0 ? r4(capitalParado / capital) : null,
    vendaMediaDiaria: r4(vendaMediaDiaria),
    janelaDias,
    coberturaDias: vendaMediaDiaria > 0 ? Math.round(pecas / vendaMediaDiaria) : null,
    semCusto,
  };
}

/* ------------------------------------------------------------- backup */

export interface AvisoBackup {
  /** Banco local (no computador da loja). Com Turso (nuvem), não se aplica. */
  aplica: boolean;
  ultimaCopia: string | null; // ISO
  dias: number | null; // dias desde a última cópia fora do computador
  alerta: boolean; // mais de 7 dias ou nunca
  erro: string | null;
}

export const DIAS_ALERTA_BACKUP = 7;

/** Dias desde a última cópia do backup fora do computador; alerta com mais de 7 dias ou nunca (só com banco local). */
export function avisoBackup(estado: { local: boolean; copiaExterna: { em: string | null; erro?: string | null } }, hoje: string): AvisoBackup {
  if (!estado.local) return { aplica: false, ultimaCopia: null, dias: null, alerta: false, erro: null };
  const em = estado.copiaExterna.em;
  const diaCopia = em ? new Date(em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null;
  const dias = diaCopia && /^\d{4}-\d{2}-\d{2}$/.test(diaCopia) ? Math.max(0, diasEntre(diaCopia, hoje)) : null;
  return { aplica: true, ultimaCopia: em, dias, alerta: dias == null || dias > DIAS_ALERTA_BACKUP, erro: estado.copiaExterna.erro ?? null };
}
