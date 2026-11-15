import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarVendas, type ProdutoBase, type VendaBase } from "../src/lib/vendas-calculo";
import { sugerirMaleta, type VendaMaleta } from "../src/lib/maleta-calculo";

/* Códigos e nomes fictícios. */
let seq = 0;
function produto(p: Partial<ProdutoBase> = {}): ProdutoBase {
  seq++;
  return {
    id: `m${seq}`,
    codigoBarras: `78911111${String(seq).padStart(5, "0")}`,
    referencia: `ABC${String(seq).padStart(3, "0")}M`,
    codigoFornecedor: null,
    nome: `PEÇA ${seq}`,
    nomeComercial: null,
    tipo: "brinco",
    quantidade: 5,
    precoVenda: 85,
    custoTotalBrl: 8.5,
    imagemId: null,
    destaque: false,
    criadoEm: "2026-01-01T00:00:00.000Z",
    recompraDe: null,
    linha: seq,
    fornecedor: "Fornecedor Teste",
    dataPedido: "2026-01-01",
    codigoBarrasOrigem: "up",
    ...p,
  };
}
const HOJE = "2026-11-15";
const PARAMS = { hoje: HOJE, prazoReposicaoDias: 45, diasEstoqueParado: 120 };

function maleta(produtos: ProdutoBase[], pedido: { valorAlvo: number; pecasAlvo: number; revendedora?: string }, extra: { comRevendedoras?: Map<string, number>; comEla?: string[]; devolvidas?: string[] } = {}) {
  const a = analisarVendas(produtos, [], { ...PARAMS, comRevendedoras: extra.comRevendedoras });
  return sugerirMaleta(a.skus, [] as VendaMaleta[], pedido, { hoje: HOJE, consignado: { comEla: extra.comEla, devolvidas: extra.devolvidas } });
}

test("Maleta sem teto (padrão): fecha pelas peças-alvo, sem encolher pelo valor", () => {
  const produtos = Array.from({ length: 100 }, () => produto());
  const r = maleta(produtos, { valorAlvo: 0, pecasAlvo: 85 });
  assert.equal(r.teto, null);
  assert.equal(r.totais.pecas, 85);
  assert.equal(r.totais.valor, 85 * 85);
  assert.equal(r.valorReferencia, 85 * 85); // peças-alvo × preço médio das disponíveis
  assert.ok(!r.avisos.some((x) => x.includes("teto")));
});

test("Maleta com teto: nunca passa do valor e avisa quantas peças couberam", () => {
  const produtos = Array.from({ length: 100 }, () => produto());
  const r = maleta(produtos, { valorAlvo: 4000, pecasAlvo: 85 });
  assert.equal(r.teto, 4000);
  assert.ok(r.totais.valor <= 4000, `valor ${r.totais.valor}`);
  assert.equal(r.totais.pecas, 47); // 47 × 85 = 3.995
  assert.ok(r.avisos.some((x) => x.startsWith("O teto de R$") && x.includes("47 peças") && x.includes("85 pedidas")));
});

test("Maleta: só peças que já chegaram e que o UP conhece; disponível desconta as revendedoras", () => {
  const chegou = produto();
  const caminho = produto({ recebimento: "em_transito" });
  const futura = produto({ dataChegada: "2026-12-10" });
  const foraDoUp = produto({ codigoBarrasOrigem: "app" });
  const comOutras = produto({ quantidade: 3 });
  const r = maleta([chegou, caminho, futura, foraDoUp, comOutras], { valorAlvo: 0, pecasAlvo: 10 }, { comRevendedoras: new Map([[comOutras.codigoBarras!, 3]]) });
  assert.deepEqual(
    r.itens.map((i) => i.produtoId),
    [chegou.id],
  );
  assert.equal(r.itens[0].estoque, 5); // disponível
  assert.equal(r.fora.foraDoUp, 1);
  assert.equal(r.fora.comRevendedoras, 1);
  assert.ok(r.avisos.some((x) => x.includes("sem cadastro no UP")));
});

test("Maleta: não manda o que a revendedora já tem nem o que ela devolveu; quantidade até o disponível", () => {
  const jaTem = produto();
  const devolveu = produto();
  const boa = produto({ quantidade: 4 });
  const r = maleta([jaTem, devolveu, boa], { valorAlvo: 0, pecasAlvo: 10, revendedora: "Revendedora A" }, { comEla: [jaTem.codigoBarras!], devolvidas: [devolveu.codigoBarras!], comRevendedoras: new Map([[boa.codigoBarras!, 3]]) });
  assert.deepEqual(
    r.itens.map((i) => [i.produtoId, i.quantidade, i.estoque]),
    [[boa.id, 1, 1]],
  );
  assert.equal(r.fora.jaComEla, 1);
  assert.equal(r.fora.devolvidas, 1);
  assert.ok(r.avisos.some((x) => x.includes("já estão com Revendedora A")));
  assert.ok(r.avisos.some((x) => x.includes("Revendedora A já devolveu")));
});

test("Maleta: campeã leva 2 só se houver 2 disponíveis", () => {
  const campea = produto({ quantidade: 10 });
  const vendas: VendaBase[] = [{ data: "2026-10-01", referencia: null, codigoBarras: campea.codigoBarras, produtoId: null, quantidade: 6, valorTotal: 510, revendedora: "Revendedora B" }];
  const ligadas: VendaMaleta[] = vendas.map((v) => ({ chave: v.codigoBarras, revendedora: v.revendedora, quantidade: v.quantidade, valorTotal: v.valorTotal }));
  const comRev = (n: number) => sugerirMaleta(analisarVendas([campea], vendas, { ...PARAMS, comRevendedoras: new Map([[campea.codigoBarras!, n]]) }).skus, ligadas, { valorAlvo: 0, pecasAlvo: 5 }, { hoje: HOJE });
  // Estoque 10 − 6 = 4.
  const r = comRev(2); // 2 disponíveis
  assert.equal(r.itens[0].campea, true);
  assert.equal(r.itens[0].quantidade, 2);
  assert.equal(comRev(3).itens[0].quantidade, 1); // 1 disponível
  assert.equal(comRev(4).itens.length, 0); // todas com as revendedoras
  assert.equal(comRev(4).fora.comRevendedoras, 1);
});
