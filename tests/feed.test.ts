import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUNAS_META,
  campoCsv,
  campoTsv,
  cortar,
  emTitulo,
  enderecoPrivado,
  linhaMeta,
  montarFeedMeta,
  precoMeta,
  preencherLink,
  urlBaseDe,
  whatsappValido,
  type ContextoFeed,
  type ProdutoFeed,
} from "../src/lib/feed-meta";

const ctx: ContextoFeed = {
  urlBase: "https://fiodeamor.exemplo.com",
  marca: "Fio de Amor Semijoias",
  whatsapp: "55 (11) 99999-0000",
  linkModelo: "https://wa.me/{whatsapp}?text=Ol%C3%A1!%20Tenho%20interesse%20na%20pe%C3%A7a%20{referencia}",
  taxonomia: {
    tipos: [{ id: "brinco", nome: "Brinco" }],
    materiais: [{ id: "semijoia", nome: "Semijoia (folheado)" }],
    banhos: [
      { id: "ouro_18k", nome: "Ouro 18k (amarelo)" },
      { id: "sem_banho", nome: "Sem banho" },
    ],
    cores_pedra: [
      { id: "zirconia_branca", nome: "Zircônia branca" },
      { id: "perola", nome: "Pérola (sintética / shell pearl)" },
      { id: "esmalte_branco", nome: "Esmalte branco / branco perolado" },
      { id: "sem_pedra", nome: "Sem pedra" },
    ],
  },
  fotos: {},
};

const base: ProdutoFeed = {
  id: "p1",
  referencia: "BR_2611001",
  codigoBarras: "9100000000015",
  nome: "BRINCO (SJ) ARGOLA DE ZIRCÔNIA 18K",
  nomeComercial: null,
  traducao: null,
  avaliacao: "Argola delicada com zircônias,\npara o dia a dia.",
  legenda: null,
  tipo: "brinco",
  material: "semijoia",
  banho: "ouro_18k",
  corPedra: ["zirconia_branca"],
  tamanho: "Único",
  grupo: null,
  estilo: "delicado",
  quantidade: 3,
  precoVenda: 22.99,
  status: "aprovado",
  imagemId: "img-principal",
};

/** Lê um CSV simples (RFC 4180) para conferir o escape. */
function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\r" && texto[i + 1] === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
      i++;
    } else campo += c;
  }
  return linhas;
}

test("Feed Meta: colunas na especificação do catálogo", () => {
  const { texto } = montarFeedMeta([base], ctx);
  const [cabecalho] = lerCsv(texto);
  assert.deepEqual(cabecalho, [...COLUNAS_META]);
  assert.ok(cabecalho.includes("google_product_category"));
});

test("Feed Meta: linha completa de uma peça aprovada", () => {
  const l = linhaMeta(base, ctx);
  assert.equal(l.id, "9100000000015");
  assert.equal(l.title, "Brinco Argola de Zircônia 18K");
  assert.equal(l.description, "Argola delicada com zircônias, para o dia a dia. Material: Semijoia (folheado). Banho: Ouro 18k (amarelo).");
  assert.equal(l.availability, "in stock");
  assert.equal(l.condition, "new");
  assert.equal(l.price, "22.99 BRL");
  assert.equal(l.link, "https://wa.me/5511999990000?text=Ol%C3%A1!%20Tenho%20interesse%20na%20pe%C3%A7a%20BR_2611001");
  assert.equal(l.image_link, "https://fiodeamor.exemplo.com/api/imagens/img-principal");
  assert.equal(l.additional_image_link, "");
  assert.equal(l.brand, "Fio de Amor Semijoias");
  assert.equal(l.google_product_category, "Apparel & Accessories > Jewelry");
  assert.equal(l.item_group_id, "BR_2611001");
  assert.equal(l.color, "Zircônia branca");
  assert.equal(l.material, "Semijoia (folheado)");
  assert.equal(l.size, "Único");
  assert.equal(l.inventory, "3");
  assert.equal(l.custom_label_0, "Brinco");
  assert.equal(l.custom_label_1, "delicado");
});

