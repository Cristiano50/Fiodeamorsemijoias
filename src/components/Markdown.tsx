"use client";
import { useMemo } from "react";
import { markdownSeguro } from "@/lib/markdown-seguro";

/**
 * Renderiza markdown gerado pela IA ou pelos especialistas. O texto vem de fora (IA), então
 * markdownSeguro mostra HTML cru como texto, só deixa links http/https/mailto e imagens do próprio app.
 */
export function Markdown({ texto, className = "" }: { texto: string; className?: string }) {
  const html = useMemo(() => markdownSeguro(texto), [texto]);
  return (
    <div
      className={`prose-fda text-sm leading-relaxed [&_h1]:mt-4 [&_h1]:text-2xl [&_h2]:mt-4 [&_h2]:text-xl [&_h3]:mt-3 [&_h3]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:my-2 [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-borda [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-borda [&_th]:bg-rose-claro [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_code]:rounded [&_code]:bg-rose-claro [&_code]:px-1 [&_a]:text-rose-escuro [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-rose [&_blockquote]:pl-3 [&_blockquote]:italic ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
