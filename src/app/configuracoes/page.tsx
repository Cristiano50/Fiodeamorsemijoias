"use client";
import { useState } from "react";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig, type ConfigCliente } from "@/components/hooks";
import { api, brl } from "@/lib/cliente";
import { montarEan13, montarReferencia } from "@/lib/codigos";
import { calcularPreco, type PoliticaPreco } from "@/lib/precos";

type Aba = "integracoes" | "precificacao" | "codigos" | "custos" | "avancado";

export default function ConfiguracoesPage() {
  const { config, recarregar } = useConfig();
  const [aba, setAba] = useState<Aba>("integracoes");
  if (!config) return <Carregando />;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-4xl font-semibold">Configurações</h1>
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["integracoes", "Integrações e IA"],
            ["precificacao", "Precificação (fator)"],
            ["custos", "Câmbio e custos"],
            ["codigos", "Referência e código de barras"],
            ["avancado", "Taxonomia, marca e fiscal"],
          ] as const
        ).map(([k, r]) => (
          <button key={k} onClick={() => setAba(k)} className={`rounded-full px-3 py-1 text-sm ${aba === k ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
            {r}
          </button>
        ))}
      </div>
      {aba === "integracoes" && <Integracoes config={config} recarregar={recarregar} />}
      {aba === "precificacao" && <Precificacao config={config} recarregar={recarregar} />}
      {aba === "custos" && <Custos config={config} recarregar={recarregar} />}
      {aba === "codigos" && <Codigos config={config} recarregar={recarregar} />}
      {aba === "avancado" && <Avancado config={config} recarregar={recarregar} />}
    </div>
  );
}

type Props = { config: ConfigCliente; recarregar: () => Promise<void> };

function useSalvar(recarregar: () => Promise<void>) {
  const avisar = useAviso();
  const [salvando, setSalvando] = useState(false);
  const salvar = async (chave: string, valor: unknown, msg = "Configuração salva.") => {
    setSalvando(true);
    try {
      await api("/api/config", { method: "PUT", json: { chave, valor } });
      await recarregar();
      avisar(msg);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSalvando(false);
    }
  };
  const restaurar = async (chave: string) => {
    if (!confirm("Voltar ao padrão definido pelos especialistas?")) return;
    await api(`/api/config?chave=${chave}`, { method: "DELETE" });
    await recarregar();
    avisar("Padrão restaurado.");
  };
  return { salvar, restaurar, salvando };
}

function Integracoes({ config, recarregar }: Props) {
  const { salvar, salvando } = useSalvar(recarregar);
  const [chaves, setChaves] = useState({ ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "" });
  const [s, setS] = useState(config.sistema);
  const status = (k: string) => {
    const v = config.segredos[k];
    return v === "ambiente" ? <Selo cor="verde">definida no servidor</Selo> : v === "salvo" ? <Selo cor="verde">salva</Selo> : <Selo cor="amarelo">não definida</Selo>;
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Cartao titulo="Chaves de API">
        <p className="mb-3 text-sm text-[#8a6d78]">As chaves ficam só no servidor (nunca voltam para o navegador). Se a chave estiver em variável de ambiente, ela tem prioridade.</p>
        {(
          [
            ["ANTHROPIC_API_KEY", "Claude (Anthropic) — análise das peças, nomes, legendas e pareceres", "console.anthropic.com"],
            ["GEMINI_API_KEY", "Google Gemini — fotos com modelo por IA", "aistudio.google.com"],
            ["OPENAI_API_KEY", "OpenAI — fotos com modelo por IA (alternativa)", "platform.openai.com"],
          ] as const
        ).map(([k, rotulo, site]) => (
          <Campo key={k} rotulo={rotulo} className="mb-3" dica={<>Obtenha em {site} · {status(k)}</>}>
            <input type="password" autoComplete="off" placeholder="cole a chave para salvar ou trocar" value={chaves[k]} onChange={(e) => setChaves((c) => ({ ...c, [k]: e.target.value }))} />
          </Campo>
        ))}
        <div className="flex justify-end">
          <Botao
            carregando={salvando}
            onClick={() => salvar("segredos", Object.fromEntries(Object.entries(chaves).filter(([, v]) => v))).then(() => setChaves({ ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "" }))}
          >
            Salvar chaves
          </Botao>
        </div>
      </Cartao>
      <Cartao titulo="Modelos de IA">
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Modelo do Claude" dica="Padrão: claude-opus-5-5">
            <input value={s.claudeModelo} onChange={(e) => setS({ ...s, claudeModelo: e.target.value })} />
          </Campo>
          <Campo rotulo="Esforço da análise" dica="médio = bom equilíbrio custo/qualidade">
            <select value={s.claudeEsforco} onChange={(e) => setS({ ...s, claudeEsforco: e.target.value })}>
              <option value="low">baixo (mais barato)</option>
              <option value="medium">médio</option>
              <option value="high">alto (mais caprichado)</option>
            </select>
          </Campo>
          <Campo rotulo="Fotos com IA">
            <select value={s.imagemProvedor} onChange={(e) => setS({ ...s, imagemProvedor: e.target.value })}>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="nenhum">Desligado (só artes da marca)</option>
            </select>
          </Campo>
          <div />
          <Campo rotulo="Modelo Gemini">
            <input value={s.geminiModelo} onChange={(e) => setS({ ...s, geminiModelo: e.target.value })} />
          </Campo>
          <Campo rotulo="Modelo OpenAI">
            <input value={s.openaiModelo} onChange={(e) => setS({ ...s, openaiModelo: e.target.value })} />
          </Campo>
        </div>
        <div className="mt-4 flex justify-end">
          <Botao carregando={salvando} onClick={() => salvar("sistema", s)}>
            Salvar
          </Botao>
        </div>
      </Cartao>
    </div>
  );
}

function Precificacao({ config, recarregar }: Props) {
  const { salvar, restaurar, salvando } = useSalvar(recarregar);
  const [pol, setPol] = useState(config.precificacao as unknown as PoliticaPreco & Record<string, unknown>);
  const [teste, setTeste] = useState(3.16);
  const tipos = config.taxonomia.tipos;
  const r = calcularPreco(teste, "brinco", pol);
  const setNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setPol((p) => ({ ...p, [k]: Number(e.target.value) }));
  return (
    <div className="flex flex-col gap-4">
      <Cartao
        titulo="Fator multiplicador"
        acoes={
          <>
            <Botao variante="fantasma" onClick={() => restaurar("precificacao")}>
              Restaurar padrão
            </Botao>
            <Botao carregando={salvando} onClick={() => salvar("precificacao", pol, "Política de preços salva. Abra o pedido e use “Recalcular” se quiser aplicar.")}>
              Salvar
            </Botao>
          </>
        }
      >
        <p className="mb-3 text-sm text-[#8a6d78]">
          Preço de venda = custo total da peça × fator, arredondado. O funcionário digita o fator em cada pedido (ou em cada peça). Prioridade: preço manual →
          fator da peça → fator do pedido → faixa de custo (se ativa) → fator do tipo → fator padrão.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
          <Campo rotulo="Fator padrão" dica="Usado quando o pedido fica em branco">
            <input type="number" step="0.01" value={pol.fator_padrao} onChange={setNum("fator_padrao")} />
          </Campo>
          <Campo rotulo="Fator mínimo" dica="Abaixo disso a peça mostra alerta">
            <input type="number" step="0.01" value={pol.fator_minimo ?? ""} onChange={setNum("fator_minimo")} />
          </Campo>
          <Campo rotulo="Usar faixas de custo">
            <select value={pol.usar_faixas ? "1" : "0"} onChange={(e) => setPol((p) => ({ ...p, usar_faixas: e.target.value === "1" }))}>
              <option value="1">Sim (peças baratas têm fator maior)</option>
              <option value="0">Não (fator por tipo)</option>
            </select>
          </Campo>
          <Campo rotulo="Terminar preço em">
            <input type="number" step="0.01" value={pol.arredondamento.centavos} onChange={(e) => setPol((p) => ({ ...p, arredondamento: { ...p.arredondamento, centavos: Number(e.target.value) } }))} />
          </Campo>
          <Campo rotulo="Preço mínimo">
            <input type="number" step="0.01" value={pol.arredondamento.minimo ?? 0} onChange={(e) => setPol((p) => ({ ...p, arredondamento: { ...p.arredondamento, minimo: Number(e.target.value) } }))} />
          </Campo>
          <Campo rotulo="Comissão revendedora %">
            <input type="number" value={pol.comissao_consignacao_pct} onChange={setNum("comissao_consignacao_pct")} />
          </Campo>
          <Campo rotulo="Margem mínima %">
            <input type="number" value={pol.margem_minima_pct} onChange={setNum("margem_minima_pct")} />
          </Campo>
        </div>
        <div className="mt-4 rounded-xl bg-creme p-3 text-sm">
          Simular: custo de <input type="number" step="0.01" value={teste} onChange={(e) => setTeste(Number(e.target.value))} className="inline w-24" /> → fator ×{r.fator} ({r.origemFator}) →{" "}
          <b>{brl(r.preco)}</b> · % lucro UP {r.lucroPct} · margem após comissão {r.margemPct}%
        </div>
      </Cartao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Faixas de custo">
          <table className="tabela w-full">
            <thead>
              <tr>
                <th>Custo até (R$)</th>
                <th>Fator</th>
                <th>Exemplo de preço</th>
              </tr>
            </thead>
            <tbody>
              {pol.faixas_custo.map((f, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={f.ate ?? ""}
                      placeholder="sem limite"
                      onChange={(e) => setPol((p) => ({ ...p, faixas_custo: p.faixas_custo.map((x, j) => (j === i ? { ...x, ate: e.target.value ? Number(e.target.value) : null } : x)) }))}
                    />
                  </td>
                  <td>
                    <input type="number" step="0.05" value={f.fator} onChange={(e) => setPol((p) => ({ ...p, faixas_custo: p.faixas_custo.map((x, j) => (j === i ? { ...x, fator: Number(e.target.value) } : x)) }))} />
                  </td>
                  <td className="text-xs text-[#8a6d78]">{f.ate ? `${brl(f.ate)} → ${brl(calcularPreco(f.ate, null, { ...pol, usar_faixas: true }).preco)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
        <Cartao titulo="Fator por tipo de peça">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {tipos.map((t) => (
              <Campo key={t.id} rotulo={t.nome}>
                <input
                  type="number"
                  step="0.05"
                  value={pol.fatores_por_tipo[t.id] ?? ""}
                  placeholder={String(pol.fator_padrao)}
                  onChange={(e) => setPol((p) => ({ ...p, fatores_por_tipo: { ...p.fatores_por_tipo, [t.id]: Number(e.target.value) } }))}
                />
              </Campo>
            ))}
          </div>
        </Cartao>
      </div>

      <Cartao titulo="Tabelas de preço (UP Vendas)">
        <table className="tabela w-full">
          <thead>
            <tr>
              <th>Tabela</th>
              <th>Multiplicador sobre a base</th>
              <th>Tabela no UP</th>
              <th>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {pol.tabelas_preco.map((t, i) => (
              <tr key={t.id}>
                <td>
                  {t.nome} {t.id === pol.tabela_base && <Selo>base</Selo>}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    disabled={t.id === pol.tabela_base}
                    value={t.multiplicador_sobre_tabela_base}
                    onChange={(e) => setPol((p) => ({ ...p, tabelas_preco: p.tabelas_preco.map((x, j) => (j === i ? { ...x, multiplicador_sobre_tabela_base: Number(e.target.value) } : x)) }))}
                  />
                </td>
                <td className="text-xs">{t.tabela_up_vendas ?? "—"}</td>
                <td className="text-xs text-[#6b5560]">{t.descricao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Cartao>
    </div>
  );
}

function Custos({ config, recarregar }: Props) {
  const { salvar, salvando } = useSalvar(recarregar);
  const [s, setS] = useState(config.sistema);
  return (
    <Cartao titulo="Câmbio e custo de aquisição">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Campo rotulo="Cenário padrão dos novos pedidos" dica={config.cenarios.cenarios[s.cenarioCustoPadrao || config.cenarios.padrao]?.aplica_quando}>
          <select value={s.cenarioCustoPadrao} onChange={(e) => setS({ ...s, cenarioCustoPadrao: e.target.value })}>
            {Object.entries(config.cenarios.cenarios).map(([k, c]) => (
              <option key={k} value={k}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Cotação PTAX" dica="O contador recomenda a de venda (quem importa compra moeda)">
          <select value={s.tipoCotacao} onChange={(e) => setS({ ...s, tipoCotacao: e.target.value })}>
            <option value="venda">PTAX venda</option>
            <option value="compra">PTAX compra</option>
          </select>
        </Campo>
      </div>
      <p className="mt-3 text-sm text-[#8a6d78]">
        Os valores de cada componente (frete, taxa do agente, IOF, impostos…) são ajustados em cada pedido. Os padrões e a fórmula estão no parecer do contador
        (Especialistas → Contador).
      </p>
      <div className="mt-4 flex justify-end">
        <Botao carregando={salvando} onClick={() => salvar("sistema", s)}>
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}

function Codigos({ config, recarregar }: Props) {
  const { salvar, salvando } = useSalvar(recarregar);
  const [s, setS] = useState(config.sistema);
  let exemploRef = "";
  let exemploEan = "";
  try {
    exemploRef = montarReferencia(s.referenciaModelo, { prefixo: "BR", sequencia: 1 });
    exemploEan = montarEan13(s.eanPrefixo, 1);
  } catch (e) {
    exemploEan = e instanceof Error ? e.message : "inválido";
  }
  return (
    <Cartao titulo="Referência e código de barras">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Campo rotulo="Modelo da referência" dica={<>Exemplo: <b className="font-mono">{exemploRef}</b> · {"{PREFIXO}"} {"{AA}"} {"{MM}"} {"{SSS}"} {"{SEQ:n}"}</>}>
          <input value={s.referenciaModelo} onChange={(e) => setS({ ...s, referenciaModelo: e.target.value })} className="font-mono" />
        </Campo>
        <Campo rotulo="Prefixo do EAN-13 interno" dica={<>Exemplo: <b className="font-mono">{exemploEan}</b> · evite 2x (balança), 789 (GS1) e 9000 (UP)</>}>
          <input value={s.eanPrefixo} onChange={(e) => setS({ ...s, eanPrefixo: e.target.value })} className="font-mono" />
        </Campo>
        <Campo rotulo="Código gravado no UP e impresso" dica="Code128 curto = 8 dígitos; cabe melhor no rabicho">
          <select value={s.codigoNoUp} onChange={(e) => setS({ ...s, codigoNoUp: e.target.value })}>
            <option value="ean13">EAN-13 completo</option>
            <option value="code128">Code128 curto (8 dígitos)</option>
          </select>
        </Campo>
        <Campo rotulo="Marca no UP">
          <input value={s.marcaUp} onChange={(e) => setS({ ...s, marcaUp: e.target.value })} />
        </Campo>
        <Campo rotulo="Unidade">
          <input value={s.unidade} onChange={(e) => setS({ ...s, unidade: e.target.value })} />
        </Campo>
        <Campo rotulo="NCM padrão" dica="Contador: 7117.19.00 para semijoia de metal com banho">
          <input value={s.ncmPadrao} onChange={(e) => setS({ ...s, ncmPadrao: e.target.value })} className="font-mono" />
        </Campo>
      </div>
      <p className="mt-3 text-sm text-[#8a6d78]">Prefixos de cada tipo (BR, CL, AN…) ficam na taxonomia (aba “Taxonomia, marca e fiscal”).</p>
      <div className="mt-4 flex justify-end">
        <Botao carregando={salvando} onClick={() => salvar("sistema", s)}>
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}

function Avancado({ config, recarregar }: Props) {
  const [chave, setChave] = useState<"taxonomia" | "marca" | "fiscal">("taxonomia");
  return <EditorJson key={chave} chave={chave} setChave={setChave} config={config} recarregar={recarregar} />;
}

function EditorJson({ chave, setChave, config, recarregar }: Props & { chave: "taxonomia" | "marca" | "fiscal"; setChave: (c: "taxonomia" | "marca" | "fiscal") => void }) {
  const { salvar, restaurar, salvando } = useSalvar(recarregar);
  const [texto, setTexto] = useState(() => JSON.stringify(config[chave], null, 2));
  const [erro, setErro] = useState("");
  return (
    <Cartao
      titulo="Edição avançada (JSON)"
      acoes={
        <>
          <select value={chave} onChange={(e) => setChave(e.target.value as typeof chave)} className="w-48">
            <option value="taxonomia">Taxonomia (estoque)</option>
            <option value="marca">Marca (marketing)</option>
            <option value="fiscal">Fiscal (contador)</option>
          </select>
          <Botao variante="fantasma" onClick={() => restaurar(chave).then(() => setChave(chave))}>
            Restaurar padrão
          </Botao>
          <Botao
            carregando={salvando}
            onClick={() => {
              try {
                const v = JSON.parse(texto);
                setErro("");
                salvar(chave, v);
              } catch (e) {
                setErro(`JSON inválido: ${e instanceof Error ? e.message : e}`);
              }
            }}
          >
            Salvar
          </Botao>
        </>
      }
    >
      <p className="mb-2 text-sm text-[#8a6d78]">Tipos de peça, prefixos de referência, materiais, banhos, cores de pedra, glossário chinês, NCM, cenários de importação, cores e prompts das fotos.</p>
      {erro && <p className="mb-2 text-sm text-red-700">{erro}</p>}
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={28} className="font-mono text-xs" spellCheck={false} />
    </Cartao>
  );
}
