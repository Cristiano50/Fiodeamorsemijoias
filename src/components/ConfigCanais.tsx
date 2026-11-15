"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig, type ConfigCliente } from "@/components/hooks";
import { api } from "@/lib/cliente";
import { preencherLink, soDigitos, whatsappValido } from "@/lib/feed-meta";

/** Resposta de GET /api/feed/meta?info=1 */
interface InfoFeed {
  chave: string;
  url: string;
  urlTsv: string;
  urlBase: string;
  enderecoPrivado: boolean;
  urlPublicaDefinida: boolean;
  whatsappValido: boolean;
  modo: "aberto" | "senha" | "usuarios";
  itens: number;
  total: number;
  semFotoAprovada?: number; // peças que ficaram fora só por falta de foto aprovada/enviada pela loja
}

type TipoBackup = "diario" | "manual" | "antes-da-migracao";

/** Situação gravada pelo servidor: último sucesso (em/arquivo) e a última falha (erro/tentativaEm). */
interface Situacao {
  em: string | null;
  arquivo: string | null;
  erro: string | null;
  tentativaEm: string | null;
  pasta?: string | null;
}

/** Resposta de GET /api/backup?lista=1 */
interface ListaBackups {
  local: boolean;
  explicacao?: string;
  pasta?: string;
  manter?: number;
  manterPorTipo?: Record<TipoBackup, number>;
  manterCopiasExternas?: number;
  backups: { nome: string; tamanho: number; data: string; tipo?: TipoBackup }[];
  diario?: Situacao;
  copiaExterna?: Situacao;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Link de download com a aparência do Botao (downloads são rotas /api, não páginas). */
function LinkBaixar({ href, variante = "primario", children, onClick }: { href: string; variante?: "primario" | "fantasma"; children: ReactNode; onClick?: () => void }) {
  const estilo = variante === "primario" ? "bg-rose-escuro text-white hover:bg-[#7a4c5e] border border-rose-escuro" : "bg-transparent text-rose-escuro hover:bg-rose-claro border border-transparent";
  return (
    <a href={href} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${estilo}`}>
      {children}
    </a>
  );
}

/** Aba de Configurações com o WhatsApp e o catálogo da Meta, e o backup do banco. */
export function ConfigCanais() {
  const { config, recarregar } = useConfig();
  if (!config) return <Carregando />;
  return (
    <div className="flex flex-col gap-4">
      <CatalogoMeta config={config} recarregar={recarregar} />
      <Backup config={config} recarregar={recarregar} />
    </div>
  );
}

/* --------------------------------------------------- WhatsApp e catálogo Meta */

function CatalogoMeta({ config, recarregar }: { config: ConfigCliente; recarregar: () => Promise<void> }) {
  const avisar = useAviso();
  const [numero, setNumero] = useState(config.sistema.whatsappNumero ?? "");
  const [modelo, setModelo] = useState(config.sistema.linkProdutoModelo ?? "");
  const [salvando, setSalvando] = useState(false);
  const [info, setInfo] = useState<InfoFeed | null>(null);
  const [erroInfo, setErroInfo] = useState("");
  const chaveSalva = config.sistema.feedChave ?? "";

  const carregarInfo = useCallback(
    () =>
      api<InfoFeed>("/api/feed/meta?info=1").then(async (i) => {
        setInfo(i);
        setErroInfo("");
        // A chave pode ter acabado de ser criada no servidor: recarrega para não apagá-la ao salvar.
        if (i.chave !== chaveSalva) await recarregar();
      }),
    [chaveSalva, recarregar],
  );
  useEffect(() => {
    carregarInfo().catch((e) => setErroInfo(mensagem(e)));
  }, [carregarInfo]);

  const digitos = soDigitos(numero);
  const exemplo = preencherLink(modelo, { whatsapp: digitos, referencia: "BR_2611001", nome: "Argola Luz Dourada" });

  async function salvar() {
    if (digitos && !whatsappValido(digitos)) return avisar("Confira o número: 55 + DDD + número, só dígitos (ex.: 5511999999999).", "erro");
    if (!/^https?:\/\//i.test(modelo.trim())) return avisar("O modelo do link precisa começar com https://", "erro");
    setSalvando(true);
    try {
      await api("/api/config", {
        method: "PUT",
        json: {
          chave: "sistema",
          valor: { whatsappNumero: digitos, linkProdutoModelo: modelo.trim() },
        },
      });
      await recarregar();
      await carregarInfo().catch(() => {});
      avisar("WhatsApp e link do catálogo salvos.");
    } catch (e) {
      avisar(mensagem(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function novaChave() {
    if (!confirm("Gerar uma chave nova? O link antigo para de funcionar e você vai precisar colar o novo no Commerce Manager.")) return;
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { trocarFeedChave: true } } });
      await carregarInfo();
      avisar("Chave nova gerada. Atualize a URL no Commerce Manager.");
    } catch (e) {
      avisar(mensagem(e), "erro");
    }
  }

  function copiar() {
    if (!info) return;
    if (!navigator.clipboard) return avisar("Selecione o endereço e copie com Ctrl+C.", "info");
    navigator.clipboard.writeText(info.url).then(
      () => avisar("URL do feed copiada."),
      () => avisar("Não deu para copiar sozinho: selecione o endereço e copie com Ctrl+C.", "info"),
    );
  }

  return (
    <Cartao titulo="WhatsApp e catálogo Meta">
      <p className="mb-3 text-sm text-[#6b5560]">
        O app gera o arquivo do catálogo no formato da Meta. Cadastrado no Commerce Manager, o catálogo aparece no <b>WhatsApp Business</b> e no{" "}
        <b>Instagram Shopping</b>. Entram as peças <b>aprovadas, com preço, com estoque e com foto aprovada pela loja</b> (foto com IA aprovada em “Fotos para aprovar” ou foto enviada pela loja); o botão de cada peça abre uma conversa no WhatsApp da loja.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Campo
          rotulo="Número do WhatsApp da loja"
          dica={
            <>
              Só números, com 55 + DDD + número. Ex.: 5511999999999{" "}
              {digitos ? whatsappValido(digitos) ? <Selo cor="verde">número completo</Selo> : <Selo cor="amarelo">confira o número</Selo> : <Selo cor="amarelo">não preenchido</Selo>}
            </>
          }
        >
          <input inputMode="numeric" autoComplete="off" placeholder="5511999999999" value={numero} onChange={(e) => setNumero(soDigitos(e.target.value))} className="font-mono" />
        </Campo>
        <div className="flex items-end justify-end">
          <Botao carregando={salvando} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-[#8a6d78]">Avançado: modelo do link do produto</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Campo
            rotulo="Modelo do link"
            dica={
              <>
                Marcadores: <b className="font-mono">{"{whatsapp}"}</b> (número acima), <b className="font-mono">{"{referencia}"}</b> e <b className="font-mono">{"{nome}"}</b>. Espaços e
                acentos são codificados sozinhos.
              </>
            }
          >
            <input value={modelo} onChange={(e) => setModelo(e.target.value)} className="font-mono text-xs" spellCheck={false} />
          </Campo>
          <p className="break-all text-xs text-[#8a6d78]">
            Exemplo:{" "}
            <a href={exemplo} target="_blank" rel="noreferrer" className="text-rose-escuro underline">
              {exemplo}
            </a>
          </p>
        </div>
      </details>

      <div className="mt-4 border-t border-borda pt-4">
        <span className="rotulo">URL do feed (para o Commerce Manager)</span>
        {erroInfo ? (
          <p className="mt-1 text-sm text-red-700">{erroInfo}</p>
        ) : !info ? (
          <Carregando texto="Preparando o link do feed…" />
        ) : (
          <>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input readOnly value={info.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" aria-label="URL do feed" />
              <Botao variante="secundario" onClick={copiar} className="shrink-0">
                Copiar
              </Botao>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Selo cor={info.itens ? "verde" : "amarelo"}>
                {info.itens} de {info.total} peças entram no feed
              </Selo>
              {!info.whatsappValido && <Selo cor="amarelo">preencha o WhatsApp antes de cadastrar</Selo>}
              {!!info.semFotoAprovada && (
                <Selo cor="amarelo">
                  {info.semFotoAprovada} fora só por falta de foto aprovada — veja em “Fotos para aprovar”
                </Selo>
              )}
              <span className="text-xs text-[#9a8089]">(aprovadas, com preço e com foto com IA aprovada pela loja ou foto enviada pela loja)</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkBaixar href={info.url}>Baixar CSV agora</LinkBaixar>
              <LinkBaixar href={`${info.url}&todos=1`} variante="fantasma">
                Baixar com todas as peças (para conferir)
              </LinkBaixar>
              <Botao variante="fantasma" onClick={novaChave}>
                Gerar chave nova
              </Botao>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
        <b>Atenção:</b> o feed agendado só funciona com o app <b>publicado na internet</b> (veja o passo a passo em <span className="font-mono">docs/nuvem.md</span>
        ): a Meta abre o link sozinha todos os dias. No computador da loja, use <b>Baixar CSV agora</b> e envie o arquivo manualmente no Commerce Manager (Fontes de
        dados → Feed de dados → Upload de arquivo). Mesmo assim, a Meta baixa as fotos pelos links do arquivo: se eles só abrem dentro da loja, as peças ficam sem
        foto.
        {info?.enderecoPrivado && (
          <>
            {" "}
            <b>
              Este app está em <span className="font-mono">{info.urlBase}</span>, que só funciona na rede da loja.
            </b>
          </>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-creme p-3 text-sm">
        <b>Como cadastrar no Commerce Manager (uma vez só)</b>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>
            Entre em <b>business.facebook.com/commerce</b> e abra o catálogo da loja (ou crie um do tipo <i>E-commerce</i>).
          </li>
          <li>
            Vá em <b>Catálogo → Fontes de dados → Feed de dados → Feed agendado</b>.
          </li>
          <li>
            <b>Cole a URL acima</b>, escolha a frequência <b>diária</b> e a moeda <b>BRL</b>, e conclua. Os erros de cada peça aparecem em <i>Diagnóstico</i>.
          </li>
          <li>
            Ative o catálogo no <b>WhatsApp Business</b> (conecte o catálogo ao número da loja) e no <b>Instagram Shopping</b> (configure a loja com o Instagram da
            marca e envie para análise da Meta).
          </li>
        </ol>
        <p className="mt-2 text-xs text-[#8a6d78]">Os nomes dos menus da Meta mudam de vez em quando; se não achar, procure por “Fontes de dados” ou “Data sources”.</p>
      </div>
    </Cartao>
  );
}

/* ----------------------------------------------------------------- Backup */

const tamanhoMb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
/** A última tentativa falhou depois do último sucesso? */
const falhouPorUltimo = (s: Situacao | undefined) => !!s?.erro && (!s.em || (s.tentativaEm ?? "") >= s.em);

const TIPO: Record<TipoBackup, { rotulo: string; cor: "rose" | "verde" | "amarelo" | "cinza" | "dourado" }> = {
  diario: { rotulo: "automático", cor: "cinza" },
  manual: { rotulo: "manual", cor: "rose" },
  "antes-da-migracao": { rotulo: "antes da atualização", cor: "dourado" },
};

function Backup({ config, recarregar }: { config: ConfigCliente; recarregar: () => Promise<void> }) {
  const avisar = useAviso();
  const [dados, setDados] = useState<ListaBackups | null>(null);
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);
  const salvaNoConfig = config.sistema.backupPastaExterna ?? "";
  const [pasta, setPasta] = useState(salvaNoConfig);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; mensagem: string; pasta: string } | null>(null);
  const carregar = useCallback(
    () =>
      api<ListaBackups>("/api/backup?lista=1").then((d) => {
        setDados(d);
        setErro("");
      }),
    [],
  );
  useEffect(() => {
    carregar().catch((e) => setErro(mensagem(e)));
  }, [carregar]);

  function aoBaixar() {
    setGerando(true);
    // O download começa quando a cópia fica pronta; depois atualiza a lista.
    setTimeout(() => {
      setGerando(false);
      carregar().catch(() => {});
    }, 6000);
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      const r = await api<{ ok: boolean; mensagem: string; pasta: string }>("/api/backup", { method: "POST", json: { acao: "testar-pasta", pasta } });
      setTeste(r);
    } catch (e) {
      setTeste({ ok: false, mensagem: mensagem(e), pasta });
    } finally {
      setTestando(false);
    }
  }

  async function salvarPasta() {
    setSalvando(true);
    // Sem espaços nas pontas e sem as aspas do "Copiar como caminho" do Windows.
    const valor = pasta.trim().replace(/^"(.*)"$/, "$1").trim();
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { backupPastaExterna: valor } } });
      await recarregar();
      setPasta(valor);
      avisar(valor ? "Pasta salva. A cópia sai logo depois do backup automático do dia (o app confere a cada 10 minutos de uso)." : "Cópia externa desligada.");
      carregar().catch(() => {});
    } catch (e) {
      avisar(mensagem(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const copia = dados?.copiaExterna;
  const diario = dados?.diario;
  const manter = dados?.manterPorTipo;
  const mudou = pasta.trim() !== salvaNoConfig.trim();

  return (
    <Cartao
      titulo="Backup"
      acoes={
        dados?.local && (
          <>
            <Botao variante="fantasma" onClick={() => carregar().catch((e) => setErro(mensagem(e)))}>
              Atualizar lista
            </Botao>
            <LinkBaixar href="/api/backup" onClick={aoBaixar}>
              {gerando ? "Gerando backup…" : "Baixar backup agora"}
            </LinkBaixar>
          </>
        )
      }
    >
      {erro ? (
        <p className="text-sm text-red-700">{erro}</p>
      ) : !dados ? (
        <Carregando />
      ) : !dados.local ? (
        <p className="rounded-xl bg-creme p-3 text-sm">{dados.explicacao}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-[#6b5560]">
            O app faz <b>um backup automático por dia</b> na pasta <span className="break-all font-mono">{dados.pasta}</span> e guarda os {manter?.diario ?? dados.manter}{" "}
            mais recentes. O botão acima faz uma cópia <b>manual</b> na hora e baixa o arquivo (ficam as {manter?.manual ?? 20} últimas). Antes de cada atualização do app
            que muda o banco, fica mais uma cópia (as {manter?.["antes-da-migracao"] ?? 3} últimas). Todas as fotos estão dentro do banco, então o arquivo pode ser grande.
          </p>
          {falhouPorUltimo(diario) ? (
            <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              <b>O backup automático falhou</b> em {quando(diario?.tentativaEm)}: {diario?.erro} O app tenta de novo em 1 hora.
            </p>
          ) : diario?.em ? (
            <p className="mb-3 text-sm text-[#6b5560]">
              Último backup automático: <b>{quando(diario.em)}</b>.
            </p>
          ) : null}

          <div className="mb-4 rounded-xl border border-borda p-3">
            <span className="rotulo">Cópia fora deste computador</span>
            <p className="mt-1 text-sm text-[#6b5560]">
              Depois do backup automático, o app copia o arquivo para esta pasta e guarda lá as {dados.manterCopiasExternas ?? 14} cópias mais recentes. Use um{" "}
              <b>pen drive</b> que fique sempre conectado ou a pasta <span className="font-mono">C:\FioDeAmor-Backup</span> (o instalador já criou) sincronizada pelo
              Google Drive. Se o computador estragar ou for roubado, o backup continua seguro.
            </p>
            <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end">
              <Campo rotulo="Pasta para a cópia diária" className="min-w-0 flex-1" dica="Vazio = não copia. Exemplos: E:\Backup Fio de Amor (pen drive) ou C:\FioDeAmor-Backup.">
                <input value={pasta} onChange={(e) => setPasta(e.target.value)} placeholder="E:\Backup Fio de Amor" className="font-mono" spellCheck={false} autoComplete="off" />
              </Campo>
              <div className="flex flex-wrap gap-2 md:pb-5">
                <Botao variante="secundario" carregando={testando} disabled={!pasta.trim()} onClick={testar}>
                  Testar pasta
                </Botao>
                <Botao carregando={salvando} disabled={!mudou} onClick={salvarPasta}>
                  Salvar
                </Botao>
              </div>
            </div>
            {teste && (
              <p className={`mt-2 rounded-xl p-3 text-sm ${teste.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                {teste.ok ? "✓ " : "✗ "}
                {teste.mensagem}
              </p>
            )}
            <div className="mt-2 text-sm">
              {falhouPorUltimo(copia) ? (
                <p className="rounded-xl bg-red-50 p-3 text-red-800">
                  <b>A última cópia externa falhou</b> em {quando(copia?.tentativaEm)}: {copia?.erro}
                  {copia?.em && (
                    <>
                      {" "}
                      A última que deu certo foi em {quando(copia.em)}.
                    </>
                  )}
                </p>
              ) : copia?.em ? (
                <p className="text-[#6b5560]">
                  Última cópia externa: <b>{quando(copia.em)}</b> — <span className="break-all font-mono text-xs">{copia.arquivo}</span> em{" "}
                  <span className="break-all font-mono text-xs">{copia.pasta}</span>
                </p>
              ) : (
                <p className="text-[#8a6d78]">{salvaNoConfig ? "Ainda não houve cópia para a pasta externa." : "Nenhuma pasta externa configurada."}</p>
              )}
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-[#8a6d78]">Por que não dá para usar a pasta do Google Drive ou do OneDrive do meu usuário?</summary>
              <p className="mt-1 text-[#6b5560]">
                No computador da loja, o servidor do app roda como uma conta de serviço do Windows (LocalService), sem poderes de administrador, por segurança.
                Essa conta não grava nas pastas dos usuários (como <span className="font-mono">C:\Users\Maria\Google Drive</span> ou{" "}
                <span className="font-mono">C:\Users\Maria\OneDrive</span>) e não enxerga a unidade <span className="font-mono">G:</span> do Google Drive. Use um pen
                drive, ou a pasta <span className="font-mono">C:\FioDeAmor-Backup</span> e, no Google Drive para computador, vá em Preferências → Meu computador →
                Adicionar pasta e escolha essa pasta.
              </p>
            </details>
          </div>

          {dados.backups.length === 0 ? (
            <p className="text-sm text-[#8a6d78]">Nenhum backup ainda. O primeiro automático sai alguns segundos depois que o app é usado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela w-full">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Arquivo</th>
                    <th>Tamanho</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dados.backups.map((b) => (
                    <tr key={b.nome}>
                      <td className="whitespace-nowrap">{quando(b.data)}</td>
                      <td className="whitespace-nowrap">
                        <Selo cor={TIPO[b.tipo ?? "diario"].cor}>{TIPO[b.tipo ?? "diario"].rotulo}</Selo>
                      </td>
                      <td className="font-mono text-xs">{b.nome}</td>
                      <td className="whitespace-nowrap text-xs">{tamanhoMb(b.tamanho)}</td>
                      <td className="text-right">
                        <a href={`/api/backup?arquivo=${encodeURIComponent(b.nome)}`} className="text-sm text-rose-escuro underline">
                          Baixar
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 rounded-xl bg-creme p-3 text-sm">
            <b>Como restaurar um backup</b>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>
                Pare o servidor do app. No computador da loja, quem tem senha de administrador para a tarefa “Fio de Amor - Servidor” (o passo a passo está em{" "}
                <span className="font-mono">docs/backup.md</span>); no computador de desenvolvimento, Ctrl+C no terminal.
              </li>
              <li>
                Na pasta do app, abra <span className="font-mono">dados</span> e renomeie <span className="font-mono">fiodeamor.db</span> para{" "}
                <span className="font-mono">fiodeamor-antigo.db</span>. Renomeie também <span className="font-mono">fiodeamor.db-wal</span> e{" "}
                <span className="font-mono">fiodeamor.db-shm</span>, se existirem (senão o banco antigo se mistura com o backup).
              </li>
              <li>
                Copie o backup escolhido para a pasta <span className="font-mono">dados</span> e renomeie para <span className="font-mono">fiodeamor.db</span>.
              </li>
              <li>Abra o app de novo. Tudo volta a ficar como estava no dia e na hora do backup.</li>
            </ol>
            <p className="mt-2 text-xs text-[#8a6d78]">
              Passo a passo completo (inclusive no computador da loja) em <span className="font-mono">docs/backup.md</span>.
            </p>
          </div>
        </>
      )}
    </Cartao>
  );
}
