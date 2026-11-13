import fs from "node:fs/promises";
import path from "node:path";
import { erro, ok } from "@/lib/api";

const DOCS = [
  { id: "gestor-estoque", titulo: "Gestor de estoque" },
  { id: "contador", titulo: "Contador" },
  { id: "administrador", titulo: "Administrador de empresas" },
  { id: "marketing", titulo: "Especialista em marketing" },
  { id: "benchmark-sistemas", titulo: "Sistemas semelhantes (pesquisa)" },
];

/** Pareceres escritos pelos especialistas (docs/especialistas/*.md). */
export async function GET() {
  try {
    const pasta = path.join(process.cwd(), "docs", "especialistas");
    const docs = await Promise.all(
      DOCS.map(async (d) => ({ ...d, texto: await fs.readFile(path.join(pasta, `${d.id}.md`), "utf8").catch(() => "_(documento não encontrado)_") })),
    );
    return ok(docs);
  } catch (e) {
    return erro(e);
  }
}
