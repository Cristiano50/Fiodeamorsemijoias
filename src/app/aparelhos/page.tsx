"use client";
import { useCallback, useEffect, useState } from "react";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";

type Rede = {
  porta: number;
  enderecos: { url: string; interface: string }[];
  noServidor: boolean;
  enderecoAtual: string;
  computador: string;
  urlPublica: string;
  urlPublicaNoDeploy: boolean;
  tailscale: { enderecos: string[]; nome: string | null } | null;
  modo: "aberto" | "senha" | "usuarios";
  ehGestora: boolean;
};

const GUIA_FORA = "https://github.com/Cristiano50/Fiodeamorsemijoias/blob/main/docs/acesso-de-fora.md";

const QrCode = ({ url }: { url: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={`/api/codigo-barras?c=${encodeURIComponent(url)}&tipo=qrcode&texto=0&altura=30`}
    alt={`QR code de ${url}`}
    className="h-40 w-40 shrink-0 rounded-xl border border-borda bg-white p-2"
  />
);

/** Acesso de fora da loja: endereço na internet (Cloudflare Tunnel) e/ou rede particular Tailscale. */
function ForaDaLoja({ rede, recarregar }: { rede: Rede; recarregar: () => Promise<void> }) {
  const avisar = useAviso();
  const [url, setUrl] = useState(rede.urlPublica);
  const [ocupado, setOcupado] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => avisar("Endereço copiado."));

  async function testar() {
    setOcupado("testar");
    setResultado(null);
    try {
      setResultado(await api<{ ok: boolean; mensagem: string }>("/api/rede", { method: "POST", json: { acao: "testar", url } }));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }
  async function salvar() {
    setOcupado("salvar");
    try {
      await api("/api/config", { method: "PUT", json: { chave: "sistema", valor: { urlPublica: url } } });
      await recarregar();
      avisar(url.trim() ? "Endereço na internet salvo. Os links do catálogo da Meta, da skill e das planilhas passam a usar ele." : "Endereço na internet apagado.");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado("");
    }
  }

  return (
    <Cartao titulo="Fora da loja (outra internet)">
      <div className="flex flex-col gap-4 text-sm text-[#4a3540]">
        {rede.modo === "aberto" && (
          <p className="rounded-xl bg-red-50 p-3 text-red-800">
            O app está <b>sem senha</b>: de fora da loja (e dos outros aparelhos) ninguém entra até você criar os usuários em{" "}
            <b>Configurações → Usuários</b>. É de propósito, para ninguém da internet abrir o app.
          </p>
        )}

        {rede.urlPublica ? (
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
            <QrCode url={rede.urlPublica} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="rotulo">Endereço na internet</span>
              <button type="button" onClick={() => copiar(rede.urlPublica)} className="break-all text-left font-mono text-lg text-rose-escuro sm:text-xl" title="Copiar">
                {rede.urlPublica}
              </button>
              <p>
                Abre em <b>qualquer internet</b> (em casa, em outra loja, no 4G), no navegador, sem instalar nada. Cada pessoa entra com o seu usuário e
                senha. No celular, dá para adicionar à tela inicial como na loja.
              </p>
            </div>
          </div>
        ) : null}

        {rede.tailscale ? (
          <div className="rounded-xl bg-rose-claro/60 p-3">
            <span className="rotulo">Pela rede particular Tailscale</span>
            <p className="mt-1">
              {rede.tailscale.nome && (
                <>
                  <button type="button" onClick={() => copiar(rede.tailscale!.nome!)} className="break-all font-mono text-rose-escuro" title="Copiar">
                    {rede.tailscale.nome}
                  </button>{" "}
                  ou{" "}
                </>
              )}
              {rede.tailscale.enderecos.map((e) => (
                <button key={e} type="button" onClick={() => copiar(e)} className="break-all font-mono text-rose-escuro" title="Copiar">
                  {e}
                </button>
              ))}
            </p>
            <p className="mt-1 text-xs text-[#6b5560]">
              Funciona só nos computadores e celulares com o aplicativo <b>Tailscale</b> ligado e conectado à mesma conta da loja.
            </p>
          </div>
        ) : null}

        {!rede.urlPublica && !rede.tailscale && (
          <div className="flex flex-col gap-2">
            <p>
              Hoje o app só abre na rede da loja. Para usar num computador com <b>outra internet</b>, escolha um dos jeitos (o passo a passo está no{" "}
              <a href={GUIA_FORA} target="_blank" rel="noreferrer" className="text-rose-escuro underline">
                guia de acesso de fora da loja
              </a>
              ):
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <b>Endereço próprio na internet</b> (recomendado): o app ganha um endereço como <span className="font-mono">https://app.suaLoja.com.br</span>{" "}
                que abre em qualquer computador ou celular, sem instalar nada neles. Usa o túnel grátis do Cloudflare, instalado só neste computador, e
                precisa de um domínio. De quebra, liga o catálogo da Meta e a skill do Claude conectada.
              </li>
              <li>
                <b>Rede particular Tailscale</b>: sem domínio. Instale o aplicativo Tailscale neste computador e em cada computador ou celular de fora,
                entrando com a mesma conta. O app fica fora da internet aberta.
              </li>
            </ol>
          </div>
        )}

        {rede.ehGestora && (
          <div className="flex flex-col gap-2 border-t border-borda pt-3">
            <label className="rotulo" htmlFor="url-publica">
              Endereço do app na internet {rede.urlPublicaNoDeploy && <Selo cor="cinza">definido no deploy</Selo>}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="url-publica"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://app.minhaloja.com.br"
                value={url}
                disabled={rede.urlPublicaNoDeploy}
                onChange={(e) => setUrl(e.target.value)}
                className="min-w-0 flex-1 font-mono"
              />
              <div className="flex gap-2">
                <Botao variante="secundario" onClick={testar} carregando={ocupado === "testar"} disabled={!url.trim()}>
                  Testar
                </Botao>
                <Botao onClick={salvar} carregando={ocupado === "salvar"} disabled={rede.urlPublicaNoDeploy || url.trim() === rede.urlPublica}>
                  Salvar
                </Botao>
              </div>
            </div>
            {resultado && <p className={resultado.ok ? "text-emerald-700" : "text-red-700"}>{resultado.mensagem}</p>}
            <p className="text-xs text-[#9a8089]">
              Preencha depois de criar o túnel do Cloudflare (passo a passo no guia). Os links das fotos no catálogo da Meta, na skill do Claude e
              nas planilhas passam a usar este endereço. Vazio = só na rede da loja.
            </p>
          </div>
        )}
      </div>
    </Cartao>
  );
}

/** Como abrir o app no celular (Android e iPhone) e nos outros computadores da loja. */
export default function AparelhosPage() {
  const avisar = useAviso();
  const [rede, setRede] = useState<Rede | null>(null);
  const carregar = useCallback(() => api<Rede>("/api/rede").then(setRede), []);
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);
  if (!rede) return <Carregando />;

  // No próprio servidor, o endereço para os outros é o da rede; fora dele, o que já está aberto.
  const principal = rede.noServidor ? rede.enderecos[0]?.url : rede.enderecoAtual;
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => avisar("Endereço copiado."));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-4xl font-semibold">Celular e outros computadores</h1>
        <p className="max-w-3xl text-sm text-[#8a6d78]">
          O app roda no computador-servidor da loja ({rede.computador}). Os celulares e os outros computadores conectados ao <b>mesmo Wi-Fi</b> abrem
          o endereço abaixo no navegador — nada para instalar. Todos veem os mesmos produtos e pedidos. Para usar com <b>outra internet</b>, veja
          &ldquo;Fora da loja&rdquo;.
        </p>
      </div>

      {!principal ? (
        <Cartao>
          <p className="text-sm text-amber-800">
            Não encontrei o endereço deste computador na rede. Confira se ele está conectado ao Wi-Fi ou ao cabo de rede da loja e abra esta página de
            novo.
          </p>
        </Cartao>
      ) : (
        <Cartao titulo="Endereço do app na rede da loja">
          <div className="flex flex-col items-start gap-5 md:flex-row md:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/codigo-barras?c=${encodeURIComponent(principal)}&tipo=qrcode&texto=0&altura=30`}
              alt={`QR code de ${principal}`}
              className="h-44 w-44 rounded-xl border border-borda bg-white p-2"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <button type="button" onClick={() => copiar(principal)} className="break-all text-left font-mono text-xl text-rose-escuro sm:text-2xl" title="Copiar">
                {principal}
              </button>
              <p className="text-sm text-[#6b5560]">Aponte a câmera do celular para o QR code, ou digite o endereço no navegador.</p>
              {rede.enderecos.length > 1 && rede.noServidor && (
                <p className="break-words text-xs text-[#9a8089]">
                  Outros endereços deste computador: {rede.enderecos.slice(1).map((e) => `${e.url} (${e.interface})`).join(" · ")}
                </p>
              )}
            </div>
          </div>
        </Cartao>
      )}

      {/* key: depois de salvar, o campo volta com o endereço como ficou guardado (com https://). */}
      <ForaDaLoja key={rede.urlPublica} rede={rede} recarregar={carregar} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Cartao titulo="Android">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#4a3540]">
            <li>Conecte o celular ao Wi-Fi da loja.</li>
            <li>Abra o endereço no <b>Chrome</b> (ou leia o QR code com a câmera).</li>
            <li>
              Toque em <b>⋮</b> (canto de cima) → <b>Adicionar à tela inicial</b>.
            </li>
            <li>O ícone da Fio de Amor aparece junto dos outros aplicativos.</li>
          </ol>
        </Cartao>
        <Cartao titulo="iPhone">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#4a3540]">
            <li>Conecte o iPhone ao Wi-Fi da loja.</li>
            <li>Abra o endereço no <b>Safari</b> (ou leia o QR code com a câmera).</li>
            <li>
              Toque em <b>Compartilhar</b> (quadrado com seta) → <b>Adicionar à Tela de Início</b>.
            </li>
            <li>O app abre em tela cheia, como um aplicativo.</li>
          </ol>
        </Cartao>
        <Cartao titulo="Outros computadores">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#4a3540]">
            <li>Conecte o computador à rede da loja.</li>
            <li>Abra o endereço no Chrome ou no Edge.</li>
            <li>
              Para um atalho: no Chrome, <b>⋮ → Transmitir, salvar e compartilhar → Instalar página como app</b> (ou arraste o endereço para a área de
              trabalho).
            </li>
          </ol>
        </Cartao>
      </div>

      <Cartao titulo="Se não abrir">
        <ul className="list-disc space-y-1 pl-5 text-sm text-[#4a3540]">
          <li>
            O computador-servidor precisa estar <b>ligado</b> (o app inicia sozinho com o Windows). Se o servidor parar, abra o atalho{" "}
            <b>Fio de Amor</b> no computador-servidor: ele liga de novo, sem precisar de senha de administrador.
          </li>
          <li>
            Pelo endereço da rede da loja, o aparelho precisa estar no <b>mesmo Wi-Fi</b> — com os dados móveis (4G/5G) ou em casa, use o endereço de{" "}
            <b>fora da loja</b> (acima).
          </li>
          <li>
            No computador-servidor, a rede do Windows deve estar como <b>Privada</b> (Configurações → Rede e Internet → Wi-Fi ou Ethernet → Tipo de
            perfil de rede: Privada). O instalador já libera o app no firewall, só para os aparelhos da rede da loja.
          </li>
          <li>
            Se o roteador trocar o endereço do computador, abra esta página no servidor de novo. Para fixar, peça a quem cuida da internet para
            reservar o IP do computador-servidor no roteador.
          </li>
          <li>
            <Selo cor="amarelo">segurança</Selo> qualquer pessoa no Wi-Fi da loja consegue abrir a tela de login: crie usuários com senha
            (Configurações → Usuários) e deixe as clientes num Wi-Fi de <b>visitantes</b> separado.
          </li>
        </ul>
      </Cartao>
    </div>
  );
}
