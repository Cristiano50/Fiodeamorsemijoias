import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import {
  EXPLICACAO_TURSO,
  EspacoInsuficiente,
  MANTER,
  MANTER_BACKUPS,
  MANTER_COPIAS_EXTERNAS,
  bancoLocal,
  caminhoDoBackup,
  fazerBackup,
  lerCopiaExterna,
  lerEstadoDiario,
  listarBackups,
  pastaBackups,
  testarPastaExterna,
} from "@/lib/backup";

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
 * GET /api/backup              → gera um backup manual novo e baixa o arquivo (só a gestora)
 * GET /api/backup?lista=1      → lista os backups (nome, tipo, tamanho, data), a situação do automático e da cópia externa
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
      const [backups, diario, copiaExterna] = await Promise.all([listarBackups(), lerEstadoDiario(), lerCopiaExterna()]);
      return ok({
        local: true,
        pasta: pasta.split(path.sep).join("/"),
        manter: MANTER_BACKUPS,
        manterPorTipo: MANTER,
        manterCopiasExternas: MANTER_COPIAS_EXTERNAS,
        backups,
        diario,
        copiaExterna,
      });
    }

    const arquivo = p.get("arquivo");
    if (arquivo !== null) {
      const caminho = caminhoDoBackup(arquivo);
      if (!caminho) return erro("Nome de backup inválido.", 400);
      const existe = await fs.stat(caminho).then(
        (s) => s.isFile(),
        () => false,
      );
      if (!existe) return erro("Backup não encontrado (pode ter sido apagado pela rotação, que guarda só os mais recentes de cada tipo).", 404);
      await registrar(req, { acao: "backup.baixar", entidade: "backup", entidadeId: arquivo, resumo: `Backup ${arquivo} baixado` });
      return enviarArquivo(caminho, arquivo);
    }

    const novo = await fazerBackup("manual");
    await registrar(req, {
      acao: "backup.criar",
      entidade: "backup",
      entidadeId: novo.nome,
      resumo: `Backup ${novo.nome} gerado e baixado`,
      dados: { tamanho: novo.tamanho },
    });
    return enviarArquivo(novo.caminho, novo.nome);
  } catch (e) {
    return erro(e, e instanceof EspacoInsuficiente ? 507 : 500);
  }
}

const Corpo = z.object({ acao: z.literal("testar-pasta"), pasta: z.string().max(400) });

/**
 * POST /api/backup { acao: "testar-pasta", pasta } → grava, lê e apaga um arquivo de teste na pasta externa
 * (pen drive ou pasta sincronizada) e responde { ok, mensagem }. Não salva a configuração.
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const corpo = Corpo.safeParse(await req.json().catch(() => null));
    if (!corpo.success) return erro("Pedido inválido: envie { acao: \"testar-pasta\", pasta }.", 400);
    if (!bancoLocal()) return ok({ ok: false, mensagem: "Com o banco na nuvem (Turso) não há cópia para pasta externa: o Turso guarda o histórico." });
    const r = await testarPastaExterna(corpo.data.pasta);
    await registrar(req, {
      acao: "backup.testar-pasta",
      entidade: "backup",
      entidadeId: null,
      resumo: `Teste da pasta externa do backup (${r.pasta || "vazia"}): ${r.ok ? "gravou" : "falhou"}`,
      dados: { pasta: r.pasta, ok: r.ok, ...(r.ok ? {} : { mensagem: r.mensagem }) },
    });
    return ok({ ok: r.ok, mensagem: r.mensagem, pasta: r.pasta, livre: r.livre ?? null });
  } catch (e) {
    return erro(e);
  }
}
