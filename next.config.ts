import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
