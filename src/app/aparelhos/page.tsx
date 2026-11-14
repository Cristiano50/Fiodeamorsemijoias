"use client";
import { useEffect, useState } from "react";
import { Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";

type Rede = { porta: number; enderecos: { url: string; interface: string }[]; noServidor: boolean; enderecoAtual: string; computador: string };

/** Como abrir o app no celular (Android e iPhone) e nos outros computadores da loja. */
export default function AparelhosPage() {
  const avisar = useAviso();
  const [rede, setRede] = useState<Rede | null>(null);
  useEffect(() => {
    api<Rede>("/api/rede")
      .then(setRede)
      .catch((e) => avisar(e.message, "erro"));
  }, [avisar]);
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
          o endereço abaixo no navegador — nada para instalar. Todos veem os mesmos produtos e pedidos.
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
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => copiar(principal)} className="text-left font-mono text-2xl text-rose-escuro" title="Copiar">
                {principal}
              </button>
              <p className="text-sm text-[#6b5560]">Aponte a câmera do celular para o QR code, ou digite o endereço no navegador.</p>
              {rede.enderecos.length > 1 && rede.noServidor && (
                <p className="text-xs text-[#9a8089]">
                  Outros endereços deste computador: {rede.enderecos.slice(1).map((e) => `${e.url} (${e.interface})`).join(" · ")}
                </p>
              )}
            </div>
          </div>
        </Cartao>
      )}

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
          <li>O computador-servidor precisa estar <b>ligado</b> (o app inicia sozinho com o Windows).</li>
          <li>O aparelho precisa estar no <b>mesmo Wi-Fi</b> da loja — com os dados móveis (4G/5G) não abre.</li>
          <li>
            No computador-servidor, a rede do Windows deve estar como <b>Privada</b> (Configurações → Rede e Internet → Wi-Fi ou Ethernet → Tipo de
            perfil de rede: Privada). O instalador já libera o app no firewall para redes privadas.
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