test("Feed Meta: nome comercial vence; sem EAN usa referência + id; grupo vira item_group_id", () => {
  const l = linhaMeta({ ...base, codigoBarras: null, nomeComercial: "Argola Luz Dourada", grupo: "BR_2611001-G", quantidade: 0 }, ctx);
  assert.equal(l.title, "Argola Luz Dourada");
  assert.equal(l.id, "BR_2611001_p1");
  assert.equal(l.item_group_id, "BR_2611001-G");
  assert.equal(l.availability, "out of stock");
  assert.equal(l.inventory, "0");
});

test("Feed Meta: título até 150 caracteres, cortado entre palavras", () => {
  const longo = "colar ".repeat(40);
  const l = linhaMeta({ ...base, nomeComercial: null, nome: longo }, ctx);
  assert.ok(l.title.length <= 150);
  assert.ok(!l.title.endsWith(" "));
  assert.equal(cortar("abc def ghi", 9), "abc def");
});

test("Feed Meta: Title Case em português", () => {
  assert.equal(emTitulo("COLAR DE PÉROLAS COM PINGENTE 45CM"), "Colar de Pérolas com Pingente 45cm");
  assert.equal(emTitulo("  anel   ajustável\nprata 925 "), "Anel Ajustável Prata 925");
  assert.equal(emTitulo("E DE AMOR"), "E de Amor");
});

test("Feed Meta: só a foto com IA aprovada pela loja vira image_link; a do catálogo vira adicional", () => {
  const publicavel = linhaMeta(base, { ...ctx, fotos: { p1: { id: "img-ia", aprovada: true, publicavel: true } } });
  assert.equal(publicavel.image_link, "https://fiodeamor.exemplo.com/api/imagens/img-ia");
  assert.equal(publicavel.additional_image_link, "https://fiodeamor.exemplo.com/api/imagens/img-principal");

  // Aprovada só pelo marketing (IA), ainda na fila da loja: não vai para o catálogo.
  const naFila = linhaMeta(base, { ...ctx, fotos: { p1: { id: "img-ia", aprovada: true, publicavel: false } } });
  assert.equal(naFila.image_link, "https://fiodeamor.exemplo.com/api/imagens/img-principal");
  assert.equal(naFila.additional_image_link, "");

  const reprovada = linhaMeta(base, { ...ctx, fotos: { p1: { id: "img-ia", aprovada: false } } });
  assert.equal(reprovada.image_link, "https://fiodeamor.exemplo.com/api/imagens/img-principal");
  assert.equal(reprovada.additional_image_link, "");

  // Sem foto do catálogo, a aprovada pela loja é a única.
  const soIa = linhaMeta({ ...base, imagemId: null }, { ...ctx, fotos: { p1: { id: "img-ia", aprovada: null, publicavel: true } } });
  assert.equal(soIa.image_link, "https://fiodeamor.exemplo.com/api/imagens/img-ia");
  assert.equal(soIa.additional_image_link, "");
});

test("Feed Meta: sem pedra usa o banho como cor; legenda sem hashtags", () => {
  const l = linhaMeta({ ...base, corPedra: ["sem_pedra"], avaliacao: null, legenda: "Brilho para o dia ✨ #fiodeamor #semijoias" }, ctx);
  assert.equal(l.color, "Ouro 18k");
  assert.equal(l.description, "Brilho para o dia ✨. Material: Semijoia (folheado). Banho: Ouro 18k (amarelo).");
});

test("Feed Meta: várias cores de pedra viram nomes curtos separados por barra", () => {
  const l = linhaMeta({ ...base, corPedra: ["perola", "esmalte_branco", "zirconia_branca", "sem_pedra"] }, ctx);
  assert.equal(l.color, "Pérola/Esmalte branco/Zircônia branca");
});

test("Feed Meta: por padrão só aprovadas, com preço e com foto; todos=1 inclui tudo", () => {
  const produtos: ProdutoFeed[] = [
    base,
    { ...base, id: "p2", codigoBarras: "9100000000022", status: "rascunho" },
    { ...base, id: "p3", codigoBarras: "9100000000039", precoVenda: null },
    { ...base, id: "p4", codigoBarras: "9100000000046", imagemId: null },
  ];
  const padrao = montarFeedMeta(produtos, ctx);
  assert.equal(padrao.itens, 1);
  assert.equal(padrao.ignorados, 3);
  const todos = montarFeedMeta(produtos, ctx, { todos: true });
  assert.equal(todos.itens, 4);
});

