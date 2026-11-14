import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import marca from "@/config/marca.json";

export const metadata: Metadata = {
  title: "Fio de Amor · Cadastro de Semijoias",
  description: "Cadastro de produtos, precificação, códigos de barras, fotos e integração com o UP Vendas.",
  applicationName: "Fio de Amor",
  // iPhone: "Adicionar à Tela de Início" abre em tela cheia, com o ícone da marca.
  appleWebApp: { capable: true, title: "Fio de Amor", statusBarStyle: "default" },
  icons: { apple: "/icones/apple-touch-icon.png", icon: [{ url: "/icones/icone-192.png", sizes: "192x192", type: "image/png" }] },
};

export const viewport: Viewport = {
  themeColor: "#8E5B6F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={marca.fontes.google_fonts_url} />
      </head>
      <body className="min-h-screen antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
