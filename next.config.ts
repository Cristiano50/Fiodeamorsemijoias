import type { NextConfig } from "next";

// Cabeçalhos de segurança de todas as respostas. O App Router precisa de 'unsafe-inline' nos scripts
// (não usamos nonce); 'unsafe-eval' e o websocket da recarga só no desenvolvimento. Fontes do Google
// Fonts (src/app/layout.tsx: CSS em fonts.googleapis.com, arquivos em fonts.gstatic.com); o leitor de
// PDF usa o worker de /public (mesmo endereço) e as prévias de foto usam blob:. Links para wa.me são
// navegação e não entram aqui.
const desenvolvimento = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${desenvolvimento ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  `connect-src 'self'${desenvolvimento ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const CABECALHOS_SEGURANCA = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  // Câmera só no próprio app (leitor de código de barras); microfone e localização desligados.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_SEGURANCA }];
  },
  // Instalador do Windows (instalador/empacotar.mjs): servidor autônomo, sem precisar do npm no computador da loja.
  output: process.env.FDA_STANDALONE ? "standalone" : undefined,
  // Pacotes nativos/pesados que devem rodar apenas no servidor Node.
  experimental: {
    // O proxy (senha do app) lê o corpo das requisições; os lotes de fotos ficam bem abaixo disso.
    proxyClientMaxBodySize: "20mb",
  },
  serverExternalPackages: ["@libsql/client", "libsql", "exceljs", "sharp", "bwip-js"],
  // Na nuvem (Vercel), leva junto os pareceres lidos do disco por /api/especialistas.
  outputFileTracingIncludes: {
    "/api/especialistas": ["./docs/especialistas/*.md"],
    // O ZIP da skill do Claude é montado a partir desta pasta.
    "/api/skill/baixar": ["./skill/fiodeamor-cadastro/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
