import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig, getSegredo, type UpVendasConfig } from "./config";
import { fotosModeloPorProduto } from "./fotos";
import { codigoParaUp } from "./upvendas-codigo";
import { ehRecompraUp, linhaUp, type ContextoUp, type LinhaUp } from "./upvendas-planilha";
import { urlNoServidorUp } from "./upvendas-url";
export { codigoParaUp, linhaUp, type ContextoUp, type LinhaUp };

/**
 * Integração com o UP Vendas.
 *
 * O UP Vendas não publica a documentação da API de produtos. O que se sabe (repositório público
 * "api-doc-upvendas-bpo"): servidor https://ms.upvendas.app, login com domínio/usuário/senha que devolve
 * o token JWT no cabeçalho Authorization, usado como Bearer nas demais chamadas.
 * Por isso os caminhos e nomes de campos são CONFIGURÁVEIS (Configurações → UP Vendas): quando o suporte do
 * UP enviar a documentação, basta ajustar sem mexer no código. Enquanto isso, use a exportação em planilha.
 *
 * A linha do cadastro (linhaUp) e as planilhas de produtos novos e de recompras ficam em upvendas-planilha.ts
 * (funções puras, testadas). Pela API só vão os produtos NOVOS: a recompra já existe no UP e entra no estoque
 * pela planilha de recompras.
 */

export async function contextoUp(urlBase: string, produtoIds: string[] = []): Promise<ContextoUp> {
  const fotos = await fotosModeloPorProduto(produtoIds);
  const [tax, pol, up, sistema] = await Promise.all([
    getConfig("taxonomia"),
    getConfig("precificacao"),
    getConfig("upvendas"),
    getConfig("sistema"),
  ]);
  return { tax, pol, up, marca: sistema.marcaUp, codigoNoUp: sistema.codigoNoUp ?? "ean13", origemCodigoBarras: sistema.origemCodigoBarras ?? "upvendas", urlBase, fotos };
}

/* ---------------------------------------------------------------- API */

function definir(obj: Record<string, unknown>, caminho: string, valor: unknown) {
  const partes = caminho.split(".");
  // Nomes que mexeriam nos objetos do próprio JavaScript (mapa de campos mal digitado): ignora o campo.
  if (partes.some((p) => !p || p === "__proto__" || p === "prototype" || p === "constructor")) return;
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

/**
 * Chamada ao servidor do UP sem seguir redirecionamento: a senha (login) e o token (cadastro) só vão para o
 * endereço configurado. Um 3xx do UP vira erro em vez de reenviar os dados para outro endereço.
 */
async function chamarUp(caminho: string, up: UpVendasConfig, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  const url = urlNoServidorUp(caminho, up.baseUrl);
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.status >= 300 && res.status < 400)
    throw new Error(`O UP Vendas respondeu com redirecionamento (HTTP ${res.status}). Por segurança, nada foi reenviado: confira o servidor e o caminho em UP Vendas → Conexão com a API.`);
  return res;
}

async function login(up: UpVendasConfig): Promise<string> {
  const senha = await getSegredo("UPVENDAS_SENHA");
  if (!up.dominio || !up.usuario || !senha) throw new Error("Preencha domínio, usuário e senha do UP Vendas em Configurações.");
  const res = await chamarUp(up.caminhoLogin, up, {
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

export type ResultadoEnvioUp = { id: string; referencia: string | null; ok: boolean; mensagem: string; recompra?: boolean; payload?: unknown };

/**
 * Cria no UP os produtos NOVOS (cadastro completo, saldo = estoqueEntrada). Recompra não é enviada:
 * o produto já existe no UP (mesmo código) e a entrada de estoque vai pela planilha de recompras.
 */
export async function enviarProdutos(ids: string[], urlBase: string, simular = false) {
  const db = await getDb();
  const ctx = await contextoUp(urlBase, ids);
  const produtos = new Map((ids.length ? await db.select().from(schema.produtos).where(inArray(schema.produtos.id, ids)) : []).map((p) => [p.id, p]));
  const resultados: ResultadoEnvioUp[] = [];
  const novos = ids.filter((id) => {
    const p = produtos.get(id);
    if (p && ehRecompraUp(p)) {
      resultados.push({ id, referencia: p.referencia, ok: false, recompra: true, mensagem: "Recompra: o produto já existe no UP. Dê entrada no estoque pela planilha de recompras." });
      return false;
    }
    return !!p;
  });
  const token = simular || !novos.length ? "" : await login(ctx.up);
  for (const id of novos) {
    const p = produtos.get(id)!;
    // Código de barras: no padrão da loja quem cria é o UP (vai em branco); só no modo "app" o EAN interno é obrigatório.
    const faltando = [!p.nome && "nome", !p.referencia && "referência", ctx.origemCodigoBarras === "app" && !p.codigoBarras && "código de barras", !p.precoVenda && "preço"].filter(Boolean);
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
      const res = await chamarUp(ctx.up.caminhoProdutos, ctx.up, {
        method: ctx.up.metodoCriar === "PUT" ? "PUT" : "POST",
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
  // Na ordem em que a tela mandou.
  const ordem = new Map(ids.map((id, i) => [id, i]));
  return resultados.sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
}
