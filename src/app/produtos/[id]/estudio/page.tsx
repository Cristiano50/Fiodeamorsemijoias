"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig } from "@/components/hooks";
import { api, brl, img } from "@/lib/cliente";

type Avaliacao = { aprovada: boolean; nota: number; problemas: string[]; pontos_fortes: string[]; eliminatorios: string[] };
type ImagemInfo = {
  id: string;
  origem: string;
  meta: { aprovada?: boolean | null; avaliacao?: Avaliacao | null; tentativas?: { numero: number; aprovada: boolean | null; nota: number | null }[]; modelo?: string; cenario?: string } | null;
  criadoEm?: string;
};

/** Foto padrão da arte: a foto com modelo aprovada mais recente; senão a última foto com modelo; senão a do catálogo. */
function fotoPadrao(imagens: ImagemInfo[], principal: string | null) {
  const ia = imagens.filter((i) => i.origem === "ia");
  return ia.find((i) => i.meta?.aprovada)?.id ?? ia[0]?.id ?? principal ?? imagens[0]?.id ?? null;
}
type Tpl = "feed_produto" | "feed_lancamento" | "quadrado_feed" | "stories_produto" | "catalogo_whatsapp" | "vitrine_loja";

const TEMPLATES: { id: Tpl; nome: string; w: number; h: number }[] = [
  { id: "feed_produto", nome: "Feed · produto (4:5)", w: 1080, h: 1350 },
  { id: "feed_lancamento", nome: "Feed · lançamento (4:5)", w: 1080, h: 1350 },
  { id: "quadrado_feed", nome: "Quadrado (1:1)", w: 1080, h: 1080 },
  { id: "stories_produto", nome: "Stories / Reels (9:16)", w: 1080, h: 1920 },
  { id: "catalogo_whatsapp", nome: "Catálogo / WhatsApp", w: 1080, h: 1080 },
  { id: "vitrine_loja", nome: "Vitrine UP / marketplace", w: 1200, h: 1200 },
];

interface Ajustes {
  zoom: number;
  dx: number;
  dy: number;
  preco: boolean;

