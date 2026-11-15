"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Botao, Carregando, Cartao, Numero, Selo } from "@/components/ui";
import { nomeDe, useConfig } from "@/components/hooks";
import { api, brl, moedaSimbolo, num } from "@/lib/cliente";
import { NomeFornecedor } from "@/components/Fornecedor";
import type { AvisoBackup, Comparacao, IndicadoresEstoque, SellThroughPedido } from "@/lib/painel-calculo";

type Pendencia = { chave: string; rotulo: string; n: number; link: string; dica: string };
type Painel = {
  produtos: number;
  pecas: number;
  custo: number;
  venda: number;
  pedidos: number;
  aprovados: number;
  semCodigo: number;
  noUp: number;
  comFotoIa: number;
  fotosPendentes: number;
  gastoIaMes: number;
  porTipo: { tipo: string; pecas: number; venda: number }[];
  hoje: string;
  vendas: { temVendas: boolean; ultimaVenda: string | null; ultimaImportacao: string | null; semana: Comparacao | null; mes: Comparacao | null };
  sellThrough: (SellThroughPedido & { fornecedorApelido: string | null })[];
  estoque: IndicadoresEstoque;
  aCaminho: { skus: number; pecas: number };
  backup: AvisoBackup;
  pendencias: Pendencia[];
};
type PedidoLista = { id: string; numero: string | null; fornecedor: string | null; fornecedorApelido: string | null; dataCompra: string | null; moeda: string; status: string; linhas: number; pecas: number; custo: number; venda: number };

const dataBr = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const diaMes = (d?: string | null) => (d ? d.slice(5, 10).split("-").reverse().join("/") : "—");
const pct = (v: number | null | undefined, casas = 0) => (v == null ? "—" : `${num(v * 100, casas)}%`);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** Link para a aba de Configurações onde fica o backup (a página lê ?aba=). */
const LINK_BACKUP = "/configuracoes?aba=canais";

/** Valor em reais que cabe no cartão estreito do celular. */
const Dinheiro = ({ v }: { v: number }) => <span className="text-lg wrap-anywhere sm:text-2xl">{brl(v)}</span>;

function Variacao({ c }: { c: Comparacao | null }) {
  if (!c) return null;
  if (c.variacao == null) return <span className="text-[#9a8089]">sem vendas no período anterior</span>;
  const sobe = c.variacao >= 0;
  return (
    <span className={sobe ? "text-emerald-700" : "text-red-700"}>
      {sobe ? "▲" : "▼"} {pct(Math.abs(c.variacao))} <span className="text-[#9a8089]">vs. {brl(c.anterior.receita)}</span>
    </span>
  );
}

