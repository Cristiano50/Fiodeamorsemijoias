"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AvisosProvider } from "./ui";

const MENU = [
  { href: "/", rotulo: "Painel", icone: "◇" },
  { href: "/importar", rotulo: "Importar pedido", icone: "⇪" },
  { href: "/pedidos", rotulo: "Pedidos", icone: "▤" },
  { href: "/produtos", rotulo: "Produtos", icone: "✦" },
  { href: "/etiquetas", rotulo: "Etiquetas", icone: "▥" },
  { href: "/up-vendas", rotulo: "UP Vendas", icone: "⇄" },
  { href: "/especialistas", rotulo: "Especialistas", icone: "♡" },
  { href: "/configuracoes", rotulo: "Configurações", icone: "⚙" },
];

export function Shell({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  if (caminho === "/entrar") return <AvisosProvider>{children}</AvisosProvider>;
  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));
  return (
    <AvisosProvider>
      <div className="flex min-h-screen">
        <aside
          className={`nao-imprimir fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-borda bg-white/95 px-4 py-6 backdrop-blur transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${aberto ? "translate-x-0" : "-translate-x-full"}`}
        >
          <Link href="/" className="mb-8 block px-2" onClick={() => setAberto(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/logo-fiodeamor.png" alt="Fio de Amor Semijoias" className="w-full" />
          </Link>
          <nav className="flex flex-col gap-1">
            {MENU.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setAberto(false)}
                className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm transition ${ativo(m.href) ? "bg-rose-claro font-medium text-rose-escuro" : "text-texto hover:bg-[#fbf3f6]"}`}
              >
                <span className="w-4 text-center text-rose">{m.icone}</span>
                {m.rotulo}
              </Link>
            ))}
          </nav>
          <p className="absolute bottom-5 left-6 right-6 text-[0.65rem] uppercase tracking-[0.18em] text-[#b49aa4]">cadastro de semijoias</p>
        </aside>
        {aberto && <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setAberto(false)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="nao-imprimir sticky top-0 z-20 flex items-center gap-3 border-b border-borda bg-white/90 px-4 py-2 backdrop-blur md:hidden">
            <button onClick={() => setAberto(true)} className="text-2xl text-rose-escuro" aria-label="Abrir menu">
              ☰
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/logo-fiodeamor.png" alt="Fio de Amor" className="h-8" />
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </AvisosProvider>
  );
}
