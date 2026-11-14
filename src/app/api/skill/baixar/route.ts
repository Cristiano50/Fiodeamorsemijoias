import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { erro } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { registrar } from "@/lib/historico";
import { garantirChaveSkill } from "@/lib/cadastro-skill";
import { urlBaseDe } from "@/lib/feed-meta";

export const maxDuration = 60;

const NOME = "fiodeamor-cadastro";
const PASTA = path.join(process.cwd(), "skill", NOME);
const IGNORAR = /(^|\/)(__pycache__|testes|\.DS_Store|.*\.pyc)(\/|$)/;

async function arquivos(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (IGNORAR.test(rel)) continue;
    if (e.isDirectory()) out.push(...(await arquivos(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * GET /api/skill/baixar[?conectada=1] (gestora) — ZIP da skill para instalar no Claude
 * (Configurações → Capacidades/Skills → Enviar skill). Leva as regras ATUAIS da loja (preço, taxonomia, marca, fiscal).
 * "conectada" inclui o endereço do app e a chave, para a skill consultar e enviar os cadastros sozinha.
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const conectada = req.nextUrl.searchParams.get("conectada") === "1";
    const zip = new JSZip();
    const raiz = zip.folder(NOME)!;
    for (const rel of await arquivos(PASTA)) raiz.file(rel, await fs.readFile(path.join(PASTA, rel)));

    // Regras atuais (com o que a loja mudou em Configurações), no lugar das cópias padrão.
    const [precificacao, taxonomia, marca, fiscal, sistema] = await Promise.all([
      getConfig("precificacao"),
      getConfig("taxonomia"),
      getConfig("marca"),
      getConfig("fiscal"),
      getConfig("sistema"),
    ]);
    const json = (v: unknown) => JSON.stringify(v, null, 2);
    raiz.file("referencias/precificacao.json", json(precificacao));
    raiz.file("referencias/taxonomia.json", json(taxonomia));
    raiz.file("referencias/marca.json", json(marca));
    raiz.file("referencias/fiscal.json", json(fiscal));
    raiz.file(
      "referencias/sistema.json",
      json({
        referenciaModelo: sistema.referenciaModelo,
        unidade: sistema.unidade,
        ncmPadrao: sistema.ncmPadrao,
        cenarioCustoPadrao: sistema.cenarioCustoPadrao,
        origemCodigoBarras: sistema.origemCodigoBarras,
        marcaUp: sistema.marcaUp,
        tipoCotacao: sistema.tipoCotacao,
      }),
    );
    if (conectada) {
      const url = urlBaseDe({
        publica: process.env.NEXT_PUBLIC_URL_PUBLICA,
        host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
        proto: req.headers.get("x-forwarded-proto"),
        origem: req.nextUrl.origin,
      });
      raiz.file("conexao.json", json({ url, chave: await garantirChaveSkill(), geradoEm: new Date().toISOString() }));
      await registrar(req, { acao: "skill.baixar", entidade: "config", resumo: "Skill do Claude baixada já conectada ao app (com a chave)" });
    }
    const dados = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new NextResponse(dados as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${NOME}${conectada ? "-conectada" : ""}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return erro(e);
  }
}
