"use client";
import { useEffect, useState } from "react";
import { Botao, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { api } from "@/lib/cliente";

type Info = { url: string; chave: string; enderecoPrivado: boolean; dominio: string };

/** Configurações → Skill do Claude: baixar a skill, chave de acesso e o passo a passo de instalação. */
export function ConfigSkill() {
  const avisar = useAviso();
  const [info, setInfo] = useState<Info | null>(null);
  const [verChave, setVerChave] = useState(false);

  useEffect(() => {
    api<Info>("/api/skill/info")
      .then(setInfo)
      .catch((e) => avisar(e.message, "erro"));
  }, [avisar]);

  async function novaChave() {
    if (!confirm("Trocar a chave? A skill instalada com a chave antiga para de enviar cadastros até você baixar de novo ou colar a nova.")) return;
    try {
      const r = await api<{ chave: string }>("/api/skill/info", { method: "POST", json: { acao: "nova" } });
      setInfo((i) => (i ? { ...i, chave: r.chave } : i));
      setVerChave(true);
      avisar("Chave nova criada. Baixe a skill conectada de novo ou atualize a chave no Claude.");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  if (!info) return <Carregando />;
  const copiar = (t: string, msg: string) => navigator.clipboard?.writeText(t).then(() => avisar(msg));
  return (
    <div className="flex flex-col gap-4">
      <Cartao titulo="Skill do Claude: cadastro de peças">
        <div className="flex flex-col gap-3 text-sm text-[#4a3540]">
          <p>
            Com a skill <b className="font-mono">fiodeamor-cadastro</b>, o cadastro é feito direto no Claude: envie o PDF ou as fotos do fornecedor e peça
            “cadastra esse pedido”. A skill recorta as fotos, lê as linhas, busca a cotação PTAX, aplica frete e fator, classifica, sugere os nomes, gera
            as referências e entrega a <b>planilha do UP</b>. Com um clique (ou sozinha, na versão conectada) ela manda o cadastro para este app, onde
            ficam a recompra, os códigos do UP, as fotos com IA, as etiquetas, as vendas e a maleta.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/skill/baixar?conectada=1">
              <Botao>Baixar a skill conectada ao app</Botao>
            </a>
            <a href="/api/skill/baixar">
              <Botao variante="secundario">Baixar a skill sem conexão</Botao>
            </a>
          </div>
          <p className="text-xs text-[#9a8089]">
            As duas levam as regras atuais da loja (fator, frete, taxonomia, nomes). Se mudar alguma regra aqui, baixe e envie a skill de novo. A
            versão conectada leva também o endereço do app e a chave abaixo: não a compartilhe fora da equipe.
          </p>
        </div>
      </Cartao>

      <Cartao titulo="Instalar no Claude (uma vez)">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[#4a3540]">
          <li>
            No Claude (site ou app), abra <b>Configurações → Capacidades</b> e ligue <b>Execução de código e criação de arquivos</b>.
          </li>
          <li>
            Em <b>Acesso à rede</b> (mesma tela), mantenha os gerenciadores de pacotes e acrescente <b className="font-mono">www4.bcb.gov.br</b> (cotação PTAX)
            {info.enderecoPrivado ? "" : <> e <b className="font-mono">{info.dominio}</b> (este app)</>}. Sem isso a skill pede a cotação a você e entrega o
            cadastro como arquivo para importar aqui.
          </li>
          <li>
            Em <b>Skills</b>, clique em <b>Enviar skill</b> e escolha o ZIP baixado acima. Deixe a skill ligada.
          </li>
          <li>
            Num chat novo (de preferência num <b>Projeto</b> “Cadastro Fio de Amor”), anexe o PDF do pedido e escreva: <i>“cadastra esse pedido; frete R$ 850”</i>.
          </li>
        </ol>
        {info.enderecoPrivado && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            <b>Este app está em {info.url}</b>, que só abre na rede da loja: o Claude não consegue mandar o cadastro sozinho. A skill entrega o arquivo
            <span className="font-mono"> cadastro-….json</span>; importe em <b>Importar pedido → Cadastro feito no Claude</b>. Com o app publicado na
            internet (docs/nuvem.md), o envio fica automático.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Endereço e chave da skill">
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-[auto_1fr] md:items-center">
          <span className="rotulo">Endereço do app</span>
          <span className="flex flex-wrap items-center gap-2 font-mono">
            {info.url} {info.enderecoPrivado ? <Selo cor="amarelo">só na rede da loja</Selo> : <Selo cor="verde">na internet</Selo>}
          </span>
          <span className="rotulo">Chave</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{verChave ? info.chave : `${info.chave.slice(0, 8)}••••••••••••`}</span>
            <Botao variante="fantasma" onClick={() => setVerChave((v) => !v)}>
              {verChave ? "Esconder" : "Mostrar"}
            </Botao>
            <Botao variante="secundario" onClick={() => copiar(info.chave, "Chave copiada.")}>
              Copiar
            </Botao>
            <Botao variante="perigo" onClick={novaChave}>
              Gerar chave nova
            </Botao>
          </span>
        </div>
        <p className="mt-3 text-xs text-[#9a8089]">
          A chave só permite à skill ler as regras e as peças já cadastradas e enviar cadastros novos (nunca apaga nem altera o que já existe). Tudo o
          que chega pela skill fica no Histórico como “Skill do Claude”.
        </p>
      </Cartao>
    </div>
  );
}
