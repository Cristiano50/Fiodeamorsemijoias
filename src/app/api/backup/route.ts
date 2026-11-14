import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { EXPLICACAO_TURSO, MANTER_BACKUPS, bancoLocal, caminhoDoBackup, fazerBackup, listarBackups, pastaBackups } from "@/lib/backup";

/** Envia o arquivo em partes (o banco pode ter centenas de MB por causa das fotos). */
async function enviarArquivo(caminho: string, nome: string) {
  const st = await fs.stat(caminho);
  const corpo = Readable.toWeb(createReadStream(caminho)) as unknown as ReadableStream<Uint8Array>;
  return new Response(corpo, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Length": String(st.size),
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/backup              → gera um backup novo e baixa o arquivo (só a gestora)
 * GET /api/backup?lista=1      → lista os backups (nome, tamanho, data)
 * GET /api/backup?arquivo=NOME → baixa um backup da lista
 * Com Turso (nuvem), responde com a explicação de como restaurar por lá.
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const p = req.nextUrl.searchParams;
    if (!bancoLocal()) return ok({ local: false, explicacao: EXPLICACAO_TURSO, backups: [] });

    if (p.get("lista")) {
      const pasta = path.relative(process.cwd(), pastaBackups()) || pastaBackups();
      return ok({ local: true, pasta: pasta.split(path.sep).join("/"), manter: MANTER_BACKUPS, backups: await listarBackups() });
    }

    const arquivo = p.get("arquivo");
    if (arquivo !== null) {
      const caminho = caminhoDoBackup(arquivo);
      if (!caminho) return erro("Nome de backup inválido.", 400);
      const existe = await fs.stat(caminho).then(
        (s) => s.isFile(),
        () => false,
      );
      if (!existe) return erro("Backup não encontrado (pode ter sido apagado pela rotação dos 14 mais recentes).", 404);
      await registrar(req, { acao: "backup.baixar", entidade: "backup", entidadeId: arquivo, resumo: `Backup ${arquivo} baixado` });
      return enviarArquivo(caminho, arquivo);
    }

    const novo = await fazerBackup();
    await registrar(req, {
      acao: "backup.criar",
      entidade: "backup",
      entidadeId: novo.nome,
      resumo: `Backup ${novo.nome} gerado e baixado`,
      dados: { tamanho: novo.tamanho },
    });
    return enviarArquivo(novo.caminho, novo.nome);
  } catch (e) {
    return erro(e);
  }
}
