import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacotes nativos/pesados que devem rodar apenas no servidor Node.
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