test("Feed Meta: recompra com o mesmo EAN vira uma linha só, com o estoque somado", () => {
  const r = montarFeedMeta([base, { ...base, id: "p9", quantidade: 2, precoVenda: 24.99 }], ctx);
  assert.equal(r.itens, 1);
  const [, linha] = lerCsv(r.texto);
  assert.equal(linha[COLUNAS_META.indexOf("inventory")], "5");
  assert.equal(linha[COLUNAS_META.indexOf("price")], "24.99 BRL");
});

test("Feed Meta: escape de CSV com vírgula, aspas e quebra de linha", () => {
  assert.equal(campoCsv("simples"), "simples");
  assert.equal(campoCsv("a, b"), '"a, b"');
  assert.equal(campoCsv('colar "luxo"'), '"colar ""luxo"""');
  assert.equal(campoCsv("linha1\nlinha2"), '"linha1\nlinha2"');
  assert.equal(campoCsv(" borda"), '" borda"');
  assert.equal(campoCsv(null), "");
  const p = { ...base, nomeComercial: 'Argola "Luz", dourada' };
  const [, linha] = lerCsv(montarFeedMeta([p], ctx).texto);
  assert.equal(linha.length, COLUNAS_META.length);
  assert.equal(linha[COLUNAS_META.indexOf("title")], 'Argola "Luz", dourada');
  assert.ok(!montarFeedMeta([p], ctx).texto.includes(";"));
});

test("Feed Meta: TSV separado por tab, sem tabs nem quebras dentro dos campos", () => {
  assert.equal(campoTsv("a\tb\nc"), "a b c");
  const { texto } = montarFeedMeta([{ ...base, nomeComercial: "Argola\tLuz" }], ctx, { formato: "tsv" });
  const [cab, linha] = texto.trimEnd().split("\r\n");
  assert.equal(cab.split("\t").length, COLUNAS_META.length);
  assert.equal(linha.split("\t").length, COLUNAS_META.length);
  assert.equal(linha.split("\t")[COLUNAS_META.indexOf("title")], "Argola Luz");
});

test("Feed Meta: preço e link do WhatsApp", () => {
  assert.equal(precoMeta(22.99), "22.99 BRL");
  assert.equal(precoMeta(150), "150.00 BRL");
  assert.equal(precoMeta(null), "");
  assert.equal(precoMeta(0), "");
  assert.equal(
    preencherLink("https://wa.me/{whatsapp}?text=Olá! Quero a peça {referencia} – {nome}", { whatsapp: "5511999990000", referencia: "BR_1", nome: "Argola & Luz" }),
    "https://wa.me/5511999990000?text=Ol%C3%A1!%20Quero%20a%20pe%C3%A7a%20BR_1%20%E2%80%93%20Argola%20%26%20Luz",
  );
  assert.equal(preencherLink("https://loja.com/p?q=100%", { referencia: "x" }), "https://loja.com/p?q=100%25");
  assert.ok(whatsappValido("5511999990000"));
  assert.ok(whatsappValido("+55 (11) 3333-4444"));
  assert.ok(!whatsappValido("11999990000"));
});

test("Feed Meta: endereço base absoluto e detecção de endereço só da loja", () => {
  assert.equal(urlBaseDe({ publica: "https://fiodeamor.vercel.app/", origem: "http://localhost:3000" }), "https://fiodeamor.vercel.app");
  assert.equal(urlBaseDe({ host: "fiodeamor.vercel.app", proto: "https,http", origem: "http://localhost:3000" }), "https://fiodeamor.vercel.app");
  assert.equal(urlBaseDe({ host: "192.168.0.10:3000", origem: "http://localhost:3000" }), "http://192.168.0.10:3000");
  assert.equal(urlBaseDe({ host: "mal<script>", origem: "http://localhost:3000/" }), "http://localhost:3000");
  assert.ok(enderecoPrivado("http://localhost:3000"));
  assert.ok(enderecoPrivado("http://192.168.0.10:3000"));
  assert.ok(enderecoPrivado("http://loja-pc:3000"));
  assert.ok(!enderecoPrivado("https://fiodeamor.vercel.app"));
});
