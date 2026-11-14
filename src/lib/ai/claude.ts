import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getConfig, getSegredo, type Marca, type Taxonomia } from "../config";
import { PERSONAS } from "./personas";
import { checarLimiteIa, registrarGasto, type ContextoGasto, type Finalidade } from "../gastos";

export class IaIndisponivel extends Error {}

async function cliente() {
  const apiKey = await getSegredo("ANTHROPIC_API_KEY");
  if (!apiKey) throw new IaIndisponivel("Configure a chave da Anthropic (Claude) em Configurações → Integrações.");
  return new Anthropic({ apiKey });
}

/**
 * Chamada estruturada ao Claude: resposta validada por um schema Zod.
 * Usa fallback automático do servidor caso o modelo recuse por política (raro neste domínio).
 */
async function chamar<T extends z.ZodType>(opts: {
  sistema: string;
  conteudo: Anthropic.Beta.Messages.BetaContentBlockParam[];
  schema: T;
  maxTokens?: number;
  finalidade: Finalidade;
  ctx?: ContextoGasto;
}): Promise<z.infer<T>> {
  const client = await cliente();
  await checarLimiteIa();
  const sistema = await getConfig("sistema");
  const resposta = await client.beta.messages.parse({
    model: sistema.claudeModelo,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: sistema.claudeEsforco, format: betaZodOutputFormat(opts.schema) },
    system: [{ type: "text", text: opts.sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.conteudo }],
  });
  const uso = resposta.usage;
  await registrarGasto({
    servico: "anthropic",
    modelo: resposta.model ?? sistema.claudeModelo,
    finalidade: opts.finalidade,
    ctx: opts.ctx,
    tokensEntrada: (uso?.input_tokens ?? 0) + (uso?.cache_creation_input_tokens ?? 0) + (uso?.cache_read_input_tokens ?? 0),
    tokensSaida: uso?.output_tokens ?? 0,
  });
  if (resposta.stop_reason === "refusal") {
    throw new Error(`O Claude recusou a solicitação (${resposta.stop_details?.category ?? "sem categoria"}).`);
  }
  if (resposta.stop_reason === "max_tokens") throw new Error("Resposta da IA cortada (limite de tokens). Tente com menos itens por lote.");
  if (!resposta.parsed_output) throw new Error("A IA não devolveu o formato esperado.");
  return resposta.parsed_output as z.infer<T>;
}

/* --------------------------------------------------------------- contexto */

function resumoTaxonomia(tax: Taxonomia) {
  return {
    tipos: tax.tipos.map((t) => ({ id: t.id, nome: t.nome, subtipos: t.subtipos, tamanhos: t.tamanhos.slice(0, 25) })),
    materiais: tax.materiais.map((m) => ({ id: m.id, nome: m.nome, sigla: m.sigla })),
    banhos: tax.banhos.map((b) => ({ id: b.id, nome: b.nome })),
    cores_pedra: tax.cores_pedra.map((c) => ({ id: c.id, nome: c.nome })),
    codigos_fornecedor: tax.codigos_fornecedor,
    glossario_chines: tax.glossario_chines,
  };
}

function regrasNome(marca: Marca) {
  return {
    formato: marca.padrao_nome?.formato ?? "TIPO (SIGLA) DESCRITORES",
    regras: marca.padrao_nome?.regras ?? [],
    exemplos: marca.padrao_nome?.exemplos ?? ["BRINCO (SJ) INFANTIL BARBIE EM RESINA"],
    vocabulario: marca.padrao_nome?.vocabulario,
    tom_de_voz: marca.tom_de_voz,
    hashtags_fixas: marca.hashtags?.fixas ?? [],
  };
}

