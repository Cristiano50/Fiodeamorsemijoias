import { NextRequest } from "next/server";
import os from "node:os";
import { erro, ok } from "@/lib/api";
import { exigirPapel, modoAcesso } from "@/lib/auth";
import { lerUrlPublica } from "@/lib/config-seguro";
import { registrar } from "@/lib/historico";
import { urlPublicaConfigurada } from "@/lib/url";

/** IPv4 de rede local (192.168.x.x, 10.x.x.x, 172.16–31.x.x). */
const privado = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
/** 100.64.0.0/10: endereço da rede particular da Tailscale (acesso de fora da loja). */
const tailscale = (ip: string) => {
  const m = /^100\.(\d{1,3})\./.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
};

/**
 * GET /api/rede — endereços para abrir o app em outros aparelhos:
 *  - no mesmo Wi-Fi da loja (o computador-servidor roda o app; os outros só abrem o endereço);
 *  - de fora da loja (docs/acesso-de-fora.md): o endereço na internet (Cloudflare Tunnel) e o da
 *    Tailscale, quando o computador-servidor está numa rede da Tailscale.
 */
export async function GET(req: NextRequest) {
  try {
    const u = await exigirPapel(req);
    const host = req.headers.get("host") ?? "";
    const porta = Number(host.split(":")[1]) || Number(process.env.PORT) || 3000;
    const ips: { ip: string; interface: string }[] = [];
    const ipsTailscale: { ip: string; interface: string }[] = [];
    for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
      for (const a of lista ?? []) {
        if (a.family !== "IPv4" || a.internal) continue;
        if (privado(a.address)) ips.push({ ip: a.address, interface: nome });
        else if (tailscale(a.address)) ipsTailscale.push({ ip: a.address, interface: nome });
      }
    }
    // Wi-Fi/Ethernet primeiro; adaptadores virtuais (VirtualBox, WSL, Hyper-V, Docker) por último.
    const virtual = (n: string) => /virtual|vbox|vmware|wsl|hyper-v|vethernet|docker|br-|veth/i.test(n);
    ips.sort((a, b) => Number(virtual(a.interface)) - Number(virtual(b.interface)));
    const hostSemPorta = host.split(":")[0];
    // Nome do computador na Tailscale (MagicDNS): o nome do Windows em minúsculas, sem espaços.
    const nomeTailscale = os
      .hostname()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return ok({
      porta,
      enderecos: ips.map((x) => ({ url: `http://${x.ip}:${porta}`, interface: x.interface })),
      noServidor: ["localhost", "127.0.0.1", "[::1]"].includes(hostSemPorta),
      enderecoAtual: `${req.nextUrl.protocol}//${host}`,
      computador: os.hostname(),
      // De fora da loja.
      urlPublica: await urlPublicaConfigurada(),
      urlPublicaNoDeploy: !!lerUrlPublica(process.env.NEXT_PUBLIC_URL_PUBLICA),
      tailscale: ipsTailscale.length
        ? { enderecos: ipsTailscale.map((x) => `http://${x.ip}:${porta}`), nome: nomeTailscale ? `http://${nomeTailscale}:${porta}` : null }
        : null,
      modo: await modoAcesso(),
      ehGestora: u.p === "gestora",
    });
  } catch (e) {
    return erro(e);
  }
}

/**
 * POST /api/rede { acao: "testar", url } (gestora) — o servidor abre o endereço na internet como um
 * aparelho de fora faria (passa pela internet e volta pelo túnel) e diz se o app respondeu.
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const corpo = (await req.json().catch(() => ({}))) as { acao?: string; url?: unknown };
    if (corpo.acao !== "testar") return erro("Ação desconhecida", 400);
    const url = lerUrlPublica(corpo.url);
    if (!url) return erro("Digite o endereço do app na internet, ex.: https://app.minhaloja.com.br", 400);
    const inicio = Date.now();
    try {
      const res = await fetch(`${url}/api/sessao?modo=1`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(12000) });
      const dados = (await res.json().catch(() => null)) as { modo?: string } | null;
      const respondeu = res.ok && !!dados && typeof dados.modo === "string";
      await registrar(req, { acao: "rede.testar", entidade: "config", resumo: `Teste do endereço na internet ${url}: ${respondeu ? "ok" : `HTTP ${res.status}`}` });
      if (!respondeu) {
        const motivo =
          res.status >= 300 && res.status < 400
            ? "o endereço redireciona para outro lugar (confira se há um login do Cloudflare Access na frente: libere /api/sessao)"
            : res.status === 502 || res.status === 503 || res.status === 530
              ? "o túnel não está ligado neste computador (confira se o serviço cloudflared está rodando)"
              : res.status === 404
                ? "o endereço existe, mas não é este app (confira o serviço do túnel: http://localhost:3000)"
                : `resposta inesperada (HTTP ${res.status})`;
        return ok({ ok: false, mensagem: `Não funcionou: ${motivo}.` });
      }
      const ms = Date.now() - inicio;
      const aviso = dados!.modo === "aberto" ? " Atenção: o app está sem senha — pela internet ninguém entra até você criar os usuários (Configurações → Usuários)." : "";
      return ok({ ok: true, mensagem: `Funcionando: o app respondeu por ${url} em ${(ms / 1000).toFixed(1).replace(".", ",")} s.${aviso}` });
    } catch (e) {
      // O fetch do Node põe o motivo de verdade (ENOTFOUND, certificado…) em e.cause.
      const causa = e instanceof Error ? (e.cause as { code?: string; message?: string } | undefined) : undefined;
      const nome = e instanceof Error ? `${e.name} ${e.message} ${causa?.code ?? ""} ${causa?.message ?? ""}` : String(e);
      const motivo = /timeout|abort/i.test(nome)
        ? "o endereço não respondeu em 12 segundos"
        : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(nome)
          ? "esse endereço não existe na internet (confira o nome e o DNS no Cloudflare)"
          : /cert|SSL|TLS|ERR_TLS/i.test(nome)
            ? "o certificado do endereço não é válido"
            : "não consegui conectar";
      return ok({ ok: false, mensagem: `Não funcionou: ${motivo}.` });
    }
  } catch (e) {
    return erro(e);
  }
}
