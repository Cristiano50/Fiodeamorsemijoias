"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export function Botao({
  children,
  variante = "primario",
  carregando,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "fantasma" | "perigo"; carregando?: boolean }) {
  const estilos = {
    primario: "bg-rose-escuro text-white hover:bg-[#7a4c5e] border border-rose-escuro",
    secundario: "bg-white text-rose-escuro border border-rose hover:bg-rose-claro",
    fantasma: "bg-transparent text-rose-escuro hover:bg-rose-claro border border-transparent",
    perigo: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  }[variante];
  return (
    <button
      {...props}
      disabled={props.disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${estilos} ${className}`}
    >
      {carregando && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Cartao({ titulo, acoes, children, className = "" }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-borda bg-white p-4 shadow-[0_1px_0_#f1e4e9] ${className}`}>
      {(titulo || acoes) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-xl font-semibold">{titulo}</h2>}
          {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Campo({ rotulo, dica, children, className = "" }: { rotulo: string; dica?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="rotulo">{rotulo}</span>
      {children}
      {dica && <span className="text-xs text-[#9a8089]">{dica}</span>}
    </label>
  );
}

export function Selo({ children, cor = "rose" }: { children: ReactNode; cor?: "rose" | "verde" | "amarelo" | "vermelho" | "cinza" | "dourado" }) {
  const c = {
    rose: "bg-rose-claro text-rose-escuro",
    verde: "bg-emerald-50 text-emerald-700",
    amarelo: "bg-amber-50 text-amber-700",
    vermelho: "bg-red-50 text-red-700",
    cinza: "bg-stone-100 text-stone-600",
    dourado: "bg-[#f6efe6] text-[#8a6a3b]",
  }[cor];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${c}`}>{children}</span>;
}

export function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-borda bg-white px-4 py-3">
      <div className="rotulo">{rotulo}</div>
      <div className="font-titulo text-2xl font-semibold text-rose-escuro">{valor}</div>
      {detalhe && <div className="text-xs text-[#9a8089]">{detalhe}</div>}
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-[#9a8089]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-rose border-t-transparent" /> {texto}
    </div>
  );
}

export function Modal({ aberto, aoFechar, titulo, children, largura = "max-w-2xl" }: { aberto: boolean; aoFechar: () => void; titulo: string; children: ReactNode; largura?: string }) {
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={aoFechar}>
      <div className={`mt-10 w-full ${largura} rounded-2xl bg-white p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">{titulo}</h2>
          <button onClick={aoFechar} className="text-2xl leading-none text-[#9a8089]" aria-label="Fechar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- avisos (toast) */

type Aviso = { id: number; texto: string; tipo: "ok" | "erro" | "info" };
const AvisoCtx = createContext<(texto: string, tipo?: Aviso["tipo"]) => void>(() => {});

export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((texto: string, tipo: Aviso["tipo"] = "ok") => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 9000 : 4000);
  }, []);
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="nao-imprimir fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2">
        {avisos.map((a) => (
          <div
            key={a.id}
            className={`rounded-xl px-4 py-3 text-sm shadow-lg ${a.tipo === "erro" ? "bg-red-700 text-white" : a.tipo === "info" ? "bg-white text-texto border border-borda" : "bg-rose-escuro text-white"}`}
          >
            {a.texto}
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  );
}

export const useAviso = () => useContext(AvisoCtx);
