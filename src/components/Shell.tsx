"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AvisosProvider } from "./ui";

const MENU: { href: string; rotulo: string; icone: string; gestora?: boolean }[] = [
  { href: "/", rotulo: "Painel", icone: "◇" },
  { href: "/importar", rotulo: "Importar pedido", icone: "⇪" },
  { href: "/pedidos", rotulo: "Pedidos", icone: "▤" },
  { href: "/produtos", rotulo: "Produtos", icone: "✦" },
  { href: "/fotos", rotulo: "Fotos para aprovar", icone: "◐" },
  { href: "/etiquetas", rotulo: "Etiquetas", icone: "▥" },
  { href: "/vendas", rotulo: "Vendas e recompra", icone: "↗" },
  { href: "/maleta", rotulo: "Maleta inteligente", icone: "◫" },
  { href: "/up-vendas", rotulo: "UP Vendas", icone: "⇄" },
  { href: "/aparelhos", rotulo: "Celular e outros PCs", icone: "▯" },
  { href: "/gastos", rotulo: "Gastos com IA", icone: "$", gestora: true },
  { href: "/historico", rotulo: "Histórico", icone: "⟲", gestora: true },
  { href: "/especialistas", rotulo: "Especialistas", icone: "♡" },
  { href: "/configuracoes", rotulo: "Configurações", icone: "⚙", gestora: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const [sessao, setSessao] = useState<{ modo: string; usuario: { nome: string; papel: string } | null } | null>(null);
  useEffect(() => {
    if (caminho === "/entrar") return;
    fetch("/api/sessao")
      .then((r) => r.json())
      .then(setSessao)
      .catch(() => {});
  }, [caminho]);
  if (caminho === "/entrar") return <AvisosProvider>{children}</AvisosProvider>;
  const ehGestora = !sessao || sessao.usuario?.papel === "gestora";
  const sair = async () => {
    await fetch("/api/login", { method: "DELETE" });
    window.location.href = "/entrar";
  };
  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));
  return (
    <AvisosProvider>
      <div className="flex min-h-screen">
        <aside
          className={`nao-imprimir fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col overflow-y-auto border-r border-borda bg-white/95 px-4 py-6 backdrop-blur transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${aberto ? "translate-x-0" : "-translate-x-full"}`}
        >
          <Link href="/" className="mb-8 block px-2" onClick={() => setAberto(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/logo-fiodeamor.png" alt="Fio de Amor Semijoias" className="w-full" />
          </Link>
          <nav className="flex flex-col gap-1">
            {MENU.filter((m) => !m.gestora || ehGestora).map((m) => (
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
          <div className="mt-auto px-2 pt-6">
            {sessao?.usuario && sessao.modo !== "aberto" && (
              <div className="mb-3 rounded-xl bg-rose-claro px-3 py-2 text-xs">
                <div className="font-medium text-rose-escuro">{sessao.usuario.nome}</div>
                <div className="text-[#8a6d78]">{sessao.usuario.papel === "gestora" ? "Gestora" : "Funcionário(a)"}</div>
                <button onClick={sair} className="mt-1 text-rose-escuro underline">
                  Sair
                </button>
              </div>
            )}
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-[#b49aa4]">cadastro de semijoias</p>
          </div>
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
