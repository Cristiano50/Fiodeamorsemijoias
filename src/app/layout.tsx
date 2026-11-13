import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import marca from "@/config/marca.json";

export const metadata: Metadata = {
  title: "Fio de Amor · Cadastro de Semijoias",
  description: "Cadastro de produtos, precificação, códigos de barras, fotos e integração com o UP Vendas.",
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
