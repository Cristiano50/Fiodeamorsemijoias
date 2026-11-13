import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes nativos/pesados que devem rodar apenas no servidor Node.
  experimental: {
    // O proxy (senha do app) lê o corpo das requisições; os lotes de fotos ficam bem abaixo disso.
    proxyClientMaxBodySize: "20mb",
  },
  serverExternalPackages: ["@libsql/client", "libsql", "exceljs", "sharp", "bwip-js"],
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
