import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig, getSegredo, type Taxonomia, type UpVendasConfig } from "./config";
import type { PoliticaPreco } from "./precos";
import type { Produto } from "./db/schema";
import { fotosModeloPorProduto } from "./fotos";

/**
 * Integração com o UP Vendas.
 *
 * O UP Vendas não publica a documentação da API de produtos. O que se sabe (repositório público
 * "api-doc-upvendas-bpo"): servidor https://ms.upvendas.app, login com domínio/usuário/senha que devolve
 * o token JWT no cabeçalho Authorization, usado como Bearer nas demais chamadas.
 * Por isso os caminhos e nomes de campos são CONFIGURÁVEIS (Configurações → UP Vendas): quando o suporte do
 * UP enviar a documentação, basta ajustar sem mexer no código. Enquanto isso, use a exportação em planilha.
 */

/** Campos do cadastro "Cadastro de Produtos Simplificado" do UP Vendas (mesma ordem da tela). */
export interface LinhaUp {
  nome: string;
  marca: string;
  referencia: string;
  codigoExterno: string;
  ncm: string;
  unidade: string;
  categoriaVitrine: string;
  custoCompraBruto: number;
  custoInsumo: number;
  milesimos: number;
  banhoOuro: number;
  banhoPrata: number;
  banhoRodio: number;
  banhoVerniz: number;
  custoTotal: number;
  tabelaPreco: string;
  percentualLucro: number;
  valorTabela: number;
  tabelaPreco2: string;
  percentualLucro2: number;
  valorTabela2: number;
  descricaoGrade: string;
  codigoBarras: string;
  estoque: number;
  ativo: boolean;
  acabado: boolean;
  compartilhar: boolean;
  sincronizarUpVendas: boolean;
  imagemUrl: string;
  // extras do app
  tipo: string;
  material: string;
  banho: string;
  corPedra: string;
  tamanho: string;
  nomeComercial: string;
  legenda: string;
}

export interface ContextoUp {
  tax: Taxonomia;
  pol: PoliticaPreco;
  up: UpVendasConfig;
  marca: string;
  codigoNoUp: "ean13" | "code128";
  urlBase: string; // para montar o link público da imagem
  fotos: Record<string, { id: string; publicavel: boolean }>; // foto criada pela IA e aprovada pela loja
}

export async function contextoUp(urlBase: string, produtoIds: string[] = []): Promise<ContextoUp> {
  const fotos = await fotosModeloPorProduto(produtoIds);
  const [tax, pol, up, sistema] = await Promise.all([
    getConfig("taxonomia"),
    getConfig("precificacao"),
    getConfig("upvendas"),
    getConfig("sistema"),
  ]);
  return { tax, pol, up, marca: sistema.marcaUp, codigoNoUp: sistema.codigoNoUp ?? "ean13", urlBase, fotos };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function linhaUp(p: Produto, ctx: ContextoUp): LinhaUp {
  const tipo = ctx.tax.tipos.find((t) => t.id === p.tipo);
  const material = ctx.tax.materiais.find((m) => m.id === p.material);
  const banho = ctx.tax.banhos.find((b) => b.id === p.banho);
  const custo = p.custoTotalBrl ?? 0;
  // Foto aprovada pela loja (fila de aprovação) tem prioridade; senão a foto principal.
  const fotoId = ctx.fotos[p.id]?.publicavel ? ctx.fotos[p.id].id : p.imagemId;
  const base = ctx.pol.tabelas_preco.find((t) => t.id === ctx.pol.tabela_base);
  const segunda = ctx.pol.tabelas_preco.find((t) => t.tabela_up_vendas && t.id !== ctx.pol.tabela_base);
  const valor2 = segunda ? (p.precos?.[segunda.id] ?? 0) : 0;
  let descricaoGrade = material?.descricao_grade ?? `${material?.nome ?? "SEMIJOIA"}`.toUpperCase();
  if (banho && !/BANHAD|FOLHEAD/.test(descricaoGrade) && banho.id !== "sem_banho") descricaoGrade += ` BANHADA A ${banho.nome.toUpperCase()}`;
  if (p.variacao) descricaoGrade += ` - ${p.variacao.toUpperCase()}`;
  return {
    nome: (p.nome ?? "").toUpperCase(),
    marca: ctx.marca,
    referencia: p.referencia ?? "",
    codigoExterno: p.codigoFornecedor ?? "",
    ncm: p.ncm ?? "",
    unidade: p.unidade,
    categoriaVitrine: [tipo?.categoria_vitrine ?? tipo?.nome, p.subtipo].filter(Boolean).join(" - "),
    custoCompraBruto: r2(p.custoProdutoBrl ?? 0),
    custoInsumo: r2(p.custoAdicionalBrl ?? 0),
    milesimos: 0,
    banhoOuro: 0,
    banhoPrata: 0,
    banhoRodio: 0,
    banhoVerniz: 0,
    custoTotal: r2(custo),
    tabelaPreco: base?.tabela_up_vendas ?? base?.nome ?? "CONSIGNADO",
    percentualLucro: custo > 0 ? r2(((p.precoVenda ?? 0) / custo - 1) * 100) : 0,
    valorTabela: p.precoVenda ?? 0,
    tabelaPreco2: segunda?.nome ?? "",
    percentualLucro2: custo > 0 && valor2 ? r2((valor2 / custo - 1) * 100) : 0,
    valorTabela2: valor2,
    descricaoGrade,
    // Code128 curto = os 8 dígitos da sequência (EAN "9100"+SEQ8+DV) — deve ser igual ao impresso na etiqueta.
    codigoBarras: ctx.codigoNoUp === "code128" && p.codigoBarras ? p.codigoBarras.replace(/^9100/, "").slice(0, -1) : (p.codigoBarras ?? ""),
    estoque: p.quantidade,
    ativo: true,
    acabado: true,
    compartilhar: true,
    sincronizarUpVendas: true,
    imagemUrl: fotoId ? `${ctx.urlBase}/api/imagens/${fotoId}` : "",
    tipo: tipo?.nome ?? p.tipo ?? "",
    material: material?.nome ?? p.material ?? "",
    banho: banho?.nome ?? p.banho ?? "",
    corPedra: (p.corPedra ?? []).map((c) => ctx.tax.cores_pedra.find((x) => x.id === c)?.nome ?? c).join(", "),
    tamanho: p.tamanho ?? "",
    nomeComercial: p.nomeComercial ?? "",
    legenda: p.legenda ?? "",
  };
}

/* ---------------------------------------------------------------- API */

function definir(obj: Record<string, unknown>, caminho: string, valor: unknown) {
  const partes = caminho.split(".");
  let atual: Record<string, unknown> = obj;
  partes.forEach((parte, i) => {
    if (i === partes.length - 1) atual[parte] = valor;
    else {
      const proxEhIndice = /^\d+$/.test(partes[i + 1]);
      atual[parte] ??= proxEhIndice ? [] : {};
      atual = atual[parte] as Record<string, unknown>;
    }
  });
}

/** Monta o JSON enviado ao UP a partir do mapa de campos configurável. */
export function payloadUp(linha: LinhaUp, up: UpVendasConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [campoApp, campoUp] of Object.entries(up.mapaCampos)) {
    if (!campoUp) continue;
    const valor = campoApp === "tabelaPreco" ? up.tabelaPreco || linha.tabelaPreco : (linha as unknown as Record<string, unknown>)[campoApp];
    if (valor !== undefined) definir(out, campoUp, valor);
  }
  return out;
}

