#!/usr/bin/env python3
"""Conversa com o app da Fio de Amor (opcional): busca o contexto e envia o cadastro.

Uso:
    python3 scripts/app.py testar
    python3 scripts/app.py contexto [--saida contexto.json]
    python3 scripts/app.py enviar cadastro-X260926017.json

Conexão (nesta ordem): --url/--chave, variáveis FIODEAMOR_URL/FIODEAMOR_CHAVE, ou o arquivo conexao.json na raiz da
skill (vem na "skill conectada" baixada em Configurações → Skill do Claude do app).

Códigos de saída: 0 = ok; 2 = sem conexão (rede bloqueada no Claude, app fora do ar ou só na rede da loja) — nesse caso
siga sem o app e entregue o arquivo cadastro-….json para a loja importar em "Importar pedido → Cadastro feito no Claude";
3 = chave inválida; 1 = outro erro.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
LIMITE_PARTE = 3_000_000  # bytes por requisição (a Vercel aceita até 4,5 MB)


def conexao(args) -> tuple[str, str]:
    url, chave = args.url or os.environ.get("FIODEAMOR_URL"), args.chave or os.environ.get("FIODEAMOR_CHAVE")
    arq = BASE / "conexao.json"
    if (not url or not chave) and arq.exists():
        c = json.loads(arq.read_text(encoding="utf-8"))
        url, chave = url or c.get("url"), chave or c.get("chave")
    if not url or not chave:
        print(
            "Sem conexão configurada com o app. Use a skill 'conectada' (Configurações → Skill do Claude no app) "
            "ou informe --url e --chave. Sem o app, entregue o arquivo cadastro-….json para importar manualmente.",
            file=sys.stderr,
        )
        sys.exit(2)
    return url.rstrip("/"), chave


def chamar(url: str, chave: str, caminho: str, corpo: dict | None = None, timeout: int = 120) -> dict:
    dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(
        url + caminho,
        data=dados,
        method="POST" if corpo is not None else "GET",
        headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "fiodeamor-skill/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("erro")
        except Exception:
            msg = None
        if e.code in (401, 403):
            print(f"O app recusou a chave ({e.code}): {msg or 'chave inválida'}. Gere/copie a chave em Configurações → Skill do Claude.", file=sys.stderr)
            sys.exit(3)
        print(f"O app respondeu {e.code}: {msg or e.reason}", file=sys.stderr)
        sys.exit(1)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        host = url.split("//")[-1].split("/")[0]
        print(
            f"Não consegui falar com o app em {url} ({getattr(e, 'reason', e)}). "
            f"No Claude, a rede dos scripts precisa permitir o domínio {host} (Configurações → Capacidades → acesso à rede); "
            "se o app roda só no computador da loja, o Claude não alcança. Siga sem o app e entregue o arquivo cadastro-….json.",
            file=sys.stderr,
        )
        sys.exit(2)


def dividir(itens: list, limite: int = LIMITE_PARTE) -> list[list]:
    partes, atual, tam = [], [], 0
    for it in itens:
        t = len(json.dumps(it, ensure_ascii=False).encode("utf-8"))
        if atual and tam + t > limite:
            partes.append(atual)
            atual, tam = [], 0
        atual.append(it)
        tam += t
    if atual or not partes:
        partes.append(atual)
    return partes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acao", choices=["testar", "contexto", "enviar"])
    ap.add_argument("arquivo", nargs="?")
    ap.add_argument("--saida", default="contexto.json")
    ap.add_argument("--url")
    ap.add_argument("--chave")
    a = ap.parse_args()
    url, chave = conexao(a)

    if a.acao == "testar":
        ctx = chamar(url, chave, "/api/skill/contexto", timeout=40)
        print(json.dumps({"ok": True, "app": url, "produtosCadastrados": len(ctx.get("produtos", [])), "proximasReferencias": ctx.get("referencias")}, ensure_ascii=False, indent=1))
        return 0

    if a.acao == "contexto":
        ctx = chamar(url, chave, "/api/skill/contexto", timeout=60)
        Path(a.saida).write_text(json.dumps(ctx, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"salvo": a.saida, "produtosCadastrados": len(ctx.get("produtos", [])), "proximasReferencias": ctx.get("referencias")}, ensure_ascii=False, indent=1))
        return 0

    if not a.arquivo:
        ap.error("informe o arquivo cadastro-….json (gerado por scripts/gerar_saidas.py)")
    pacote = json.loads(Path(a.arquivo).read_text(encoding="utf-8"))
    if pacote.get("formato") != "fiodeamor-cadastro":
        ap.error("o arquivo não é um cadastro da skill (rode scripts/gerar_saidas.py)")
    itens = pacote.get("itens", [])
    partes = dividir(itens)
    r = {}
    for i, parte in enumerate(partes, start=1):
        corpo = {**pacote, "itens": parte, "parte": i, "partes": len(partes), "totalItens": len(itens)}
        r = chamar(url, chave, "/api/skill/cadastro", corpo, timeout=300)
        print(f"parte {i}/{len(partes)}: {r.get('recebidos')} de {len(itens)} recebidas", file=sys.stderr)
        if r.get("jaImportado"):
            break
    print(json.dumps({k: r.get(k) for k in ("url", "pedidoId", "numero", "recebidos", "recompras", "aConfirmar", "jaImportado", "referenciasTrocadas", "avisos")}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