async function sistemaCatalogo() {
  const [tax, marca] = await Promise.all([getConfig("taxonomia"), getConfig("marca")]);
  return {
    tax,
    texto: `Você trabalha no cadastro de produtos da loja ${marca.nome} (${marca.instagram}), que importa semijoias de fornecedores da China e vende por consignação (maletas de revendedoras) e varejo, com cadastro no ERP UP Vendas.
Você combina três papéis:
${PERSONAS.estoque.resumo}
${PERSONAS.marketing.resumo}

Regras gerais:
- Fale português do Brasil. Traduza termos em chinês usando o glossário; se um termo não estiver nele, traduza pelo contexto e avise em "alertas".
- Use SOMENTE os ids da taxonomia abaixo para tipo, material, banho e cor_pedra.
- Olhe a foto para decidir tipo, subtipo, cor da pedra, banho aparente e estilo; o texto do pedido manda nos códigos, preços e quantidades.
- Fotos de fornecedor mostram cartelas com marca do fornecedor (ex.: "Delicate"), QR codes e etiquetas: ignore-os, não são parte da peça.
- Peças "两件套/三件套/四件套" são conjuntos: eh_conjunto=true e liste os componentes (ex.: "colar 43cm", "pulseira 17cm", "brinco").
- Se não tiver certeza de algo, preencha com a melhor hipótese, baixe "confianca" e explique em "alertas".
- Nomes de cadastro seguem o padrão da marca (MAIÚSCULAS, "TIPO (SIGLA) DESCRITORES", até 60 caracteres). Dê 3 opções diferentes entre si.
- O nome comercial é curto e afetivo, para Instagram. A legenda tem 1–2 linhas no tom da marca.

Taxonomia (JSON):
${JSON.stringify(resumoTaxonomia(tax))}

Padrão de nomes e tom de voz (JSON):
${JSON.stringify(regrasNome(marca))}`,
  };
}

/* ------------------------------------------------- análise de itens (lote) */

export interface ItemParaAnalise {
  id: string;
  texto: string; // linha do documento (pode estar vazia em fotos)
  imagemBase64?: string; // JPEG
}

function schemaItens(tax: Taxonomia) {
  const ids = <T extends { id: string }>(l: T[]) => l.map((x) => x.id) as [string, ...string[]];
  return z.object({
    itens: z.array(
      z.object({
        id: z.string().describe("o mesmo id recebido"),
        codigo_fornecedor: z.string().describe("código/货号 do fornecedor; vazio se não houver"),
        descricao_original: z.string().describe("descrição como está no documento"),
        traducao_pt: z.string(),
        preco_unitario: z.number().nullable().describe("preço unitário na moeda do pedido"),
        quantidade: z.number().int().nullable(),
        tipo: z.enum(ids(tax.tipos)),
        subtipo: z.string(),
        material: z.enum(ids(tax.materiais)),
        banho: z.enum(ids(tax.banhos)),
        cor_pedra: z.array(z.enum(ids(tax.cores_pedra))),
        tamanho: z.string(),
        variacao: z.string().describe("ex.: 'esmalte rosa'; vazio se não houver"),
        eh_conjunto: z.boolean(),
        componentes: z.array(z.string()),
        estilo: z.string(),
        avaliacao: z.string().describe("1 frase: o que é a peça, estilo, público e ocasião"),
        nomes: z.array(z.string()).describe("3 sugestões de nome de cadastro"),
        nome_comercial: z.string(),
        legenda: z.string(),
        hashtags: z.array(z.string()),
        destaque: z.boolean().describe("true se a peça tem alto apelo comercial"),
        confianca: z.number().describe("0 a 1"),
        alertas: z.array(z.string()),
      }),
    ),
  });
}

export type ItemAnalisado = z.infer<ReturnType<typeof schemaItens>>["itens"][number];

export async function analisarItens(
  itens: ItemParaAnalise[],
  contexto: { cabecalho?: string | null; colunas?: string | null; moeda: string; fornecedor?: string | null; pedidoId?: string },
): Promise<ItemAnalisado[]> {
  const { tax, texto } = await sistemaCatalogo();
  const conteudo: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
    {
      type: "text",
      text: `Pedido do fornecedor ${contexto.fornecedor ?? "(desconhecido)"} — moeda ${contexto.moeda}.
Cabeçalho do documento: ${contexto.cabecalho ?? "(não há)"}
Colunas da tabela: ${contexto.colunas ?? "(não identificadas)"}
A seguir vêm ${itens.length} itens, cada um com o texto da linha e a foto. Analise todos e devolva um objeto por item, na mesma ordem.`,
    },
  ];
  for (const it of itens) {
    conteudo.push({ type: "text", text: `### Item id=${it.id}\nTexto da linha: ${it.texto || "(sem texto — use só a foto)"}` });
    if (it.imagemBase64) {
      conteudo.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: it.imagemBase64 } });
    }
  }
  const out = await chamar({ sistema: texto, conteudo, schema: schemaItens(tax), finalidade: "analise", ctx: { pedidoId: contexto.pedidoId } });
  return out.itens;
}