/** Indicador do bloco semanal (o Numero do ui, com tom de alerta). */
function Indicador({ rotulo, valor, detalhe, alerta, href }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; alerta?: boolean; href?: string }) {
  const corpo = (
    <div className={`h-full min-w-0 rounded-2xl border px-4 py-3 ${alerta ? "border-red-200 bg-red-50" : "border-borda bg-white"}`}>
      <div className="rotulo">{rotulo}</div>
      <div className={`font-titulo text-xl font-semibold wrap-anywhere sm:text-2xl ${alerta ? "text-red-700" : "text-rose-escuro"}`}>{valor}</div>
      {detalhe && <div className="text-xs text-[#9a8089]">{detalhe}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="min-w-0">
      {corpo}
    </Link>
  ) : (
    corpo
  );
}

export default function Painel() {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [pedidos, setPedidos] = useState<PedidoLista[]>([]);
  const { config } = useConfig();
  useEffect(() => {
    api<Painel>("/api/painel")
      .then(setP)
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
    // Importação que parou no meio não entra nos "últimos pedidos" (aparece nas pendências e em /importar).
    api<PedidoLista[]>("/api/pedidos")
      .then((l) => setPedidos(l.filter((x) => x.status !== "importando")))
      .catch(() => {});
  }, []);
  if (erro) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Não foi possível abrir o painel: {erro}</p>;
  if (!p) return <Carregando />;
  const maxPecas = Math.max(1, ...p.porTipo.map((t) => t.pecas));
  const atrasoVendas = p.vendas.ultimaVenda ? diasEntre(p.vendas.ultimaVenda, p.hoje) : null;
  const pendentes = p.pendencias.filter((x) => x.n > 0);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-gradient-to-r from-rose-claro to-creme px-4 py-5 sm:px-6 sm:py-6">
        <div className="min-w-0">
          <p className="font-script text-2xl text-rose-escuro sm:text-3xl">bem-vinda de volta</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">Cadastro de semijoias</h1>
          <p className="mt-1 max-w-xl text-sm text-[#6b5560]">
            Importe o pedido do fornecedor, revise preços e nomes, gere códigos de barras e etiquetas, crie fotos de publicidade e envie tudo para o UP Vendas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/importar">
            <Botao>⇪ Importar pedido</Botao>
          </Link>
          <Link href="/produtos?novo=1">
            <Botao variante="secundario">+ Produto avulso</Botao>
          </Link>
        </div>
      </div>

      {p.backup.aplica && p.backup.alerta && (
        <Link href={LINK_BACKUP} className="block rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Backup fora do computador:</b>{" "}
          {p.backup.dias == null ? "nenhuma cópia ainda." : `a última cópia foi há ${p.backup.dias} dia(s).`} Se o computador da loja quebrar, as cópias que ficam nele vão junto. Configure a
          pasta do pen drive ou do Google Drive em Configurações → “WhatsApp, catálogo Meta e backup” →
          {p.backup.erro && <span className="mt-1 block text-xs">Última tentativa falhou: {p.backup.erro}</span>}
        </Link>
      )}

      <Cartao
        titulo="Esta semana"
        acoes={
          <Link href="/vendas" className="text-sm text-rose-escuro">
            vendas e recompra →
          </Link>
        }
      >
        {!p.vendas.temVendas ? (
          <p className="text-sm text-[#8a6d78]">
            Ainda não há vendas importadas. Importe a planilha de vendas do UP em{" "}
            <Link href="/vendas" className="text-rose-escuro underline">
              Vendas e recompra
            </Link>{" "}
            para ver a semana, o giro de cada pedido e a cobertura do estoque.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className={`text-sm ${atrasoVendas != null && atrasoVendas > 14 ? "text-amber-800" : "text-[#6b5560]"}`}>
              Vendas importadas até <b>{dataBr(p.vendas.ultimaVenda)}</b>
              {atrasoVendas != null && atrasoVendas > 14 ? ` (há ${atrasoVendas} dias: importe a planilha mais recente do UP)` : ""}
              {p.vendas.ultimaImportacao && <span className="text-xs text-[#9a8089]"> · última importação em {new Date(p.vendas.ultimaImportacao).toLocaleDateString("pt-BR")}</span>}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {p.vendas.semana && (
                <Indicador
                  rotulo={`Semana (${diaMes(p.vendas.semana.atual.inicio)} a ${diaMes(p.vendas.semana.atual.fim)})`}
                  valor={brl(p.vendas.semana.atual.receita)}
                  detalhe={
                    <>
                      {num(p.vendas.semana.atual.pecas, 0)} peças · <Variacao c={p.vendas.semana} />
                    </>
                  }
                />
              )}
              {p.vendas.mes && (
                <Indicador
                  rotulo={`Mês (${diaMes(p.vendas.mes.atual.inicio)} a ${diaMes(p.vendas.mes.atual.fim)})`}
                  valor={brl(p.vendas.mes.atual.receita)}
                  detalhe={
                    <>
                      {num(p.vendas.mes.atual.pecas, 0)} peças · <Variacao c={p.vendas.mes} />
                    </>
                  }
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Indicador rotulo="Capital em estoque" valor={brl(p.estoque.capital)} detalhe={`${num(p.estoque.pecas, 0)} peças pelo custo${p.aCaminho.pecas ? ` · ${num(p.aCaminho.pecas, 0)} a caminho` : ""}`} />
              <Indicador
                rotulo="Estoque parado"
                valor={pct(p.estoque.pctParado)}
                detalhe={`${brl(p.estoque.capitalParado)} · ${num(p.estoque.pecasParadas, 0)} peças sem venda`}
                alerta={(p.estoque.pctParado ?? 0) > 0.4}
                href="/vendas"
              />
              <Indicador
                rotulo="Cobertura"
                valor={p.estoque.coberturaDias == null ? "—" : `${num(p.estoque.coberturaDias, 0)} dias`}
                detalhe={p.estoque.janelaDias ? `estoque ÷ ${num(p.estoque.vendaMediaDiaria, 1)} peças/dia (últimos ${p.estoque.janelaDias} dias)` : "sem vendas recentes"}
              />
            </div>
            {p.sellThrough.length > 0 && (
              <div className="min-w-0">
                <div className="rotulo mb-1">Sell-through por pedido (desde a chegada)</div>
                <ul className="flex flex-col gap-2 md:hidden">
                  {p.sellThrough.map((x) => (
                    <li key={x.pedidoId} className="rounded-xl border border-borda px-3 py-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link href={`/pedidos/${x.pedidoId}`} className="min-w-0 truncate font-medium text-rose-escuro">
                          {x.numero ?? "sem número"}
                        </Link>
                        <span className="shrink-0 text-xs text-[#9a8089]">
                          chegou {dataBr(x.chegada)}
                          {x.chegadaEstimada ? " (estimada)" : ""}
                        </span>
                      </div>
                      <div className="truncate text-xs text-[#9a8089]">
                        <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="" />
                      </div>
                      <div className="mt-1 grid grid-cols-4 gap-1 text-center text-xs">
                        {x.marcos.map((m) => (
                          <div key={m.dias} className="rounded-lg bg-creme px-1 py-1">
                            <div className="text-[#9a8089]">{m.dias} dias</div>
                            <div className="font-semibold">{m.sellThrough == null ? "—" : pct(m.sellThrough)}</div>
                          </div>
                        ))}
                        <div className="rounded-lg bg-rose-claro px-1 py-1">
                          <div className="text-[#9a8089]">hoje</div>
                          <div className="font-semibold">{pct(x.sellThroughAteAgora)}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="tabela w-full">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Chegada</th>
                        <th>Entrou</th>
                        {p.sellThrough[0].marcos.map((m) => (
                          <th key={m.dias}>{m.dias} dias</th>
                        ))}
                        <th>Até hoje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.sellThrough.map((x) => (
                        <tr key={x.pedidoId}>
                          <td>
                            <Link href={`/pedidos/${x.pedidoId}`} className="font-medium text-rose-escuro">
                              {x.numero ?? "sem número"}
                            </Link>
                            <div className="text-xs text-[#9a8089]">
                              <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="" />
                            </div>
                          </td>
                          <td className="whitespace-nowrap">
                            {dataBr(x.chegada)}
                            {x.chegadaEstimada && <span className="block text-[0.65rem] text-[#9a8089]">estimada (data da compra)</span>}
                          </td>
                          <td>{num(x.entrou, 0)}</td>
                          {x.marcos.map((m) => (
                            <td key={m.dias} title={m.vendidas == null ? `faltam ${m.dias - x.diasDesdeChegada} dia(s)` : `${num(m.vendidas, 0)} vendida(s)`}>
                              {m.sellThrough == null ? <span className="text-[#c2a9b2]">—</span> : pct(m.sellThrough)}
                            </td>
                          ))}
                          <td className="font-semibold">{pct(x.sellThroughAteAgora)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-borda pt-3 text-sm">
          <span className="rotulo">Backup fora do computador</span>
          {!p.backup.aplica ? (
            <Selo cor="cinza">banco na nuvem: não se aplica</Selo>
          ) : p.backup.dias == null ? (
            <Link href={LINK_BACKUP}>
              <Selo cor="vermelho">nunca copiado</Selo>
            </Link>
          ) : (
            <Link href={LINK_BACKUP}>
              <Selo cor={p.backup.alerta ? "vermelho" : "verde"}>{p.backup.dias === 0 ? "copiado hoje" : `há ${p.backup.dias} dia(s)`}</Selo>
            </Link>
          )}
        </div>
      </Cartao>

      <Cartao titulo="Pendências">
        {!pendentes.length ? (
          <p className="text-sm text-emerald-700">✓ Tudo em dia.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pendentes.map((x) => (
              <li key={x.chave} className="min-w-0">
                <Link href={x.link} className="flex items-center gap-3 rounded-xl border border-borda px-3 py-2 hover:bg-[#fdf7f9]">
                  <span className="font-titulo min-w-[2.5rem] text-center text-2xl font-semibold text-rose-escuro">{x.n}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{x.rotulo}</span>
                    <span className="block truncate text-xs text-[#9a8089]">{x.dica}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-rose-escuro">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero rotulo="Produtos cadastrados" valor={p.produtos} detalhe={`${p.pecas} peças · ${p.aprovados} aprovados`} />
        <Numero rotulo="Investimento (custo)" valor={<Dinheiro v={p.custo} />} />
        <Numero rotulo="Valor em etiqueta" valor={<Dinheiro v={p.venda} />} detalhe={p.custo ? `markup × ${num(p.venda / p.custo)}` : ""} />
        <Numero rotulo="No UP Vendas" valor={p.noUp} detalhe={`${p.semCodigo} sem código do UP · ${p.comFotoIa} com arte/foto IA`} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/fotos" className="min-w-0">
          <Numero rotulo="Fotos para aprovar" valor={p.fotosPendentes} detalhe="toque para revisar" />
        </Link>
        <Link href="/gastos" className="min-w-0">
          <Numero rotulo="Gastos com IA no mês" valor={<span className="text-lg sm:text-2xl">US$ {num(p.gastoIaMes, 2)}</span>} detalhe="estimativa · ver detalhes" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Cartao titulo="Últimos pedidos" className="min-w-0 lg:col-span-2" acoes={<Link href="/pedidos" className="text-sm text-rose-escuro">ver todos →</Link>}>
          {pedidos.length === 0 ? (
            <p className="text-sm text-[#8a6d78]">
              Nenhum pedido ainda. <Link href="/importar" className="text-rose-escuro underline">Importe o primeiro</Link>.
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-[#f3e8ec] md:hidden">
                {pedidos.slice(0, 8).map((x) => (
                  <li key={x.id} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/pedidos/${x.id}`} className="min-w-0 truncate font-medium text-rose-escuro">
                        {x.numero ?? "sem número"}
                      </Link>
                      <span className="shrink-0 text-xs text-[#9a8089]">{dataBr(x.dataCompra)}</span>
                    </div>
                    <div className="truncate text-xs text-[#9a8089]">
                      <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>
                        {x.linhas} linhas / {x.pecas} peças
                      </span>
                      <span>custo {brl(x.custo)}</span>
                      <span>venda {brl(x.venda)}</span>
                      <Selo cor={x.status === "analisado" ? "verde" : "rose"}>{x.status}</Selo>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="tabela w-full">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Compra</th>
                      <th>Peças</th>
                      <th>Custo</th>
                      <th>Venda</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.slice(0, 8).map((x) => (
                      <tr key={x.id}>
                        <td>
                          <Link href={`/pedidos/${x.id}`} className="font-medium text-rose-escuro">
                            {x.numero ?? "sem número"}
                          </Link>
                          <div className="text-xs text-[#9a8089]">
                            <NomeFornecedor nome={x.fornecedor} apelido={x.fornecedorApelido} vazio="" />
                          </div>
                        </td>
                        <td className="whitespace-nowrap">{dataBr(x.dataCompra)}</td>
                        <td>
                          {x.linhas} / {x.pecas}
                        </td>
                        <td className="whitespace-nowrap">{brl(x.custo)}</td>
                        <td className="whitespace-nowrap">{brl(x.venda)}</td>
                        <td>
                          <Selo cor={x.status === "analisado" ? "verde" : "rose"}>{x.status}</Selo> <Selo cor="cinza">{moedaSimbolo(x.moeda)}</Selo>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Cartao>
        <Cartao titulo="Mix por tipo" className="min-w-0">
          <div className="flex flex-col gap-2">
            {p.porTipo.map((t) => (
              <div key={t.tipo}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{nomeDe(config?.taxonomia.tipos, t.tipo)}</span>
                  <span className="shrink-0 text-[#8a6d78]">{t.pecas} pç</span>
                </div>
                <div className="h-2 rounded-full bg-rose-claro">
                  <div className="h-2 rounded-full bg-rose" style={{ width: `${(t.pecas / maxPecas) * 100}%` }} />
                </div>
              </div>
            ))}
            {!p.porTipo.length && <p className="text-sm text-[#8a6d78]">Sem dados.</p>}
          </div>
        </Cartao>
      </div>
    </div>
  );
}
