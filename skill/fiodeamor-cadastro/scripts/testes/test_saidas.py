"""Testes de referencias.py, gerar_saidas.py e app.py (sem rede e sem o PDF de exemplo)."""
import csv
import io
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import app  # noqa: E402
import gerar_saidas as gs  # noqa: E402
import referencias as refs  # noqa: E402


class TestReferencias(unittest.TestCase):
    def test_montar_e_ler_referencia(self):
        d = datetime(2026, 11, 14)
        self.assertEqual(refs.montar_referencia("{PREFIXO}_{AA}{MM}{SEQ:3}", "BR", 7, d), "BR_2611007")
        self.assertEqual(refs.montar_referencia("{PREFIXO}{AAAA}-{SSSS}", "AN", 12, d), "AN2026-0012")
        rx = refs.regex_referencia("{PREFIXO}_{AA}{MM}{SEQ:3}", "BR", d)
        self.assertEqual(int(rx.match("BR_2611034").group(1)), 34)
        self.assertIsNone(rx.match("BR_2610034"))  # outro mês
        self.assertIsNone(rx.match("CL_2611034"))  # outro prefixo

    def _rodar(self, cadastro: dict, *args: str) -> tuple[dict, dict]:
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "cadastro.json"
            arq.write_text(json.dumps(cadastro, ensure_ascii=False), encoding="utf-8")
            extra = []
            for a in args:
                if a.startswith("{"):
                    ctx = Path(tmp) / "contexto.json"
                    ctx.write_text(a, encoding="utf-8")
                    extra += ["--contexto", str(ctx)]
                else:
                    extra.append(a)
            saida = subprocess.run([sys.executable, str(SCRIPTS / "referencias.py"), str(arq), *extra], capture_output=True, text=True, check=True)
            return json.loads(arq.read_text(encoding="utf-8")), json.loads(saida.stdout)

    def test_recompra_pelo_contexto_e_novas_continuam_a_numeracao(self):
        agora = datetime.now()
        cad = {
            "pedido": {"fornecedor": "广州 某某饰品"},
            "itens": [
                {"linha": 1, "codigoFornecedor": "GSH747A", "especificacao": "G", "tipo": "brinco", "precoOrigem": 11},
                {"linha": 2, "codigoFornecedor": "SH5122A", "especificacao": "MR白油", "tipo": "brinco", "variacao": "esmalte branco"},
                {"linha": 3, "codigoFornecedor": "SH5122A", "especificacao": "MR粉油", "tipo": "brinco", "variacao": "esmalte rosa"},
                {"linha": 4, "codigoFornecedor": "XM1", "especificacao": "G", "tipo": "colar"},
            ],
        }
        contexto = {
            "regras": {"sistema": {"referenciaModelo": "{PREFIXO}_{AA}{MM}{SEQ:3}"}},
            "referencias": {"mes": agora.strftime("%Y-%m"), "proxima": {"BR": 45, "CL": 3}},
            "produtos": [
                {"referencia": "BR_2609001", "codigoFornecedor": "GSH747A", "especificacao": "G", "fornecedor": "广州某某饰品", "codigoBarras": "9000000000018",
                 "codigoBarrasOrigem": "up", "nome": "BRINCO (SJ) BOTÃO", "precoOrigem": 10, "pedido": "X1", "dataCompra": "2026-09-26"},
            ],
        }
        out, r = self._rodar(cad, json.dumps(contexto, ensure_ascii=False))
        it = {i["linha"]: i for i in out["itens"]}
        self.assertEqual(r["recompras"], 1)
        self.assertEqual(it[1]["referencia"], "BR_2609001")
        self.assertEqual(it[1]["codigoBarras"], "9000000000018")
        self.assertEqual(it[1]["nome"], "BRINCO (SJ) BOTÃO")
        self.assertIn("subiu 10%", " ".join(it[1]["alertas"]))
        pre = f"_{agora:%y%m}"
        self.assertEqual(it[2]["referencia"], f"BR{pre}045")  # variações dividem a referência
        self.assertEqual(it[3]["referencia"], f"BR{pre}045")
        self.assertEqual(it[4]["referencia"], f"CL{pre}003")

    def _contexto(self, *produtos, novo=True):
        """Contexto do app com peças já cadastradas (novo = com a chave do fornecedor e a especificação)."""
        out = []
        for p in produtos:
            p = {"codigoBarrasOrigem": "up", "pedido": "X1", "dataCompra": "2026-09-26", **p}
            if novo:
                p.setdefault("fornecedorChave", "fornecedorficticio")
            out.append(p)
        return json.dumps({"referencias": {"mes": "2000-01", "proxima": {}}, "produtos": out}, ensure_ascii=False)

    def test_recompra_automatica_so_com_um_original_que_casa_a_chave(self):
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [
            {"linha": 1, "codigoFornecedor": "abc-123 a", "especificacao": "ｇ", "tipo": "brinco"},  # mesma chave normalizada
        ]}
        ctx = self._contexto({"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G", "codigoBarras": "9000000000018"})
        out, r = self._rodar(cad, ctx)
        it = out["itens"][0]
        self.assertEqual((r["recompras"], r["recomprasAConfirmar"]), (1, 0))
        self.assertEqual((it["recompraDe"], it["referencia"], it["codigoBarras"]), ("BR_2609001", "BR_2609001", "9000000000018"))
        self.assertNotIn("recompraCandidatas", it)

    def test_mais_de_um_original_fica_a_confirmar(self):
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [
            {"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "G", "tipo": "brinco"},
            {"linha": 2, "codigoFornecedor": "ABC124B", "especificacao": "金色", "tipo": "anel"},
        ]}
        ctx = self._contexto(
            {"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G", "codigoBarras": "9000000000018"},
            {"referencia": "BR_2610007", "codigoFornecedor": "ABC123A", "especificacao": "G", "pedido": "X2"},
            # especificação vazia de um dos lados = original possível, mas não automático
            {"referencia": "AN_2609002", "codigoFornecedor": "ABC124B", "especificacao": None},
        )
        out, r = self._rodar(cad, ctx)
        a, b = out["itens"]
        self.assertEqual((r["recompras"], r["recomprasAConfirmar"]), (0, 2))
        self.assertEqual((a["recompraDe"], a["recompraCandidatas"]), (None, ["BR_2609001", "BR_2610007"]))
        self.assertIsNone(a.get("codigoBarras"))  # a peça a confirmar não herda código de barras
        self.assertIsNone(a["referencia"])  # como no app: a referência sai da decisão ("É esta" ou "Não é recompra")
        self.assertEqual(a.get("alertas", []), [])  # o app mostra "Recompra a confirmar" pelo campo; sem alerta velho
        self.assertEqual(r["aConfirmar"][0]["opcoes"], ["BR_2609001 (G, pedido X1 de 26/09/2026)", "BR_2610007 (G, pedido X2 de 26/09/2026)"])
        self.assertEqual(b["recompraCandidatas"], ["AN_2609002"])
        self.assertEqual(r["referenciasNovas"], 0)

    def test_pedido_sem_fornecedor_so_candidatas(self):
        cad = {"pedido": {"fornecedor": None}, "itens": [{"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "G", "tipo": "brinco"}]}
        out, r = self._rodar(cad, self._contexto({"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G"}))
        self.assertEqual((r["recompras"], out["itens"][0]["recompraCandidatas"]), (0, ["BR_2609001"]))
        self.assertTrue(any("sem o nome do fornecedor" in a for a in r["avisos"]))
        # Original de outro fornecedor conhecido não é candidata.
        cad["pedido"]["fornecedor"] = "Outro Fornecedor"
        out, r = self._rodar(cad, self._contexto({"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G"}))
        self.assertEqual((r["recompras"], r["recomprasAConfirmar"]), (0, 0))
        self.assertNotIn("recompraCandidatas", out["itens"][0])

    def test_contexto_antigo_sem_chave_do_fornecedor(self):
        # Contexto antigo: chave do fornecedor pelo nome; especificação = o próprio código (leitor antigo) vale vazia.
        cad = {"pedido": {"fornecedor": "Fornecedor  Ficticio"}, "itens": [
            {"linha": 1, "codigoFornecedor": "ABC125C", "tipo": "brinco"},
            {"linha": 2, "codigoFornecedor": "ABC126D", "especificacao": "G", "tipo": "brinco"},
        ]}
        ctx = self._contexto(
            {"referencia": "BR_2609003", "codigoFornecedor": "ABC125C", "especificacao": "ABC125C", "fornecedor": "fornecedor ficticio"},
            {"referencia": "BR_2609004", "codigoFornecedor": "ABC126D", "especificacao": "ABC126D", "fornecedor": "fornecedor ficticio"},
            novo=False,
        )
        out, r = self._rodar(cad, ctx)
        a, b = out["itens"]
        self.assertEqual(a["recompraDe"], "BR_2609003")  # sem especificação dos dois lados: recompra
        self.assertEqual((b["recompraDe"], b["recompraCandidatas"]), (None, ["BR_2609004"]))  # G × vazia: a confirmar

    def test_recompra_entra_no_grupo_de_variacoes(self):
        agora = datetime.now()
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [
            {"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "MR粉油", "tipo": "brinco", "variacao": "esmalte rosa"},
            {"linha": 2, "codigoFornecedor": "ABC123A", "especificacao": "MR白油", "tipo": "brinco", "variacao": "esmalte branco"},
            {"linha": 3, "codigoFornecedor": "ABC-123A", "especificacao": "MR黑油", "tipo": "brinco"},
        ]}
        ctx = self._contexto({"referencia": "BR_2609010", "codigoFornecedor": "ABC123A", "especificacao": "MR白油", "codigoBarras": "9000000000025"})
        out, r = self._rodar(cad, ctx, "--inicio", "BR=40")
        it = {i["linha"]: i for i in out["itens"]}
        self.assertEqual(it[2]["recompraDe"], "BR_2609010")
        self.assertEqual({i["grupo"] for i in it.values()}, {"ABC123A"})  # a recompra também entra no grupo
        # As variações novas dividem a referência da original (um código de barras por variação, no UP).
        self.assertEqual([it[k]["referencia"] for k in (1, 2, 3)], ["BR_2609010"] * 3)
        self.assertEqual(r["referenciasNovas"], 0)
        self.assertIsNone(it[1].get("codigoBarras"))
        self.assertEqual(r["proximas"].get("BR"), 40)
        self.assertTrue(agora)

    def test_lista_do_up_fica_a_confirmar(self):
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [{"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "G", "tipo": "brinco"}]}
        with tempfile.TemporaryDirectory() as tmp:
            lista = Path(tmp) / "produtos-up.csv"
            lista.write_text("Referência;Nome;Código Externo;Cód. Barras\nBR_2609001;BRINCO (SJ) BOTÃO;ABC123A;9000000000018\n", encoding="utf-8")
            out, r = self._rodar(cad, "--lista-up", str(lista))
        it = out["itens"][0]
        self.assertEqual((r["recompras"], it["recompraCandidatas"]), (0, ["BR_2609001"]))
        self.assertEqual(r["aConfirmar"][0]["opcoes"], ["BR_2609001 (BRINCO (SJ) BOTÃO, sem especificação, lista de produtos do UP)"])
        self.assertTrue(any("lista do UP não tem fornecedor" in a for a in r["avisos"]))

    def test_rodar_de_novo_mantem_a_recompra(self):
        ctx = self._contexto({"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G", "codigoBarras": "9000000000018", "precoOrigem": 10})
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [{"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "G", "tipo": "brinco", "precoOrigem": 12.5}]}
        out, _ = self._rodar(cad, ctx)
        out2, r2 = self._rodar(out, ctx)
        self.assertEqual(out2["itens"][0]["alertas"], ["Recompra de BR_2609001 (pedido X1 de 26/09/2026).", "Preço do fornecedor subiu 25% (10 → 12.5)."])
        self.assertEqual(r2["recompras"], 1)

    def test_refazer_desfaz_recompra_que_nao_casa_mais(self):
        ctx = self._contexto({"referencia": "BR_2609001", "codigoFornecedor": "ABC123A", "especificacao": "G", "codigoBarras": "9000000000018"})
        cad = {"pedido": {"fornecedor": "Fornecedor Ficticio"}, "itens": [{"linha": 1, "codigoFornecedor": "ABC123A", "especificacao": "G", "tipo": "brinco"}]}
        out, _ = self._rodar(cad, ctx)
        self.assertEqual(out["itens"][0]["codigoBarras"], "9000000000018")
        out["itens"][0]["especificacao"] = "MR"  # a pessoa corrigiu a especificação: não é mais a mesma peça
        out2, r2 = self._rodar(out, ctx, "--refazer")
        it = out2["itens"][0]
        self.assertEqual((r2["recompras"], it["recompraDe"], it.get("codigoBarras")), (0, None, None))
        self.assertTrue(it["referencia"].startswith("BR_") and it["referencia"] != "BR_2609001")
        self.assertEqual(it["alertas"], [])

    def test_normalizacao_da_chave(self):
        self.assertEqual(refs.normalizar_chave("abc-123 a"), "ABC123A")
        self.assertEqual(refs.normalizar_chave("ＡＢＣ１２３Ａ"), "ABC123A")
        self.assertEqual(refs.normalizar_chave("A.B\u3000C"), "ABC")
        self.assertEqual(refs.normalizar_chave(None), "")
        self.assertEqual(refs.chave_fornecedor(" 广州 某某\u00a0饰品 Ltd "), "广州某某饰品ltd")

    def test_outro_fornecedor_nao_e_recompra_e_sem_historico_avisa(self):
        cad = {"pedido": {"fornecedor": "Outro"}, "itens": [{"linha": 1, "codigoFornecedor": "GSH747A", "especificacao": "G", "tipo": "anel"}]}
        contexto = {"produtos": [{"referencia": "BR_2609001", "codigoFornecedor": "GSH747A", "especificacao": "G", "fornecedor": "广州某某饰品"}]}
        out, r = self._rodar(cad, json.dumps(contexto))
        self.assertEqual(r["recompras"], 0)
        self.assertTrue(out["itens"][0]["referencia"].startswith("AN_"))
        _, r2 = self._rodar({"pedido": {}, "itens": [{"linha": 1, "tipo": "anel"}]})
        self.assertTrue(any("começaram em 001" in a for a in r2["avisos"]))


class TestPlanilhaUp(unittest.TestCase):
    tax = {
        "tipos": [{"id": "brinco", "nome": "Brinco", "categoria_vitrine": "Brincos"}],
        "materiais": [{"id": "semijoia", "nome": "Semijoia (folheado)", "descricao_grade": "SEMIJOIA BANHADA A OURO 18K"}],
        "banhos": [{"id": "ouro_18k", "nome": "Ouro 18k"}],
        "cores_pedra": [{"id": "zirconia_branca", "nome": "Zircônia branca"}],
    }
    pol = {"tabela_base": "consignado", "tabelas_preco": [{"id": "consignado", "nome": "Consignado", "tabela_up_vendas": "CONSIGNADO"}, {"id": "atacado", "nome": "ATACADO/REVENDA", "tabela_up_vendas": "ATACADO"}]}

    def item(self, **kw):
        base = {"linha": 1, "nome": "brinco (sj) botão", "referencia": "BR_2611001", "codigoFornecedor": "GSH747A", "tipo": "brinco", "subtipo": "Brinco médio",
                "material": "semijoia", "banho": "ouro_18k", "corPedra": ["zirconia_branca"], "quantidade": 12, "custoProdutoBrl": 7.74, "custoAdicionalBrl": 0,
                "custoTotalBrl": 7.74, "precoVenda": 77.99, "precos": {"consignado": 77.99, "atacado": 46.99}}
        base.update(kw)
        return base

    def test_linha_igual_ao_app(self):
        l = gs.linha_up(self.item(), self.tax, self.pol, {"marcaUp": "FIO DE AMOR"})
        self.assertEqual(l["nome"], "BRINCO (SJ) BOTÃO")
        self.assertEqual(l["categoriaVitrine"], "Brincos - Brinco médio")
        self.assertEqual(l["descricaoGrade"], "SEMIJOIA BANHADA A OURO 18K")
        self.assertEqual(l["tabelaPreco"], "CONSIGNADO")
        self.assertEqual(l["percentualLucro"], 907.62)
        self.assertEqual((l["tabelaPreco2"], l["valorTabela2"], l["percentualLucro2"]), ("ATACADO/REVENDA", 46.99, 507.11))
        self.assertEqual(l["corPedra"], "Zircônia branca")
        self.assertEqual(gs.texto_csv(77.99), "77,99")
        self.assertEqual(gs.texto_csv(0.0), "0")
        self.assertEqual(gs.texto_csv(True), "Sim")
        com_var = gs.linha_up(self.item(variacao="esmalte rosa"), self.tax, self.pol, {})
        self.assertEqual(com_var["descricaoGrade"], "SEMIJOIA BANHADA A OURO 18K - ESMALTE ROSA")

    def test_quantidade_zero_continua_zero_no_estoque(self):
        self.assertEqual(gs.linha_up(self.item(quantidade=0), self.tax, self.pol, {})["estoque"], 0)
        self.assertEqual(gs.linha_up(self.item(quantidade=None), self.tax, self.pol, {})["estoque"], 1)  # como no app
        self.assertEqual(gs.linha_up(self.item(quantidade="12"), self.tax, self.pol, {})["estoque"], 12)

    def test_celulas_seguras_como_no_app(self):
        # Os mesmos casos de tests/utilitarios.test.ts (celulaCsv / textoSeguroPlanilha).
        self.assertEqual(gs.texto_csv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
        self.assertEqual(gs.texto_csv("+55 11"), "'+55 11")
        self.assertEqual(gs.texto_csv("BRINCO (SJ)"), "BRINCO (SJ)")
        self.assertEqual(gs.texto_csv(-5), "-5")
        self.assertEqual(gs.texto_csv(77.99), "77,99")
        self.assertEqual(gs.texto_csv("a;b"), '"a;b"')
        self.assertEqual(gs.texto_csv('diz "oi"'), '"diz ""oi"""')
        self.assertEqual(gs.texto_csv(True), "Sim")
        self.assertEqual(gs.texto_csv(None), "")
        self.assertEqual([gs.texto_csv(v) for v in ("-x", "@x", "\tx", "\rx")], ["'-x", "'@x", "'\tx", '"\'\rx"'])

    def test_planilhas_sem_formula(self):
        perigosos = self.item(nome="=cmd|' /C calc'!A0", nomeComercial="+55 11 9999", legenda="@marca", variacao="-rosa")
        linhas = [gs.linha_up(perigosos, self.tax, self.pol, {}), gs.linha_up(self.item(), self.tax, self.pol, {})]
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "p.csv"
            gs.gravar_csv(linhas, arq)
            bruto = arq.read_bytes()
            self.assertTrue(bruto.startswith("\ufeff".encode("utf-8")))
            texto = bruto.decode("utf-8-sig")
            self.assertFalse(texto.endswith("\r\n"))  # como o app: linhas unidas por CRLF
            tabela = list(csv.reader(io.StringIO(texto), delimiter=";"))
            cab = tabela[0]
            l1 = dict(zip(cab, tabela[1]))
            self.assertEqual(l1["Nome do produto"], "'=CMD|' /C CALC'!A0")
            self.assertEqual(l1["Nome comercial"], "'+55 11 9999")
            self.assertEqual(l1["Legenda Instagram"], "'@marca")
            self.assertEqual(l1["Descrição (grade)"], "SEMIJOIA BANHADA A OURO 18K - -ROSA")
            self.assertEqual(l1["Valor Tabela 1"], "77,99")
            try:
                from openpyxl import load_workbook
            except ImportError:
                return
            xlsx = Path(tmp) / "p.xlsx"
            self.assertTrue(gs.gravar_xlsx(linhas, xlsx))
            ws = load_workbook(xlsx).active
            valores = {ws.cell(1, c).value: ws.cell(2, c) for c in range(1, ws.max_column + 1)}
            self.assertEqual(valores["Nome do produto"].value, "'=CMD|' /C CALC'!A0")
            self.assertEqual(valores["Nome do produto"].data_type, "s")  # texto, não fórmula
            self.assertEqual(valores["Legenda Instagram"].value, "'@marca")
            self.assertEqual(valores["Valor Tabela 1"].value, 77.99)  # número continua número
            self.assertEqual(valores["Saldo Estoque"].value, 12)
            self.assertEqual(valores["Ativo"].value, "Sim")

    def test_pacote_com_numeros_e_resumo(self):
        cad = {"pedido": {"numero": "T1", "moeda": None, "cotacao": "0,7745", "frete": "1.500", "fator": "10.5", "totalDocumento": "R$ 1.234,50"},
               "itens": [self.item(precoOrigem="4,5", quantidade="0", fator="12"),
                         self.item(linha=2, referencia="BR_2611002", recompraCandidatas=["BR_2609001"], quantidade=None)]}
        pacote = json.loads(json.dumps(cad))
        gs.normalizar_numeros(pacote)
        self.assertEqual(
            [pacote["pedido"][k] for k in ("cotacao", "frete", "fator", "totalDocumento")], [0.7745, 1500, 10.5, 1234.5]
        )
        self.assertEqual([pacote["itens"][0][k] for k in ("precoOrigem", "quantidade", "fator")], [4.5, 0, 12])
        self.assertIsNone(pacote["itens"][1]["quantidade"])
        linhas = [gs.linha_up(i, self.tax, self.pol, {}) for i in cad["itens"]]
        md = gs.resumo_md(cad, linhas)
        self.assertIn("moeda não identificada", md)
        self.assertIn("a confirmar: 1", md)
        self.assertIn("- Linha 2 (GSH747A): pode ser BR_2609001", md)
        self.assertIn("(recompra a confirmar no app; fora da planilha)", md)
        self.assertIn("Linha 1: quantidade 0", md)
        self.assertIn("Linha 2: sem quantidade", md)

    def test_codigo_de_barras_so_o_do_up(self):
        self.assertEqual(gs.linha_up(self.item(), self.tax, self.pol, {})["codigoBarras"], "")  # peça nova: o UP gera
        rec = self.item(codigoBarras="9000000000018", codigoBarrasOrigem="up")
        self.assertEqual(gs.linha_up(rec, self.tax, self.pol, {})["codigoBarras"], "9000000000018")
        app_ean = self.item(codigoBarras="9100000000015", codigoBarrasOrigem="app")
        self.assertEqual(gs.linha_up(app_ean, self.tax, self.pol, {})["codigoBarras"], "")
        self.assertEqual(gs.linha_up(app_ean, self.tax, self.pol, {"origemCodigoBarras": "app"})["codigoBarras"], "9100000000015")


class TestApp(unittest.TestCase):
    def test_divide_em_partes(self):
        itens = [{"linha": i, "foto": "x" * 1000} for i in range(10)]
        partes = app.dividir(itens, limite=3500)
        self.assertEqual(sum(len(p) for p in partes), 10)
        self.assertTrue(all(len(json.dumps(p)) < 3500 + 1100 for p in partes))
        self.assertEqual(app.dividir([]), [[]])


if __name__ == "__main__":
    unittest.main()
