import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import precificacaoPadrao from "@/config/precificacao.json";
import taxonomiaPadrao from "@/config/taxonomia.json";
import fiscalPadrao from "@/config/fiscal.json";
import marcaPadrao from "@/config/marca.json";
import type { ComponenteCusto, PoliticaPreco } from "./precos";

/* Tipos das configurações (os JSON em src/config foram escritos pelos especialistas). */

export interface Taxonomia {
  materiais: { id: string; nome: string; sigla: string; descricao_grade?: string }[];
  tipos: {
    id: string;
    nome: string;
    prefixo: string;
    categoria_vitrine: string;
    subtipos: string[];
    tamanhos: string[];
  }[];
  banhos: { id: string; nome: string; campo_up?: string | null }[];
  cores_pedra: { id: string; nome: string; hex?: string }[];
  codigos_fornecedor: Record<string, { banho?: string | null; observacao?: string } | string>;
  glossario_chines: Record<string, string>;
  regras?: Record<string, unknown>;
}

export interface Fiscal {
  ncm: { tipo: string; material: string; ncm: string; descricao?: string; observacao?: string }[];
  cotacao?: { tipo?: "venda" | "compra"; [k: string]: unknown };
  custo_aquisicao?: {
    componentes: ComponenteCusto[];
    formula?: string;
    cenario_padrao?: string;
    cenarios_importacao?: Record<string, Cenario>;
  };
  [k: string]: unknown;
}

export interface Cenario {
  nome: string;
  aplica_quando?: string;
  valores: Record<string, number>;
  observacao?: string;
}

export interface Marca {
  nome: string;
  instagram: string;
  cores: Record<string, string>;
  fontes: Record<string, string>;
  tom_de_voz?: Record<string, unknown>;
  padrao_nome?: { formato?: string; regras?: string[]; exemplos?: string[]; [k: string]: unknown };
  hashtags?: { fixas?: string[]; por_tipo?: Record<string, string[]> };
  templates_arte?: { id: string; nome: string; largura: number; altura: number; uso?: string; layout?: string }[];
  prompts_ia_foto?: {
    base?: string;
    por_tipo?: Record<string, string>;
    cenarios?: { id: string; nome: string; prompt: string; modelo?: boolean; referencia_estilo?: string | null }[];
    negativo?: string[];
  };
  [k: string]: unknown;
}

/** Regras do sistema (editáveis em Configurações). */
export interface Sistema {
  referenciaModelo: string; // ver montarReferencia()
  eanPrefixo: string;
  marcaUp: string;
  codigoNoUp: "ean13" | "code128"; // o que gravar no campo "Cód. Barras" do UP (igual ao impresso na etiqueta)
  unidade: string;
  ncmPadrao: string;
  tipoCotacao: "venda" | "compra";
  cenarioCustoPadrao: string; // vazio = o padrão do contador
  claudeModelo: string;
  claudeEsforco: "low" | "medium" | "high";
  imagemProvedor: "gemini" | "openai" | "nenhum";
  fotoTentativas: number; // tentativas até o marketing aprovar a foto com modelo
  geminiModelo: string;
  openaiModelo: string;
}

export const SISTEMA_PADRAO: Sistema = {
  referenciaModelo: "{PREFIXO}_{AA}{MM}{SEQ:3}",
  eanPrefixo: "91", // gestor de estoque: "91" fica fora da faixa do UP (9000…), da balança (2x) e da GS1 Brasil (789)
  marcaUp: "FIO DE AMOR",
  codigoNoUp: "ean13",
  unidade: "UN",
  ncmPadrao: "71171900",
  tipoCotacao: "venda",
  cenarioCustoPadrao: "mercadoria_frete", // regra da loja: custo = preço × cotação × (1 + frete ÷ mercadoria em R$)
  claudeModelo: "claude-opus-5-5",
  claudeEsforco: "medium",
  imagemProvedor: "gemini",
  fotoTentativas: 3,
  geminiModelo: "gemini-3-pro-image", // Nano Banana Pro: o mais realista para foto comercial (alternativa mais barata: gemini-3.1-flash-image)
  openaiModelo: "gpt-image-2", // gpt-image-1 foi desativado pela OpenAI em 23/10/2026
};

export interface UpVendasConfig {
  ativo: boolean;
  baseUrl: string;
  dominio: string;
  usuario: string;
  senha?: string; // segredo — nunca enviado ao navegador
  caminhoLogin: string;
  caminhoProdutos: string;
  caminhoProdutoPorReferencia: string;
  metodoCriar: "POST" | "PUT";
  campoToken: string; // onde está o token: "header:Authorization" ou "json:token"
  empresa: string;
  tabelaPreco: string;
  mapaCampos: Record<string, string>; // campo do app → campo do UP (JSON)
}

