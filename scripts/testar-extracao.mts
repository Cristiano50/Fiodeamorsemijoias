// Testa a leitura do PDF (sem navegador): posição das imagens + texto de cada linha.
// Uso: npx tsx scripts/testar-extracao.ts amostras/pedido-X260926017/pedido.pdf
import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { _interno } from "../src/lib/pdf-cliente";
import { lerLinha } from "../src/lib/extracao";

const arquivo = process.argv[2];
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(arquivo)) }).promise;
const OPS = pdfjs.OPS as unknown as Record<string, number>;
let linhas = 0, pecas = 0, total = 0, semNumero = 0;
let textoCompleto = "";
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caixas = await _interno.caixasDeImagens(page as any, OPS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trechos = await _interno.trechosDeTexto(page as any);
  textoCompleto += _interno.montarLinhas(trechos).join("\n") + "\n";
  for (const c of caixas) {
    const texto = _interno.textoDaFaixa(trechos, c);
    if (!texto) continue;
    linhas++;
    const l = lerLinha(texto);
    if (l.preco == null) semNumero++;
    pecas += l.quantidade ?? 0;
    total += (l.preco ?? 0) * (l.quantidade ?? 0);
    if (linhas <= 3 || [37, 69].includes(linhas) || l.preco == null) console.log(`p${n} #${linhas}: ${texto}\n   →`, JSON.stringify(l));
  }
}
console.log({ linhas, pecas, total: Math.round(total * 100) / 100, semNumero, totalDocumento: _interno.lerTotal(textoCompleto) });
