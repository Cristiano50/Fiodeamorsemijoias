"""Testes de referencias.py, gerar_saidas.py e app.py (sem rede e sem o PDF de exemplo)."""
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
