import { NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js/node";

/** SVG do código de barras. GET /api/codigo-barras?c=2000000000015&tipo=ean13&altura=10&texto=1 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const texto = p.get("c") ?? "";
  const tipo = p.get("tipo") ?? (/^\d{13}$/.test(texto) ? "ean13" : "code128");
  try {
    const svg = bwipjs.toSVG({
      bcid: tipo,
      text: texto,
      height: Number(p.get("altura") ?? 10),
      includetext: p.get("texto") !== "0",
      textxalign: "center",
      textsize: 8,
      scale: 1,
    });
    return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    return new NextResponse(`Código inválido: ${e instanceof Error ? e.message : e}`, { status: 400 });
  }
}
