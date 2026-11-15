import "server-only";
import type { NextRequest } from "next/server";
import { urlBaseDe } from "./feed-meta";
import { getConfig } from "./config";
import { lerUrlPublica } from "./config-seguro";

/**
 * Endereço do app na internet, quando existe: NEXT_PUBLIC_URL_PUBLICA (nuvem, definida no deploy) ou o
 * "Endereço na internet" do servidor da loja (Celular e outros PCs → acesso de fora da loja, ex.: Cloudflare
 * Tunnel). Vazio = o app só existe na rede da loja.
 */
export async function urlPublicaConfigurada(): Promise<string> {
  const ambiente = lerUrlPublica(process.env.NEXT_PUBLIC_URL_PUBLICA);
  if (ambiente) return ambiente;
  return lerUrlPublica((await getConfig("sistema")).urlPublica) || "";
}

/**
 * Endereço do app para links que saem da loja (feed da Meta, skill, planilhas com foto, envio ao UP):
 * o endereço na internet, se houver → cabeçalhos do proxy/túnel → Host (ex.: http://192.168.0.10:3000 no
 * Wi-Fi da loja). Nunca o endereço interno 127.0.0.1 do servidor.
 */
export async function urlDoApp(req: NextRequest): Promise<string> {
  return urlBaseDe({
    publica: await urlPublicaConfigurada(),
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    proto: req.headers.get("x-forwarded-proto"),
    origem: req.nextUrl.origin,
  });
}
