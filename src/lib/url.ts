import type { NextRequest } from "next/server";
import { urlBaseDe } from "./feed-meta";

/**
 * Endereço do app como quem acessou o vê: NEXT_PUBLIC_URL_PUBLICA (nuvem) → cabeçalhos do proxy → Host
 * (ex.: http://192.168.0.10:3000 no Wi-Fi da loja). Nunca o endereço interno 127.0.0.1 do servidor.
 */
export function urlDoApp(req: NextRequest): string {
  return urlBaseDe({
    publica: process.env.NEXT_PUBLIC_URL_PUBLICA,
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    proto: req.headers.get("x-forwarded-proto"),
    origem: req.nextUrl.origin,
  });
}