/* ------------------------------------- detecção de peças em foto de catálogo */

const schemaDeteccao = z.object({
  pecas: z.array(
    z.object({
      caixa: z
        .array(z.number())
        .describe("[x0, y0, x1, y1] da peça na imagem, normalizado de 0 a 1000 (canto superior esquerdo = 0,0)"),
      texto_visivel: z.string().describe("código, preço, quantidade ou descrição legíveis perto da peça"),
    }),
  ),
  cabecalho: z.string().describe("fornecedor, data, número do pedido, moeda — se visíveis"),
});

export async function detectarPecas(imagemBase64: string, mime: string, ctx?: ContextoGasto) {
  const { texto } = await sistemaCatalogo();
  return chamar({
    sistema: texto,
    schema: schemaDeteccao,
    maxTokens: 8000,
    finalidade: "deteccao",
    ctx,
    conteudo: [
      {
        type: "image",
        source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: imagemBase64 },
      },
      {
        type: "text",
        text: "Esta é uma foto/página de catálogo ou pedido de semijoias. Localize cada produto à venda (uma caixa por produto; se o produto aparece em cartela, a caixa cobre a cartela inteira). Ignore logotipos e ícones. Para cada um, transcreva o texto legível associado (código, preço, quantidade).",
      },
    ],
  });
}

/* ---------------------------------------------- parecer dos especialistas */

const schemaParecer = z.object({
  resumo: z.string().describe("3–5 linhas para a dona da loja"),
  estoque: z.string().describe("parecer do gestor de estoque, em markdown"),
  contador: z.string().describe("parecer do contador, em markdown"),
  administrador: z.string().describe("parecer do administrador, em markdown"),
  marketing: z.string().describe("parecer do especialista em marketing, em markdown"),
  pendencias: z.array(z.string()).describe("itens que precisam de decisão humana"),
});

export type Parecer = z.infer<typeof schemaParecer>;

export async function parecerEspecialistas(dadosPedido: unknown, ctx?: ContextoGasto): Promise<Parecer> {
  const [prec, fiscal, marca] = await Promise.all([getConfig("precificacao"), getConfig("fiscal"), getConfig("marca")]);
  const sistema = `Você é um comitê de quatro especialistas que avalia cada pedido importado pela loja ${marca.nome}.
${Object.values(PERSONAS)
  .map((p) => `## ${p.titulo}\n${p.instrucoes}`)
  .join("\n\n")}

Política de preços vigente (JSON): ${JSON.stringify(prec)}
Regras fiscais vigentes (JSON): ${JSON.stringify({ ncm: fiscal.ncm, cotacao: fiscal.cotacao })}