export const UPVENDAS_PADRAO: UpVendasConfig = {
  ativo: false,
  baseUrl: "https://ms.upvendas.app",
  dominio: "",
  usuario: "",
  caminhoLogin: "/auth/login",
  caminhoProdutos: "/produtos",
  caminhoProdutoPorReferencia: "/produtos?referencia={referencia}",
  metodoCriar: "POST",
  campoToken: "header:Authorization",
  empresa: "",
  tabelaPreco: "CONSIGNADO",
  mapaCampos: {
    nome: "nome",
    marca: "marca",
    referencia: "referencia",
    codigoExterno: "codigoExterno",
    ncm: "ncm",
    unidade: "unidade",
    categoriaVitrine: "categoriaVitrine",
    custoCompraBruto: "custoCompraBruto",
    custoInsumo: "custoInsumo",
    custoTotal: "custoTotal",
    tabelaPreco: "tabelaPreco",
    percentualLucro: "percentualLucro",
    valorTabela: "valorTabela",
    descricaoGrade: "descricao",
    codigoBarras: "codigoBarras",
    estoque: "estoque",
    ativo: "ativo",
    imagemUrl: "imagemUrl",
  },
};

type Chave = "precificacao" | "taxonomia" | "fiscal" | "marca" | "sistema" | "upvendas" | "segredos";

const PADROES = {
  precificacao: precificacaoPadrao as unknown as PoliticaPreco,
  taxonomia: taxonomiaPadrao as unknown as Taxonomia,
  fiscal: fiscalPadrao as unknown as Fiscal,
  marca: marcaPadrao as unknown as Marca,
  sistema: SISTEMA_PADRAO,
  upvendas: UPVENDAS_PADRAO,
  segredos: {} as Record<string, string>,
};

export type Configs = typeof PADROES;

async function lerSobrescrita(chave: Chave): Promise<unknown | undefined> {
  const db = await getDb();
  const [linha] = await db.select().from(schema.configuracoes).where(eq(schema.configuracoes.chave, chave));
  return linha?.valor;
}

/** Configuração efetiva = padrão do arquivo JSON + o que foi salvo em Configurações. */
export async function getConfig<K extends Chave>(chave: K): Promise<Configs[K]> {
  const salvo = await lerSobrescrita(chave);
  const padrao = PADROES[chave];
  if (salvo && typeof salvo === "object" && !Array.isArray(salvo)) return { ...padrao, ...(salvo as object) } as Configs[K];
  return padrao;
}

export async function salvarConfig(chave: Chave, valor: unknown) {
  const db = await getDb();
  await db
    .insert(schema.configuracoes)
    .values({ chave, valor })
    .onConflictDoUpdate({
      target: schema.configuracoes.chave,
      set: { valor, atualizadoEm: new Date().toISOString() },
    });
}

export async function restaurarPadrao(chave: Chave) {
  const db = await getDb();
  await db.delete(schema.configuracoes).where(eq(schema.configuracoes.chave, chave));
}

export function getPadrao<K extends Chave>(chave: K): Configs[K] {
  return PADROES[chave];
}

/** Chaves de API: variável de ambiente tem prioridade; senão, a salva em Configurações. */
export async function getSegredo(nome: "ANTHROPIC_API_KEY" | "GEMINI_API_KEY" | "OPENAI_API_KEY" | "UPVENDAS_SENHA") {
  if (process.env[nome]) return process.env[nome];
  const s = await getConfig("segredos");
  return s[nome] || undefined;
}

/** Componentes de custo do pedido (frete, câmbio, impostos...) definidos pelo contador. */
export async function getComponentesCusto(): Promise<ComponenteCusto[]> {
  const fiscal = await getConfig("fiscal");
  const comps = fiscal.custo_aquisicao?.componentes;
  if (comps?.length) return comps;
  const pol = (await getConfig("precificacao")) as unknown as { custo_total?: { custos_adicionais_pct_padrao?: number } };
  return [
    {
      id: "custos_adicionais_pct",
      nome: "Custos adicionais (%)",
      tipo: "percentual",
      padrao: pol.custo_total?.custos_adicionais_pct_padrao ?? 15,
    },
  ];
}

/** Cenários de importação do contador + "somente mercadoria" (sem custos adicionais). */
export async function getCenarios(): Promise<{ padrao: string; cenarios: Record<string, Cenario> }> {
  const [fiscal, sistema, componentes] = await Promise.all([getConfig("fiscal"), getConfig("sistema"), getComponentesCusto()]);
  const zerado = Object.fromEntries(componentes.map((c) => [c.id, 0]));
  const cenarios: Record<string, Cenario> = {
    mercadoria_frete: {
      nome: "Mercadoria + frete (regra da loja)",
      aplica_quando:
        "Compras da China: frete ÷ valor da mercadoria em R$ = % do frete; cada peça recebe esse % sobre o seu valor em R$. Informe o frete no campo Frete do pedido.",
      valores: zerado,
    },
    ...(fiscal.custo_aquisicao?.cenarios_importacao ?? {}),
  };
  const padrao = sistema.cenarioCustoPadrao || fiscal.custo_aquisicao?.cenario_padrao || Object.keys(cenarios)[0];
  return { padrao, cenarios };
}

/** NCM pela regra mais específica (tipo+material > tipo > material > padrão). */
export function ncmPara(fiscal: Fiscal, tipo?: string | null, material?: string | null, padrao = "71171900") {
  const regras = fiscal.ncm ?? [];
  const achar = (t: string, m: string) => regras.find((r) => r.tipo === t && r.material === m)?.ncm;
  return (
    (tipo && material && achar(tipo, material)) ||
    (tipo && achar(tipo, "*")) ||
    (material && achar("*", material)) ||
    achar("*", "*") ||
    padrao
  );
}