  nomeComercial: string;
  rotulo: string;
  chamada: string;
  selo: string;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Desenha a foto cobrindo a área (cover), com zoom e deslocamento para cortar a cartela do fornecedor. */
function desenharFoto(ctx: CanvasRenderingContext2D, foto: HTMLImageElement, x: number, y: number, w: number, h: number, a: Ajustes, modo: "cover" | "contain" = "cover") {
  const base = modo === "cover" ? Math.max(w / foto.width, h / foto.height) : Math.min(w / foto.width, h / foto.height);
  const s = base * a.zoom;
  const fw = foto.width * s;
  const fh = foto.height * s;
  const fx = x + (w - fw) / 2 + (a.dx / 100) * w;
  const fy = y + (h - fh) / 2 + (a.dy / 100) * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(foto, fx, fy, fw, fh);
  ctx.restore();
}

function texto(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, fonte: string, cor: string, opts: { alinhar?: CanvasTextAlign; max?: number; tracking?: number; sombra?: boolean } = {}) {
  if (!t) return;
  ctx.save();
  if (opts.sombra) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = cor;
  ctx.textAlign = opts.alinhar ?? "left";
  ctx.textBaseline = "alphabetic";
  let f = fonte;
  const m = fonte.match(/(\d+)px/);
  let px = m ? Number(m[1]) : 32;
  ctx.font = f;
  if (opts.tracking) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${opts.tracking}px`;
  while (opts.max && ctx.measureText(t).width > opts.max && px > 12) {
    px -= 2;
    f = fonte.replace(/\d+px/, `${px}px`);
    ctx.font = f;
  }
  ctx.fillText(t, x, y);
  ctx.restore();
}

/** Luminância média (0–1) de uma região já desenhada no canvas. */
function luminancia(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  try {
    const d = ctx.getImageData(x, y, w, h).data;
    let soma = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 16) {
      soma += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      n++;
    }
    return n ? soma / n : 0;
  } catch {
    return 0;
  }
}

const hexA = (hex: string, alfa: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
};

export default function EstudioPage() {
  const { id } = useParams<{ id: string }>();
  const avisar = useAviso();
  const { config } = useConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [p, setP] = useState<Produto | null>(null);
  const [imagens, setImagens] = useState<ImagemInfo[]>([]);
  const [fonteId, setFonteIdBruto] = useState<string | null>(null);
  const [fonteEscolhida, setFonteEscolhida] = useState(false);
  const setFonteId = setFonteIdBruto;
  const escolherFonte = (id: string) => {
    setFonteIdBruto(id);
    setFonteEscolhida(true);
  };
  const [tpl, setTpl] = useState<Tpl>("feed_produto");
  const [a, setA] = useState<Ajustes>({ zoom: 1, dx: 0, dy: 0, preco: true, nomeComercial: "", rotulo: "", chamada: "Chama no direct ♡", selo: "NOVIDADE" });
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [ia, setIa] = useState({ cenarioId: "", proporcao: "4:5", provedor: "", extra: "" });

  const carregar = useCallback(
    () =>
      api<{ produto: Produto; imagens: ImagemInfo[] }>(`/api/produtos/${id}`).then((r) => {
        setP(r.produto);
        setImagens(r.imagens);
        setFonteId((f) => f ?? fotoPadrao(r.imagens, r.produto.imagemId));
        setA((x) => ({
          ...x,
          nomeComercial: x.nomeComercial || r.produto.nomeComercial || "",
          rotulo: x.rotulo || (r.produto.subtipo ?? "").slice(0, 32),
        }));
      }),
    [id],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  const cores = config?.marca.cores ?? {};
  const fonteEhIa = !!imagens.find((i) => i.id === fonteId && i.origem === "ia");
  const desenhar = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !p || !config) return;
    const t = TEMPLATES.find((x) => x.id === tpl)!;
    canvas.width = t.w;
    canvas.height = t.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    await Promise.all(["68px Satisfy", "500 44px 'Cormorant Garamond'", "600 52px 'Cormorant Garamond'", "300 20px Jost", "400 18px Jost", "500 32px Jost"].map((f) => document.fonts.load(f)));
    // Layouts do marketing (marca.json → templates_arte e diretrizes_arte): foto com modelo sangrada,
    // degradê sutil para leitura, pouco texto, logo pequeno e aviso de IA.
    const fonteVitrine = tpl === "vitrine_loja" && !fonteEscolhida ? (p.imagemId ?? fonteId) : fonteId;
    const [foto, logoRose, logoBranco] = await Promise.all([
      fonteVitrine ? carregarImagem(img(fonteVitrine)!) : Promise.resolve(null),
      carregarImagem("/marca/logo-fiodeamor.png"),
      carregarImagem("/marca/logo-fiodeamor-branco.png"),
    ]);
    const C = { escuro: cores.primaria_escura ?? "#8E5B6F", creme: cores.creme ?? "#F6EFE6", dourado: cores.dourado ?? "#B8925A", texto: cores.texto ?? "#4A353D" };
    const preco = a.preco && p.precoVenda ? brl(p.precoVenda) : "";
    const aviso = fonteEhIa ? (config.marca.prompts_ia_foto?.aviso_publicacao?.split(".")[0] ?? "Imagem ilustrativa criada com IA") : "";

    ctx.fillStyle = tpl === "vitrine_loja" ? "#FFFFFF" : C.creme;
    ctx.fillRect(0, 0, t.w, t.h);
    if (tpl === "vitrine_loja") {
      if (foto) desenharFoto(ctx, foto, t.w * 0.08, t.h * 0.08, t.w * 0.84, t.h * 0.84, a, "contain");
      return;
    }
    if (foto) desenharFoto(ctx, foto, 0, 0, t.w, t.h, a);

    // Modo claro quando o fundo atrás do texto é muito claro (luminância média > 0,72).
    const yTexto = tpl === "stories_produto" ? 1280 : tpl === "feed_produto" || tpl === "feed_lancamento" ? 1080 : 900;
    const claro = luminancia(ctx, 0, yTexto, t.w, t.h - yTexto) > 0.72;
    const corTexto = claro ? C.escuro : "#FFFFFF";
    const corSec = claro ? hexA(C.texto, 0.85) : "rgba(255,255,255,0.85)";
    const corAviso = claro ? hexA(C.texto, 0.7) : "rgba(255,255,255,0.7)";
    const sombra = !claro;
    const logo = claro ? logoRose : logoBranco;
    const degrade = (y0: number, paradas: [number, number][]) => {
      const g = ctx.createLinearGradient(0, y0, 0, paradas.at(-1)![0]);
      const total = paradas.at(-1)![0] - y0;
      for (const [y, op] of paradas) g.addColorStop(Math.max(0, Math.min(1, (y - y0) / total)), claro ? `rgba(246,239,230,${Math.min(0.85, op * 1.4)})` : `rgba(74,53,61,${op})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, t.w, paradas.at(-1)![0] - y0);
    };
    const desenhaLogo = (largura: number, x: number, yBase: number) => {
      const h = (logo.height / logo.width) * largura;
      ctx.drawImage(logo, x, yBase - h, largura, h);
    };
    const fio = (x: number, y: number, w = 56) => {
      ctx.fillStyle = C.dourado;
      ctx.fillRect(x, y, w, 1.5);
    };
    const tx = (txt: string, x: number, y: number, fonte: string, cor: string, o: { alinhar?: CanvasTextAlign; max?: number; tracking?: number } = {}) =>
      texto(ctx, txt, x, y, fonte, cor, { ...o, sombra });

    if (tpl === "feed_produto" || tpl === "feed_lancamento") {
      degrade(820, [
        [820, 0],
        [1050, 0.25],
        [1350, 0.6],
      ]);
      const d = preco ? 0 : 60;
      tx(a.rotulo.toUpperCase(), 72, 1128 + d, "300 20px Jost", corSec, { max: 640, tracking: 3.6 });
      tx(a.nomeComercial, 72, 1212 + d, "68px Satisfy", corTexto, { max: 640 });
      fio(72, 1240 + d);
      if (preco) tx(preco, 72, 1296, "500 44px 'Cormorant Garamond'", corTexto);
      desenhaLogo(160, 1008 - 160, 1296);
      if (aviso) tx(aviso, 1008, 1326, "300 16px Jost", corAviso, { alinhar: "right" });
      if (tpl === "feed_lancamento" && a.selo) {
        const g = ctx.createLinearGradient(0, 0, 0, 260);
        g.addColorStop(0, "rgba(74,53,61,0.3)");
        g.addColorStop(1, "rgba(74,53,61,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, t.w, 260);
        texto(ctx, a.selo.toUpperCase(), 72, 110, "400 18px Jost", "#FFFFFF", { tracking: 5.4, sombra: true });
        fio(72, 128, 40);
      }
    } else if (tpl === "quadrado_feed") {
      degrade(620, [
        [620, 0],
        [820, 0.25],
        [1080, 0.6],
      ]);
      tx(a.nomeComercial, 64, preco ? 968 : 1010, "60px Satisfy", corTexto, { max: 620 });
      if (preco) tx(preco, 64, 1026, "500 40px 'Cormorant Garamond'", corTexto);
      desenhaLogo(160, 1016 - 160, 1022);
      if (aviso) tx(aviso, 1016, 1054, "300 15px Jost", corAviso, { alinhar: "right" });
    } else if (tpl === "stories_produto") {
      const gTopo = ctx.createLinearGradient(0, 0, 0, 420);
      gTopo.addColorStop(0, "rgba(74,53,61,0.28)");
      gTopo.addColorStop(1, "rgba(74,53,61,0)");
      ctx.fillStyle = gTopo;
      ctx.fillRect(0, 0, t.w, 420);
      degrade(1000, [
        [1000, 0],
        [1250, 0.3],
        [1920, 0.65],
      ]);
      const h = (logoBranco.height / logoBranco.width) * 160;
      ctx.drawImage(logoBranco, 540 - 80, 270, 160, h);
      if (aviso) texto(ctx, aviso, 540, 366, "300 16px Jost", "rgba(255,255,255,0.7)", { alinhar: "center", sombra: true });
      tx(a.rotulo.toUpperCase(), 540, 1330, "300 22px Jost", corSec, { alinhar: "center", max: 900, tracking: 4 });
      tx(a.nomeComercial, 540, 1420, "84px Satisfy", corTexto, { alinhar: "center", max: 900 });
      fio(540 - 28, 1450);
      if (preco) tx(preco, 540, 1510, "500 48px 'Cormorant Garamond'", corTexto, { alinhar: "center" });
      tx(a.chamada, 540, preco ? 1562 : 1520, "500 26px Jost", corTexto, { alinhar: "center", max: 900, tracking: 1 });
    } else if (tpl === "catalogo_whatsapp") {
      const gTopo = ctx.createLinearGradient(0, 0, 0, 200);
      gTopo.addColorStop(0, "rgba(74,53,61,0.22)");
      gTopo.addColorStop(1, "rgba(74,53,61,0)");
      ctx.fillStyle = gTopo;
      ctx.fillRect(0, 0, t.w, 200);
      degrade(640, [
        [640, 0],
        [840, 0.3],
        [1080, 0.65],
      ]);
      ctx.drawImage(logoBranco, 48, 44, 160, (logoBranco.height / logoBranco.width) * 160);
      if (aviso) texto(ctx, aviso, 1032, 72, "300 15px Jost", "rgba(255,255,255,0.7)", { alinhar: "right", sombra: true });
      tx(a.nomeComercial || (p.nome ?? ""), 48, 978, "500 32px Jost", corTexto, { max: preco ? 640 : 980 });
      tx(`REF ${p.referencia ?? ""}${a.rotulo ? ` · ${a.rotulo.toUpperCase()}` : ""}`, 48, 1020, "300 20px Jost", corSec, { max: preco ? 640 : 980, tracking: 2.4 });
      if (preco) tx(preco, 1032, 1010, "600 52px 'Cormorant Garamond'", corTexto, { alinhar: "right" });
    }
  }, [p, config, tpl, fonteId, fonteEscolhida, fonteEhIa, a, cores]);

  useEffect(() => {
    desenhar().catch(() => {});
  }, [desenhar]);

  async function salvar(baixar: boolean) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSalvando(true);
    try {
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), tpl === "vitrine_loja" ? "image/jpeg" : "image/png", 0.92));
      if (baixar) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${p?.referencia ?? "fiodeamor"}-${tpl}.${tpl === "vitrine_loja" ? "jpg" : "png"}`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const form = new FormData();
        form.set("arquivo", blob, `${tpl}.png`);
        form.set("meta", JSON.stringify({ template: tpl, fonte: fonteId }));
        await api(`/api/produtos/${id}/arte`, { method: "POST", body: form });
        avisar("Arte salva na galeria do produto.");
        carregar();
      }
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function gerarIa() {
    setGerando(true);
    try {
      const r = await api<{ imagemId: string; aprovada: boolean | null; avaliacao: Avaliacao | null; tentativas: unknown[]; provedor: string; modelo: string }>(`/api/produtos/${id}/ia`, {
        method: "POST",
        json: { imagemId: p?.imagemId ?? undefined, cenarioId: ia.cenarioId || undefined, proporcao: ia.proporcao, extra: ia.extra, provedor: ia.provedor || undefined },
      });
      if (r.aprovada === null) avisar(`Foto gerada (${r.modelo}). Sem avaliação do marketing: configure a chave do Claude.`, "info");
      else if (r.aprovada) avisar(`Foto aprovada pelo marketing — nota ${r.avaliacao?.nota.toFixed(1)} (${r.tentativas.length} tentativa(s)).`);
      else avisar(`O marketing não aprovou nenhuma das ${r.tentativas.length} tentativas (melhor nota ${r.avaliacao?.nota.toFixed(1)}). Veja os motivos e gere de novo.`, "erro");
      await carregar();
      setFonteId(r.imagemId);
      setA((x) => ({ ...x, zoom: 1, dx: 0, dy: 0 }));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setGerando(false);
    }
  }

  if (!p || !config) return <Carregando />;
  const cenarios = config.marca.prompts_ia_foto?.cenarios ?? [];
  const cenarioPadrao = (config.marca.prompts_ia_foto as { cenario_padrao?: string } | undefined)?.cenario_padrao ?? cenarios[0]?.id ?? "";
  const fotosIa = imagens.filter((i) => i.origem === "ia");
  const fonteEhCatalogo = !imagens.find((i) => i.id === fonteId && i.origem === "ia");
  const t = TEMPLATES.find((x) => x.id === tpl)!;
  const aj = (k: keyof Ajustes) => (e: React.ChangeEvent<HTMLInputElement>) => setA((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? Number(e.target.value) : e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/produtos/${id}`} className="text-xs text-[#9a8089]">
          ← {p.nome}
        </Link>
        <h1 className="text-4xl font-semibold">Estúdio de fotos</h1>
        <p className="text-sm text-[#8a6d78]">Artes com a identidade Fio de Amor (grátis, feitas no navegador) e fotos com modelo geradas por IA a partir da foto do catálogo.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <Cartao>
          <div className="mb-3 flex flex-wrap gap-1">
            {TEMPLATES.map((x) => (
              <button key={x.id} onClick={() => setTpl(x.id)} className={`rounded-full px-3 py-1 text-sm ${tpl === x.id ? "bg-rose-escuro text-white" : "bg-rose-claro text-rose-escuro"}`}>
                {x.nome}
              </button>
            ))}
          </div>
          {fonteEhCatalogo && tpl !== "vitrine_loja" && (
            <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Esta arte está usando a foto do fornecedor. Para o padrão Fio de Amor, gere a <b>foto com modelo</b> ao lado: ela vira a base da arte automaticamente.
            </div>
          )}
          <div className="flex justify-center rounded-xl bg-[#f3ece6] p-4">
            <canvas ref={canvasRef} className="h-auto max-h-[75vh] w-auto max-w-full rounded-lg shadow-lg" style={{ aspectRatio: `${t.w}/${t.h}` }} />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Botao variante="secundario" onClick={() => salvar(true)}>
              Baixar
            </Botao>
            <Botao onClick={() => salvar(false)} carregando={salvando}>
              Salvar na galeria
            </Botao>
          </div>
        </Cartao>

        <div className="flex flex-col gap-4">
          <Cartao titulo="Foto com IA (padrão)">
            <p className="mb-3 text-sm text-[#6b5560]">
              A IA cria a foto da peça real no expositor de veludo da loja (seguindo as fotos de referência de estilo) ou numa modelo. Em seguida, o{" "}
              <b>especialista de marketing</b> compara com a peça real e só aprova se ela estiver
              idêntica e a foto tiver padrão comercial. Se reprovar, gera de novo com os ajustes (até {config.sistema.fotoTentativas ?? 3} tentativas).
            </p>
            <div className="flex flex-col gap-3">
              <Campo rotulo="Cenário">
                <select value={ia.cenarioId || "auto"} onChange={(e) => setIa((x) => ({ ...x, cenarioId: e.target.value }))}>
                  <option value="auto">Automático: expositor do tipo da peça (padrão)</option>
                  {cenarios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.id === cenarioPadrao && cenarioPadrao !== "auto" && !/padr[ãa]o/i.test(c.nome) ? " (padrão)" : ""}
                    </option>
                  ))}
                </select>
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Formato">
                  <select value={ia.proporcao} onChange={(e) => setIa((x) => ({ ...x, proporcao: e.target.value }))}>
                    <option value="4:5">Feed 4:5</option>
                    <option value="9:16">Stories 9:16</option>
                    <option value="1:1">Quadrado 1:1</option>
                  </select>
                </Campo>
                <Campo rotulo="Serviço">
                  <select value={ia.provedor} onChange={(e) => setIa((x) => ({ ...x, provedor: e.target.value }))}>
                    <option value="">Padrão ({config.sistema.imagemProvedor})</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </Campo>
              </div>
              <Campo rotulo="Pedido extra (opcional)">
                <input placeholder="ex.: modelo de cabelo cacheado, luz de fim de tarde" value={ia.extra} onChange={(e) => setIa((x) => ({ ...x, extra: e.target.value }))} />
              </Campo>
              <Botao onClick={gerarIa} carregando={gerando}>
                ✦ Criar foto com IA
              </Botao>
              {gerando && <p className="text-xs text-[#9a8089]">Gerando e avaliando… pode levar até 2 minutos.</p>}
            </div>
            {fotosIa.length > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t border-borda pt-3">
                {fotosIa.map((im) => {
                  const av = im.meta?.avaliacao;
                  return (
                    <div key={im.id} className={`flex gap-3 rounded-xl border p-2 ${fonteId === im.id ? "border-rose-escuro bg-rose-claro/40" : "border-borda"}`}>
                      <button onClick={() => setFonteId(im.id)} className="shrink-0" title="Usar na arte">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img(im.id, 200)!} alt="" className="h-24 w-20 rounded-lg object-cover" />
                      </button>
                      <div className="min-w-0 flex-1 text-xs">
                        {im.meta?.aprovada ? (
                          <Selo cor="verde">✓ Aprovada pelo marketing · nota {av?.nota?.toFixed(1)}</Selo>
                        ) : im.meta?.aprovada === false ? (
                          <Selo cor="vermelho">✗ Reprovada · nota {av?.nota?.toFixed(1)}</Selo>
                        ) : (
                          <Selo cor="cinza">sem avaliação</Selo>
                        )}
                        {(av?.eliminatorios ?? []).length > 0 && <p className="mt-1 text-red-700">Eliminatório: {av!.eliminatorios.join("; ")}</p>}
                        {(av?.problemas ?? []).length > 0 && <p className="mt-1 text-[#6b5560]">Ajustar: {av!.problemas.slice(0, 3).join("; ")}</p>}
                        {(av?.pontos_fortes ?? []).length > 0 && <p className="mt-1 text-emerald-800">Pontos fortes: {av!.pontos_fortes.slice(0, 2).join("; ")}</p>}
                        <div className="mt-1 flex flex-wrap gap-2">
                          <button className="text-rose-escuro underline" onClick={() => setFonteId(im.id)}>
                            usar na arte
                          </button>
                          {im.meta?.aprovada && p.imagemId !== im.id && (
                            <button
                              className="text-rose-escuro underline"
                              onClick={() => api(`/api/produtos/${id}`, { method: "PATCH", json: { imagemId: im.id } }).then(() => { avisar("Agora é a foto principal do produto."); carregar(); })}
                            >
                              usar como foto principal
                            </button>
                          )}
                          <a className="text-rose-escuro underline" href={`/api/imagens/${im.id}?download=1`}>
                            baixar
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-[#9a8089]">
              <Selo cor="amarelo">transparência</Selo> {config.marca.prompts_ia_foto?.aviso_publicacao ?? "Imagem ilustrativa criada com IA."}
            </p>
          </Cartao>

          <Cartao titulo="Foto da arte">
            <div className="grid grid-cols-4 gap-2">
              {imagens.map((im) => (
                <button key={im.id} onClick={() => escolherFonte(im.id)} className={`overflow-hidden rounded-lg border-2 ${fonteId === im.id ? "border-rose-escuro" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img(im.id, 160)!} alt="" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Campo rotulo={`Zoom ${a.zoom.toFixed(1)}×`}>
                <input type="range" min={0.5} max={3} step={0.05} value={a.zoom} onChange={aj("zoom")} />
              </Campo>
              <Campo rotulo="Mover ↔">
                <input type="range" min={-60} max={60} value={a.dx} onChange={aj("dx")} />
              </Campo>
              <Campo rotulo="Mover ↕">
                <input type="range" min={-60} max={60} value={a.dy} onChange={aj("dy")} />
              </Campo>
            </div>
            <p className="mt-1 text-xs text-[#9a8089]">Dica: aumente o zoom e mova a foto para esconder a cartela, etiqueta e QR code do fornecedor.</p>
          </Cartao>

          <Cartao titulo="Textos da arte">
            <div className="flex flex-col gap-3">
              <Campo rotulo="Nome comercial (letra cursiva)">
                <input value={a.nomeComercial} onChange={aj("nomeComercial")} />
              </Campo>
              <Campo rotulo="Rótulo curto (coleção, ocasião ou detalhe — até 32 letras)">
                <input value={a.rotulo} maxLength={32} onChange={aj("rotulo")} />
              </Campo>
              {tpl === "stories_produto" && (
                <Campo rotulo="Chamada">
                  <input value={a.chamada} onChange={aj("chamada")} />
                </Campo>
              )}
              {tpl === "feed_lancamento" && (
                <Campo rotulo="Selo">
                  <input value={a.selo} onChange={aj("selo")} />
                </Campo>
              )}
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={a.preco} onChange={aj("preco")} /> Mostrar preço ({brl(p.precoVenda)})
                </label>

              </div>
            </div>
          </Cartao>


        </div>
      </div>
    </div>
  );
}
