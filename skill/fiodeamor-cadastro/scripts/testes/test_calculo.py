"""calcular.py: custos e preços gravados no cadastro.json, alertas preservados e resumo do pedido."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calcular  # noqa: E402
from fiodeamor.calculo import ErroCadastro, calcular_cadastro, numero  # noqa: E402


def cadastro_exemplo(**pedido):
    return {
        "formato": "fiodeamor-cadastro",
        "versao": 1,
        "pedido": {"numero": "T1", "moeda": "CNY", "cotacao": 1.0, "frete": None, "fator": None, **pedido},
        "itens": [
            {"linha": 1, "precoOrigem": 10, "quantidade": 60, "tipo": "brinco", "material": "semijoia",
             "alertas": ["Confira a cor", "Fator ×5 abaixo do mínimo da loja (×10)."]},
            {"linha": 2, "precoOrigem": 10, "quantidade": 40, "fator": 12, "ncm": "99999999"},
            {"linha": 3, "precoOrigem": 25, "quantidade": 0, "precoManual": 149.9},
        ],
    }


class TestCalcularCadastro(unittest.TestCase):
    def test_frete_fator_e_campos_gravados(self):
        cad = cadastro_exemplo(frete=200)  # mercadoria R$ 1.000 → frete 20% sobre cada peça
        r = calcular_cadastro(cad)
        a, b, c = cad["itens"]
        self.assertEqual((a["custoProdutoBrl"], a["custoAdicionalBrl"], a["custoTotalBrl"]), (10, 2, 12))
        self.assertEqual((a["fatorAplicado"], a["precoVenda"]), (10, 120.99))
        self.assertEqual(a["precos"]["consignado"], 120.99)
        self.assertEqual((b["fatorAplicado"], b["precoVenda"]), (12, 144.99))  # fator da peça vence o padrão
        self.assertEqual((c["custoTotalBrl"], c["precoVenda"]), (30, 149.9))  # preço manual vence tudo
        self.assertEqual(a["ncm"], "71171900")
        self.assertEqual(b["ncm"], "99999999")  # NCM já informado é mantido
        # Alertas que não são de preço continuam; os de preço são refeitos.
        self.assertEqual(a["alertas"], ["Confira a cor"])
        self.assertEqual(r["pecas"], 100)
        self.assertEqual(r["mercadoriaBrl"], 1000)
        self.assertEqual((r["freteBrl"], r["fretePct"]), (200, 20))
        self.assertEqual(r["custoTotal"], 1200)
        self.assertEqual(r["vendaPotencial"], 13059)  # 60 × 120,99 + 40 × 144,99
        self.assertEqual(r["fatorMedio"], 10.88)  # markup médio = venda ÷ custo

    def test_fator_do_pedido_e_alerta_minimo(self):
        cad = cadastro_exemplo(fator=8)
        calcular_cadastro(cad)
        a = cad["itens"][0]
        self.assertEqual((a["fatorAplicado"], a["precoVenda"]), (8, 80.99))
        self.assertEqual(a["alertas"], ["Confira a cor", "Fator ×8 abaixo do mínimo da loja (×10)."])

    def test_falta_cotacao(self):
        with self.assertRaises(ErroCadastro):
            calcular_cadastro(cadastro_exemplo(cotacao=None))

    def test_brl_usa_cotacao_1(self):
        cad = cadastro_exemplo(moeda="BRL", cotacao=None)
        r = calcular_cadastro(cad)
        self.assertEqual(cad["pedido"]["cotacao"], 1)
        self.assertEqual(r["cenario"], "compra_importador_nacional")

    def test_numero(self):
        self.assertEqual(numero("0,7745"), 0.7745)
        self.assertEqual(numero("R$ 1.234,56"), 1234.56)
        self.assertEqual(numero("1.500"), 1500)
        self.assertEqual(numero("10.5"), 10.5)
        self.assertIsNone(numero(""))
        self.assertIsNone(numero(None))


class TestCalcularLinhaDeComando(unittest.TestCase):
    def test_grava_de_volta_e_resumo_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "cadastro.json"
            cad = cadastro_exemplo(cotacao=None)
            arq.write_text(json.dumps(cad), encoding="utf-8")
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                codigo = calcular.main([str(arq), "--cotacao", "1,0", "--frete", "200", "--fator", "10", "--json"])
            self.assertEqual(codigo, 0)
            resumo = json.loads(saida.getvalue())
            self.assertEqual(resumo["custoTotal"], 1200)
            gravado = json.loads(arq.read_text(encoding="utf-8"))
            self.assertEqual(gravado["pedido"]["frete"], 200)
            self.assertEqual(gravado["pedido"]["fator"], 10)
            self.assertEqual(gravado["pedido"]["cotacaoFonte"], "Informada manualmente")
            self.assertEqual(gravado["itens"][0]["precoVenda"], 120.99)

    def test_sem_cotacao_sai_com_erro(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "cadastro.json"
            arq.write_text(json.dumps(cadastro_exemplo(cotacao=None)), encoding="utf-8")
            erro = io.StringIO()
            with contextlib.redirect_stderr(erro):
                self.assertEqual(calcular.main([str(arq)]), 1)
            self.assertIn("Falta a cotação", erro.getvalue())


if __name__ == "__main__":
    unittest.main()
