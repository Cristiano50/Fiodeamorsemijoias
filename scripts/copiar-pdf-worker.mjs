// Copia o "worker" do pdf.js para /public, para o navegador ler PDFs sem depender de CDN.
import fs from "node:fs";
import path from "node:path";
const origem = path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const destino = path.resolve("public/pdf.worker.min.mjs");
if (fs.existsSync(origem)) {
  fs.copyFileSync(origem, destino);
  console.log("pdf.worker.min.mjs copiado para public/");
}
