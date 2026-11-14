import { NextRequest } from "next/server";
import os from "node:os";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";

/** IPv4 de rede local (192.168.x.x, 10.x.x.x, 172.16–31.x.x). */
const privado = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/**
 * GET /api/rede — endereços para abrir o app em outros aparelhos do mesmo Wi-Fi
 * (o computador-servidor da loja roda o app; celulares e outros computadores só abrem o endereço).
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const host = req.headers.get("host") ?? "";
    const porta = Number(host.split(":")[1]) || Number(process.env.PORT) || 3000;
    const ips: { ip: string; interface: string }[] = [];
    for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
      for (const a of lista ?? []) {
        if (a.family === "IPv4" && !a.internal && privado(a.address)) ips.push({ ip: a.address, interface: nome });
      }
    }
    // Wi-Fi/Ethernet primeiro; adaptadores virtuais (VirtualBox, WSL, Hyper-V, Docker) por último.
    const virtual = (n: string) => /virtual|vbox|vmware|wsl|hyper-v|vethernet|docker|br-|veth/i.test(n);
    ips.sort((a, b) => Number(virtual(a.interface)) - Number(virtual(b.interface)));
    const hostSemPorta = host.split(":")[0];
    return ok({
      porta,
      enderecos: ips.map((x) => ({ url: `http://${x.ip}:${porta}`, interface: x.interface })),
      noServidor: ["localhost", "127.0.0.1", "[::1]"].includes(hostSemPorta),
      enderecoAtual: `${req.nextUrl.protocol}//${host}`,
      computador: os.hostname(),
    });
  } catch (e) {
    return erro(e);
  }
}
