"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Produto } from "@/lib/db/schema";
import { Botao, Campo, Carregando, Cartao, Selo, useAviso } from "@/components/ui";
import { useConfig } from "@/components/hooks";
import { api, brl, img } from "@/lib/cliente";

type ImagemInfo = { id: string; origem: string; meta: Record<string, unknown> | null };
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
  fita: boolean;
  nomeComercial: string;
  descricao: string;
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

function texto(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, fonte: string, cor: string, opts: { alinhar?: CanvasTextAlign; max?: number; tracking?: number } = {}) {
  ctx.save();
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

function fita(ctx: CanvasRenderingContext2D, w: number, h: number, cor: string) {
  ctx.save();
  ctx.strokeStyle = cor;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-20, h * 0.18);
  ctx.bezierCurveTo(w * 0.3, h * 0.05, w * 0.45, h * 0.42, w * 0.7, h * 0.3);
  ctx.bezierCurveTo(w * 0.85, h * 0.22, w * 0.95, h * 0.35, w + 20, h * 0.28);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.restore();
}

export default function EstudioPage() {
  const { id } = useParams<{ id: string }>();
  const avisar = useAviso();
  const { config } = useConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [p, setP] = useState<Produto | null>(null);
  const [imagens, setImagens] = useState<ImagemInfo[]>([]);
  const [fonteId, setFonteId] = useState<string | null>(null);
  const [tpl, setTpl] = useState<Tpl>("feed_produto");
  const [a, setA] = useState<Ajustes>({ zoom: 1, dx: 0, dy: 0, preco: true, fita: true, nomeComercial: "", descricao: "", chamada: "Chama no direct ♡", selo: "NOVIDADE" });
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [ia, setIa] = useState({ cenarioId: "veludo_rose", proporcao: "4:5", provedor: "", extra: "" });

  const carregar = useCallback(
    () =>
      api<{ produto: Produto; imagens: ImagemInfo[] }>(`/api/produtos/${id}`).then((r) => {
        setP(r.produto);
        setImagens(r.imagens);
        setFonteId((f) => f ?? r.produto.imagemId ?? r.imagens[0]?.id ?? null);
        setA((x) => ({
          ...x,
          nomeComercial: x.nomeComercial || r.produto.nomeComercial || "",
          descricao: x.descricao || (r.produto.traducao ?? "").toUpperCase().slice(0, 48),
        }));
      }),
    [id],
  );
  useEffect(() => {
    carregar().catch((e) => avisar(e.message, "erro"));
  }, [carregar, avisar]);

  const cores = config?.marca.cores ?? {};
  const desenhar = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !p || !config) return;
    const t = TEMPLATES.find((x) => x.id === tpl)!;
    canvas.width = t.w;
    canvas.height = t.h;
    const ctx = canvas.getContext("2d")!;
    await Promise.all(["64px Satisfy", "600 40px 'Cormorant Garamond'", "300 20px Jost", "500 20px Jost"].map((f) => document.fonts.load(f)));
    const [foto, logo] = await Promise.all([fonteId ? carregarImagem(img(fonteId)!) : Promise.resolve(null), carregarImagem("/marca/logo-fiodeamor.png")]);
    const C = { rose: cores.primaria ?? "#CEA6B6", escuro: cores.primaria_escura ?? "#8E5B6F", claro: cores.primaria_clara ?? "#F4E7EC", creme: cores.creme ?? "#F6EFE6", dourado: cores.dourado ?? "#B8925A", texto: cores.texto ?? "#4A353D" };
    const preco = a.preco && p.precoVenda ? brl(p.precoVenda) : "";
    const desenhaLogo = (largura: number, x: number, y: number) => ctx.drawImage(logo, x, y, largura, (logo.height / logo.width) * largura);
    ctx.fillStyle = C.creme;
    ctx.fillRect(0, 0, t.w, t.h);

    if (tpl === "feed_produto" || tpl === "feed_lancamento") {
      if (foto) desenharFoto(ctx, foto, 0, 0, 1080, 1150, a);
      if (a.fita) fita(ctx, 1080, 1150, C.rose);
      ctx.fillStyle = C.claro;
      ctx.fillRect(0, 1150, 1080, 200);
      ctx.fillStyle = C.dourado;
      ctx.fillRect(0, 1149, 1080, 2);
      texto(ctx, a.nomeComercial, 72, 1245, "64px Satisfy", C.escuro, { max: 640 });
      texto(ctx, a.descricao, 74, 1298, "300 22px Jost", C.texto, { max: 640, tracking: 4 });
      if (preco) texto(ctx, preco, 1008, 1238, "600 60px 'Cormorant Garamond'", C.escuro, { alinhar: "right" });
      desenhaLogo(170, 1008 - 170, preco ? 1262 : 1220);
      if (tpl === "feed_lancamento" && a.selo) {
        ctx.save();
        ctx.fillStyle = C.rose;
        ctx.beginPath();
        ctx.arc(56 + 85, 56 + 85, 85, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.dourado;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(141, 141, 78, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        texto(ctx, a.selo.toUpperCase(), 141, 148, "500 20px Jost", "#fff", { alinhar: "center", max: 140, tracking: 3 });
      }
    } else if (tpl === "quadrado_feed") {
      if (foto) desenharFoto(ctx, foto, 0, 0, 1080, 1080, a);
      if (a.fita) fita(ctx, 1080, 1080, C.rose);
      const g = ctx.createLinearGradient(0, 760, 0, 1080);
      g.addColorStop(0, "rgba(246,239,230,0)");
      g.addColorStop(1, "rgba(246,239,230,0.92)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 760, 1080, 320);
      ctx.strokeStyle = C.dourado;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(32, 32, 1016, 1016);
      desenhaLogo(180, 450, 48);
      texto(ctx, a.nomeComercial, 540, preco ? 960 : 990, "60px Satisfy", C.escuro, { alinhar: "center", max: 900 });
      if (preco) texto(ctx, preco, 540, 1018, "600 44px 'Cormorant Garamond'", C.escuro, { alinhar: "center" });
    } else if (tpl === "stories_produto") {
      desenhaLogo(220, 430, 270);
      if (foto) desenharFoto(ctx, foto, 0, 370, 1080, 980, a);
      if (a.fita) {
        ctx.save();
        ctx.translate(0, 370);
        fita(ctx, 1080, 980, C.rose);
        ctx.restore();
      }
      texto(ctx, a.nomeComercial, 540, 1450, "76px Satisfy", C.escuro, { alinhar: "center", max: 960 });
      texto(ctx, a.descricao, 540, 1500, "300 24px Jost", C.texto, { alinhar: "center", max: 960, tracking: 4 });
      if (preco) texto(ctx, preco, 540, 1565, "600 56px 'Cormorant Garamond'", C.escuro, { alinhar: "center" });
      ctx.fillStyle = C.escuro;
      ctx.beginPath();
      ctx.roundRect(340, 1600, 400, 70, 35);
      ctx.fill();
      texto(ctx, a.chamada, 540, 1645, "500 26px Jost", "#fff", { alinhar: "center", max: 370 });
    } else if (tpl === "catalogo_whatsapp") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1080, 1080);
      if (foto) desenharFoto(ctx, foto, 151, 120, 778, 760, a, "contain");
      desenhaLogo(150, 48, 40);
      ctx.fillStyle = C.claro;
      ctx.fillRect(0, 940, 1080, 140);
      texto(ctx, a.nomeComercial || (p.nome ?? ""), 48, 1000, "500 30px Jost", C.texto, { max: 640 });
      texto(ctx, `REF ${p.referencia ?? ""}`, 48, 1042, "300 20px Jost", C.texto, { tracking: 3 });
      if (preco) texto(ctx, preco, 1032, 1028, "600 46px 'Cormorant Garamond'", C.escuro, { alinhar: "right" });
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, t.w, t.h);
      if (foto) desenharFoto(ctx, foto, 90, 90, t.w - 180, t.h - 180, a, "contain");
    }
  }, [p, config, tpl, fonteId, a, cores]);

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
      const r = await api<{ imagemId: string; provedor: string; modelo: string }>(`/api/produtos/${id}/ia`, {
        method: "POST",
        json: { imagemId: p?.imagemId ?? fonteId, cenarioId: ia.cenarioId, proporcao: ia.proporcao, extra: ia.extra, provedor: ia.provedor || undefined },
      });
      avisar(`Foto gerada (${r.provedor} · ${r.modelo}). Confira se a peça ficou fiel antes de publicar.`);
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
          <Cartao titulo="Foto de origem">
            <div className="grid grid-cols-4 gap-2">
              {imagens.map((im) => (
                <button key={im.id} onClick={() => setFonteId(im.id)} className={`overflow-hidden rounded-lg border-2 ${fonteId === im.id ? "border-rose-escuro" : "border-transparent"}`}>
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
              <Campo rotulo="Descrição curta (maiúsculas)">
                <input value={a.descricao} onChange={aj("descricao")} />
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
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={a.fita} onChange={aj("fita")} /> Fita de cetim
                </label>
              </div>
            </div>
          </Cartao>

          <Cartao titulo="Foto com IA">
            <div className="flex flex-col gap-3">
              <Campo rotulo="Cenário">
                <select value={ia.cenarioId} onChange={(e) => setIa((x) => ({ ...x, cenarioId: e.target.value }))}>
                  {cenarios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
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
                <input placeholder="ex.: modelo de cabelo cacheado, fundo com flores do campo" value={ia.extra} onChange={(e) => setIa((x) => ({ ...x, extra: e.target.value }))} />
              </Campo>
              <Botao onClick={gerarIa} carregando={gerando}>
                ✦ Gerar foto com modelo
              </Botao>
              <p className="text-xs text-[#9a8089]">
                <Selo cor="amarelo">transparência</Selo> {config.marca.prompts_ia_foto?.aviso_publicacao ?? "Imagem ilustrativa criada com IA."} Sempre compare com a peça real antes de publicar.
              </p>
            </div>
          </Cartao>
        </div>
      </div>
    </div>
  );
}
