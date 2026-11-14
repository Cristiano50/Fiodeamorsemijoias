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
