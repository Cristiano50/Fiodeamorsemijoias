"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/cliente";

export interface TaxonomiaCliente {
  materiais: { id: string; nome: string; sigla: string }[];
  tipos: { id: string; nome: string; prefixo: string; categoria_vitrine: string; subtipos: string[]; tamanhos: string[] }[];
  banhos: { id: string; nome: string }[];
  cores_pedra: { id: string; nome: string; hex?: string }[];
}

export interface ConfigCliente {
  taxonomia: TaxonomiaCliente;
  precificacao: {
    tabelas_preco: { id: string; nome: string; multiplicador_sobre_tabela_base: number; descricao?: string; tabela_up_vendas?: string | null }[];
    tabela_base: string;
    comissao_consignacao_pct: number;
    margem_minima_pct: number;
    [k: string]: unknown;
  };
  marca: {
    nome: string;
    instagram: string;
    cores: Record<string, string>;
    fontes: Record<string, string>;
    templates_arte?: { id: string; nome: string; largura: number; altura: number; uso?: string; layout?: string }[];
    prompts_ia_foto?: { cenarios?: { id: string; nome: string; prompt: string }[]; aviso_publicacao?: string };
    hashtags?: { fixas?: string[] };
    [k: string]: unknown;
  };
  sistema: Record<string, string>;
  upvendas: Record<string, unknown>;
  fiscal: Record<string, unknown>;
  segredos: Record<string, "ambiente" | "salvo" | null>;
  componentesCusto: { id: string; nome: string; tipo: string; padrao: number; explicacao?: string }[];
  cenarios: { padrao: string; cenarios: Record<string, { nome: string; aplica_quando?: string }> };
}

export function useConfig() {
  const [config, setConfig] = useState<ConfigCliente | null>(null);
  const recarregar = useCallback(() => api<ConfigCliente>("/api/config").then(setConfig), []);
  useEffect(() => {
    recarregar().catch(() => {});
  }, [recarregar]);
  return { config, recarregar };
}

export function nomeDe(lista: { id: string; nome: string }[] | undefined, id: string | null | undefined) {
  if (!id) return "—";
  return lista?.find((x) => x.id === id)?.nome ?? id;
}
