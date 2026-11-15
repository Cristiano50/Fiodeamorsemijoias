/**
 * Markdown → HTML seguro para os pareceres da IA e dos especialistas (componente Markdown).
 *  - Todo HTML cru do texto aparece como texto (<script>, <img onerror>, <iframe>, <svg onload>…).
 *  - Links só http, https e mailto; o resto vira texto.
 *  - Imagens só do próprio app (caminho relativo) ou data:image/…; o resto vira o texto alternativo.
 * Função pura, sem "server-only" (roda no navegador). Testes: tests/seguranca-markdown.test.ts.
 */
import { Marked } from "marked";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escaparHtml = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Esquema do endereço como o navegador o leria (ele ignora espaços e caracteres de controle). */
function esquema(endereco: string): string | null {
  const limpo = endereco.replace(/[\u0000- \u007f-\u009f]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(limpo);
  return m ? m[1].toLowerCase() : null;
}

const codificar = (endereco: string): string | null => {
  try {
    return encodeURI(endereco).replace(/%25/g, "%");
  } catch {
    return null; // texto com caractere inválido
  }
};

/** Endereço do link, se for http, https ou mailto; senão null. */
export function linkPermitido(href: string | null | undefined): string | null {
  const h = (href ?? "").trim();
  const e = esquema(h);
  return e === "http" || e === "https" || e === "mailto" ? codificar(h) : null;
}

/** Endereço da imagem, se for do próprio app (caminho relativo) ou data:image/…; senão null. */
export function imagemPermitida(href: string | null | undefined): string | null {
  const h = (href ?? "").trim();
  const e = esquema(h);
  if (e === "data") return /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(h) ? h : null;
  if (e !== null) return null; // http(s) de outro site, javascript:, etc.
  const limpo = h.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!limpo || /^[/\\]{2}|^\\|^\/\\/.test(limpo)) return null; // //site, \\site, /\site: outro endereço
  return codificar(h);
}

const md = new Marked({ gfm: true, async: false });
md.use({
  renderer: {
    html({ text, block }) {
      return block ? `<p>${escaparHtml(text)}</p>` : escaparHtml(text);
    },
    link({ href, title, text, tokens }) {
      const conteudo = tokens ? this.parser.parseInline(tokens) : escaparHtml(text);
      const url = linkPermitido(href);
      if (!url) return conteudo;
      const t = title ? ` title="${escaparHtml(title)}"` : "";
      return `<a href="${escaparHtml(url)}"${t} target="_blank" rel="noopener noreferrer nofollow">${conteudo}</a>`;
    },
    image({ href, title, text, tokens }) {
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      const url = imagemPermitida(href);
      if (!url) return escaparHtml(alt);
      const t = title ? ` title="${escaparHtml(title)}"` : "";
      return `<img src="${escaparHtml(url)}" alt="${escaparHtml(alt)}"${t} loading="lazy" decoding="async">`;
    },
  },
});

export function markdownSeguro(texto: string | null | undefined): string {
  return md.parse(String(texto ?? ""), { async: false }) as string;
}
