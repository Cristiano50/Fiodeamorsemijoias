import { test } from "node:test";
import assert from "node:assert/strict";
import { imagemPermitida, linkPermitido, markdownSeguro } from "../src/lib/markdown-seguro";

/** Nenhuma tag perigosa nem atributo de evento sobrou como HTML de verdade. */
function semHtmlPerigoso(html: string) {
  assert.doesNotMatch(html, /<(script|iframe|svg|object|embed|style|form|input|link|meta|base)\b/i, html);
  // Atributos de verdade = o que sobra nas tags tirando os valores entre aspas (já escapados).
  const tags = (html.match(/<[a-z][^>]*>/gi) ?? []).map((t) => t.replace(/"[^"]*"/g, '""'));
  for (const t of tags) assert.doesNotMatch(t, /\son[a-z]+\s*=/i, t);
  assert.doesNotMatch(html, /(href|src)\s*=\s*"\s*(javascript|vbscript|data:text)/i, html);
}

test("HTML cru aparece como texto (img onerror, iframe, svg onload, script)", () => {
  const casos = [
    "<img src=x onerror=alert(1)>",
    "texto <IMG SRC=x OnError=alert(1)> no meio",
    "<iframe src=//site-de-fora.com></iframe>",
    "<svg onload=alert(1)>",
    "<SCRIPT>alert(1)</SCRIPT>",
    "<a href=\"javascript:alert(1)\">clique</a>",
    "<div style=\"background:url(javascript:alert(1))\">x</div>",
    "<details open ontoggle=alert(1)>",
    "<scr<script>ipt>alert(1)</script>",
  ];
  for (const c of casos) {
    const html = markdownSeguro(c);
    semHtmlPerigoso(html);
    assert.match(html, /&lt;/, `o HTML vira texto: ${c}`);
  }
});

test("links só http, https e mailto; o resto vira texto", () => {
  const ruins = [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](&#x6A;avascript:alert(1))",
    "[x](javascript&colon;alert(1))",
    "[x](vbscript:msgbox(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "<javascript:alert(1)>",
    "[x][r]\n\n[r]: javascript:alert(1)",
    "[x](/pedidos/123)",
  ];
  for (const c of ruins) {
    const html = markdownSeguro(c);
    semHtmlPerigoso(html);
    assert.doesNotMatch(html, /<a\s/i, c);
  }
  const bom = markdownSeguro('[WhatsApp](https://wa.me/5511999999999?text=a&b=1 "Fale \\"já\\"")');
  assert.match(bom, /<a href="https:\/\/wa\.me\/5511999999999\?text=a&amp;b=1" title="Fale &quot;já&quot;" target="_blank" rel="noopener noreferrer nofollow">WhatsApp<\/a>/);
  assert.match(markdownSeguro("<https://exemplo.com.br>"), /<a href="https:\/\/exemplo\.com\.br"/);
  assert.match(markdownSeguro("contato@loja.com.br"), /<a href="mailto:contato@loja\.com\.br"/);
  assert.match(markdownSeguro("[s](HTTP://EXEMPLO.COM)"), /<a href="HTTP:\/\/EXEMPLO\.COM"/);
});

test("imagens só do próprio app ou data:image", () => {
  assert.match(markdownSeguro("![peça](/api/imagens/abc)"), /<img src="\/api\/imagens\/abc" alt="peça" loading="lazy" decoding="async">/);
  assert.match(markdownSeguro("![p](data:image/png;base64,iVBORw0KGgo=)"), /<img src="data:image\/png;base64/);
  for (const c of ["![p](https://site-de-fora.com/x.png)", "![p](//site-de-fora.com/x.png)", "![p](/\\site-de-fora.com/x.png)", "![p](javascript:alert(1))", "![p](data:text/html,oi)"]) {
    const html = markdownSeguro(c);
    assert.doesNotMatch(html, /<img/i, c);
    assert.match(html, /p/, "fica o texto alternativo");
  }
  // Texto alternativo com aspas não fecha o atributo.
  const alt = markdownSeguro('![a" onerror="alert(1)](/api/imagens/x)');
  semHtmlPerigoso(alt);
  assert.match(alt, /alt="a&quot; onerror=&quot;alert\(1\)"/);
});

test("entidades e o markdown normal continuam", () => {
  const html = markdownSeguro("## Parecer\n\n**Margem** boa e `<código>` &lt;script&gt;\n\n| Peça | Preço |\n|---|---|\n| Brinco | R$ 59,90 |\n\n- item");
  assert.match(html, /<h2>Parecer<\/h2>/);
  assert.match(html, /<strong>Margem<\/strong>/);
  assert.match(html, /<code>&lt;código&gt;<\/code>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<table>/);
  assert.match(html, /<li>item<\/li>/);
  assert.equal(markdownSeguro(""), "");
  assert.equal(markdownSeguro(null), "");
});

test("funções de endereço", () => {
  assert.equal(linkPermitido(" https://a.com "), "https://a.com");
  assert.equal(linkPermitido("java\tscript:alert(1)"), null);
  assert.equal(linkPermitido("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(linkPermitido("ftp://a.com"), null);
  assert.equal(linkPermitido(""), null);
  assert.equal(imagemPermitida("/api/imagens/1?w=300"), "/api/imagens/1?w=300");
  assert.equal(imagemPermitida("\\\\servidor\\foto.png"), null);
  assert.equal(imagemPermitida("data:image/svg+xml,<svg/>"), "data:image/svg+xml,<svg/>");
  assert.equal(imagemPermitida("http://192.168.0.10:3000/api/imagens/1"), null);
});