Cada parecer: objetivo, com números do pedido, no máximo ~12 linhas, terminando com recomendações práticas. Avise quando algo deve ser validado pelo contador da empresa. Não invente dados que não estão no pedido.`;
  return chamar({
    sistema,
    schema: schemaParecer,
    finalidade: "parecer",
    ctx,
    conteudo: [{ type: "text", text: `Dados do pedido (JSON):\n${JSON.stringify(dadosPedido)}` }],
  });
}

/* ----------------------------------------------- textos de marketing (1 peça) */

const schemaTextos = z.object({
  legenda: z.string(),
  hashtags: z.array(z.string()),
  nome_comercial: z.string(),
  prompt_cena: z.string().describe("descrição em inglês da cena ideal para foto publicitária desta peça"),
});

export async function textosMarketing(produto: Record<string, unknown>, imagemBase64?: string, ctx?: ContextoGasto) {
  const { texto } = await sistemaCatalogo();
  const conteudo: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  if (imagemBase64) conteudo.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imagemBase64 } });
  conteudo.push({
    type: "text",
    text: `Crie a legenda de Instagram (com chamada para ação e emoji com moderação), hashtags (8–15) e um nome comercial para esta peça. Produto: ${JSON.stringify(produto)}`,
  });
  return chamar({ sistema: texto, schema: schemaTextos, conteudo, maxTokens: 6000, finalidade: "textos", ctx });
}

/* ------------------------------------- avaliação das fotos pelo marketing */

const schemaAvaliacaoFoto = z.object({
  aprovada: z.boolean(),
  nota: z.number().describe("0 a 10"),
  notas_criterios: z.array(z.object({ id: z.string(), nota: z.number().describe("0 a 10") })),
  eliminatorios: z.array(z.string()).describe("motivos eliminatórios encontrados (vazio se nenhum)"),
  problemas: z.array(z.string()).describe("problemas encontrados, em português"),
  pontos_fortes: z.array(z.string()),
  ajuste_prompt: z.string().describe("instrução em inglês para corrigir na próxima tentativa; vazio se aprovada"),
});

export type AvaliacaoFoto = z.infer<typeof schemaAvaliacaoFoto>;

/**
 * O especialista de marketing compara a foto gerada com a foto real da peça e aprova ou reprova
 * segundo a rubrica de src/config/marca.json (avaliacao_foto).
 */
export async function avaliarFotoMarketing(opts: {
  referenciaBase64: string;
  geradaBase64: string;
  geradaMime: string;
  estiloBase64?: string | null; // foto de referência de estilo usada (se houver)
  produto: Record<string, unknown>;
  ctx?: ContextoGasto;
}): Promise<AvaliacaoFoto> {
  const marca = await getConfig("marca");
  const rubrica = (marca as Record<string, unknown>).avaliacao_foto ?? {
    nota_minima_aprovacao: 8,
    criterios: [
      { id: "fidelidade", nome: "Fidelidade da peça", peso: 35 },
      { id: "realismo", nome: "Realismo", peso: 25 },
      { id: "comercial", nome: "Apelo comercial", peso: 20 },
      { id: "marca", nome: "Identidade Fio de Amor", peso: 10 },
      { id: "limpeza", nome: "Limpeza", peso: 10 },
    ],
  };
  const minima = Number((rubrica as { nota_minima_aprovacao?: number }).nota_minima_aprovacao ?? 8);
  const minimasCriterio = ((rubrica as { nota_minima_por_criterio?: Record<string, number> }).nota_minima_por_criterio ?? {}) as Record<string, number>;
  const sistema = `${PERSONAS.marketing.resumo}
Você é a diretora de arte da ${marca.nome} e aprova (ou não) as fotos publicitárias geradas por IA antes de irem para o Instagram, o catálogo e o UP Vendas.
Seja exigente como numa campanha de joalheria: só aprove fotos que pareçam fotografia real, comercial, com a peça IDÊNTICA à da foto de referência.
Rubrica (JSON): ${JSON.stringify(rubrica)}
Regras: dê nota inteira de 0 a 10 em cada critério (use os ids da rubrica em notas_criterios); nota final = média ponderada pelos pesos; qualquer item eliminatório reprova; aprove somente se não houver eliminatório, a nota final for >= ${minima} e as notas mínimas por critério forem atingidas: ${JSON.stringify(minimasCriterio)}.
Escreva problemas e pontos fortes em português; o ajuste_prompt em inglês, curto e específico.`;
  const r = await chamar({
    sistema,
    schema: schemaAvaliacaoFoto,
    maxTokens: 6000,
    finalidade: "avaliacao_foto",
    ctx: opts.ctx,
    conteudo: [
      { type: "text", text: "FOTO DE REFERÊNCIA (a peça real, foto do fornecedor):" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.referenciaBase64 } },
      ...(opts.estiloBase64
        ? ([
            { type: "text", text: "FOTO DE ESTILO (só referência de cenário/expositor; a joia dela NÃO pode aparecer na foto gerada):" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.estiloBase64 } },
          ] as Anthropic.Beta.Messages.BetaContentBlockParam[])
        : []),
      { type: "text", text: "FOTO GERADA POR IA para avaliação:" },
      {
        type: "image",
        source: { type: "base64", media_type: (opts.geradaMime === "image/png" ? "image/png" : "image/jpeg") as "image/png" | "image/jpeg", data: opts.geradaBase64 },
      },
      { type: "text", text: `Produto: ${JSON.stringify(opts.produto)}\nAvalie a foto gerada.` },
    ],
  });
  // Garante a regra mesmo se o modelo se contradisser.
  const abaixo = Object.entries(minimasCriterio).filter(([id, min]) => {
    const n = r.notas_criterios.find((c) => c.id === id)?.nota;
    return n != null && n < min;
  });
  if (abaixo.length) r.problemas.push(...abaixo.map(([id, min]) => `Nota de ${id} abaixo do mínimo (${min}).`));
  r.aprovada = r.aprovada && r.eliminatorios.length === 0 && r.nota >= minima && abaixo.length === 0;
  return r;
}
