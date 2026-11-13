// Converte as migrações SQL geradas pelo drizzle-kit (pasta drizzle/) em um módulo TS,
// para que o app aplique o schema sozinho na inicialização (funciona local e na nuvem).
import fs from "node:fs";
import path from "node:path";

const pasta = path.resolve("drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(pasta, "meta/_journal.json"), "utf8"));
const migracoes = journal.entries.map((e) => ({
  tag: e.tag,
  sql: fs.readFileSync(path.join(pasta, `${e.tag}.sql`), "utf8"),
}));
const saida = `// ARQUIVO GERADO por scripts/gerar-migracoes.mjs — não edite à mão.\nexport const MIGRACOES: { tag: string; sql: string }[] = ${JSON.stringify(migracoes, null, 2)};\n`;
fs.writeFileSync(path.resolve("src/lib/db/migracoes.ts"), saida);
console.log(`${migracoes.length} migração(ões) gravada(s) em src/lib/db/migracoes.ts`);
