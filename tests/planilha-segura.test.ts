import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PlanilhaInvalida, verificarLinhas, verificarXlsx } from "../src/lib/planilha-segura";

async function xlsxPequena() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vendas");
  ws.addRow(["Código", "Qtd"]);
  for (let i = 0; i < 50; i++) ws.addRow([`7890000000${String(i).padStart(3, "0")}`, i]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

test("planilha normal passa", async () => {
  verificarXlsx(await xlsxPequena());
});

test("zip-bomb: conteúdo descompactado acima do limite é recusado mesmo com tamanho declarado pequeno", async () => {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", "0".repeat(3 * 1024 * 1024));
  const dados = new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  assert.ok(dados.length < 100_000, "o arquivo compactado é pequeno");
  assert.throws(() => verificarXlsx(dados, { maxDescompactado: 1024 * 1024 }), PlanilhaInvalida);
  // Mentindo no diretório central (tamanho descompactado = 10 bytes): a medição real ainda pega.
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  for (let i = dados.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      const dir = v.getUint32(i + 16, true);
      v.setUint32(dir + 24, 10, true);
      break;
    }
  }
  assert.throws(() => verificarXlsx(dados, { maxDescompactado: 1024 * 1024 }), PlanilhaInvalida);
});

test("arquivo que não é xlsx, grande demais ou com linhas demais", async () => {
  assert.throws(() => verificarXlsx(new TextEncoder().encode("codigo;qtd\n1;2")), /não é uma planilha/);
  const pequena = await xlsxPequena();
  assert.throws(() => verificarXlsx(pequena, { maxBytes: 100 }), /grande demais/);
  assert.throws(() => verificarLinhas(60_000), /linhas demais/);
  verificarLinhas(10);
});
