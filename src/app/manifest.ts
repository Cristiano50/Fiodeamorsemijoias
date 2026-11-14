import type { MetadataRoute } from "next";

/** Para "Adicionar à tela inicial" no Android e no iPhone: abre como aplicativo, com o ícone da marca. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fio de Amor · Cadastro de Semijoias",
    short_name: "Fio de Amor",
    description: "Cadastro de peças, preços, etiquetas, fotos, vendas e maleta da Fio de Amor Semijoias.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FFFBF8",
    theme_color: "#8E5B6F",
    lang: "pt-BR",
    icons: [
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icones/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