async function login(up: UpVendasConfig): Promise<string> {
  const senha = await getSegredo("UPVENDAS_SENHA");
  if (!up.dominio || !up.usuario || !senha) throw new Error("Preencha domínio, usuário e senha do UP Vendas em Configurações.");
  const res = await fetch(new URL(up.caminhoLogin, up.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ dominio: up.dominio, usuario: up.usuario, senha }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Login no UP Vendas falhou (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  let token: string | undefined;
  if (up.campoToken.startsWith("header:")) token = res.headers.get(up.campoToken.slice(7)) ?? undefined;
  else {
    const json = (await res.json()) as Record<string, unknown>;
    token = up.campoToken
      .slice(5)
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], json) as string | undefined;
  }
  if (!token) throw new Error(`Login OK, mas não encontrei o token em "${up.campoToken}".`);
  return token.replace(/^Bearer\s+/i, "");
}

export async function testarConexao() {
  const up = await getConfig("upvendas");
  const token = await login(up);
  return { ok: true, mensagem: `Login realizado (token de ${token.length} caracteres).` };
}

export async function enviarProdutos(ids: string[], urlBase: string, simular = false) {
  const db = await getDb();
  const ctx = await contextoUp(urlBase, ids);
  const token = simular ? "" : await login(ctx.up);
  const resultados: { id: string; referencia: string | null; ok: boolean; mensagem: string; payload?: unknown }[] = [];
  for (const id of ids) {
    const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!p) continue;
    const faltando = [!p.nome && "nome", !p.referencia && "referência", !p.codigoBarras && "código de barras", !p.precoVenda && "preço"].filter(Boolean);
    if (faltando.length) {
      resultados.push({ id, referencia: p.referencia, ok: false, mensagem: `Falta: ${faltando.join(", ")}` });
      continue;
    }
    const payload = payloadUp(linhaUp(p, ctx), ctx.up);
    if (simular) {
      resultados.push({ id, referencia: p.referencia, ok: true, mensagem: "Simulação (nada enviado)", payload });
      continue;
    }
    try {
      const res = await fetch(new URL(ctx.up.caminhoProdutos, ctx.up.baseUrl), {
        method: ctx.up.metodoCriar,
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      const texto = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 300)}`);
      let upId: string | null = null;
      try {
        const j = JSON.parse(texto);
        upId = String(j.id ?? j.idproduto ?? j.codigo ?? j.data?.id ?? "") || null;
      } catch {}
      await db
        .update(schema.produtos)
        .set({ upId, upStatus: "enviado", upMensagem: "Enviado", upSincronizadoEm: new Date().toISOString() })
        .where(eq(schema.produtos.id, id));
      resultados.push({ id, referencia: p.referencia, ok: true, mensagem: upId ? `Criado no UP (id ${upId})` : "Enviado" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(schema.produtos).set({ upStatus: "erro", upMensagem: msg }).where(eq(schema.produtos.id, id));
      resultados.push({ id, referencia: p.referencia, ok: false, mensagem: msg });
    }
  }
  return resultados;
}
