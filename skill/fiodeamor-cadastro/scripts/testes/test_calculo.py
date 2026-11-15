"""calcular.py: custos e preços gravados no cadastro.json, alertas preservados e resumo do pedido.

Expectativas que mudaram com a escada de preços: 120 → 119,99 (era 120,99), 144 → 139,99 (era 144,99),
80 → 79,99 (era 80,99), venda potencial 12.799 (era 13.059), markup médio 10,67 (era 10,88).
Sem cotação o cálculo não falha mais: os preços ficam pendentes (com aviso) e calcular.py sai com código 2.
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calcular  # noqa: E402
from fiodeamor.calculo import calcular_cadastro, ler_quantidade, numero, quantidade  # noqa: E402


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
        self.assertEqual((a["fatorAplicado"], a["precoVenda"]), (10, 119.99))  # 120 na escada
        self.assertEqual(a["precos"]["consignado"], 119.99)
        self.assertEqual((b["fatorAplicado"], b["precoVenda"]), (12, 139.99))  # fator da peça vence o padrão; 144 → 139,99
        self.assertEqual((c["custoTotalBrl"], c["precoVenda"]), (30, 149.9))  # preço manual vence tudo
        self.assertEqual(a["ncm"], "71171900")
        self.assertEqual(b["ncm"], "99999999")  # NCM já informado é mantido
        # Alertas que não são de preço continuam; os de preço são refeitos.
        self.assertEqual(a["alertas"], ["Confira a cor"])
        self.assertEqual(r["pecas"], 100)
        self.assertEqual(r["mercadoriaBrl"], 1000)
        self.assertEqual((r["freteBrl"], r["fretePct"]), (200, 20))
        self.assertEqual(r["custoTotal"], 1200)
        self.assertEqual(r["vendaPotencial"], 12799)  # 60 × 119,99 + 40 × 139,99
        self.assertEqual(r["fatorMedio"], 10.67)  # markup médio = venda ÷ custo
        self.assertFalse(r["cotacaoPendente"])
        self.assertEqual(r["avisos"], ["Linha 3: quantidade 0: a peça fica com estoque 0 (não vira 1); confira no documento."])

    def test_fator_do_pedido_e_alerta_minimo(self):
        cad = cadastro_exemplo(fator=8)
        calcular_cadastro(cad)
        a = cad["itens"][0]
        self.assertEqual((a["fatorAplicado"], a["precoVenda"]), (8, 79.99))
        self.assertEqual(a["alertas"], ["Confira a cor", "Fator ×8 abaixo do mínimo da loja (×10)."])

    def test_falta_cotacao_deixa_precos_pendentes(self):
        # A cotação nunca vira 1: sem ela, custos e preços ficam vazios (pendentes), com aviso.
        cad = cadastro_exemplo(cotacao=None, dataCompra="2026-09-26")
        cad["itens"][0].update(precoVenda=99.99, custoTotalBrl=9, precos={"consignado": 99.99})  # cálculo antigo
        r = calcular_cadastro(cad)
        self.assertTrue(r["cotacaoPendente"])
        self.assertTrue(r["avisos"][0].startswith("Falta a cotação do pedido (CNY → R$): preços pendentes"))
        self.assertIn("ptax.py 2026-09-26 --moeda CNY", r["avisos"][0])
        a, _, c = cad["itens"]
        self.assertEqual([a[k] for k in ("custoTotalBrl", "precoVenda", "precos", "fatorAplicado")], [None, None, None, None])
        # Alertas de preço antigos saem; entra o "Sem cotação" (o app usa os mesmos textos e os refaz no recálculo).
        self.assertEqual(a["alertas"], ["Confira a cor", "Sem cotação: preço pendente."])
        # Preço manual não depende da cotação: continua valendo, só o custo fica pendente.
        self.assertEqual((c["precoVenda"], c["custoTotalBrl"], c["alertas"]), (149.9, None, ["Sem cotação: custo pendente."]))
        self.assertEqual((r["vendaPotencial"], r["custoTotal"], r["cotacao"]), (0, 0, 0))  # a peça manual tem quantidade 0
        self.assertIsNone(cad["pedido"]["cotacao"])
        for moeda in ("USD", "usd"):
            self.assertTrue(calcular_cadastro(cadastro_exemplo(moeda=moeda, cotacao=None))["cotacaoPendente"])
        self.assertTrue(calcular_cadastro(cadastro_exemplo(cotacao="0"))["cotacaoPendente"])

    def test_moeda_nao_identificada(self):
        cad = cadastro_exemplo(moeda=None, cotacao=None)
        r = calcular_cadastro(cad)
        self.assertTrue(r["cotacaoPendente"])
        self.assertIsNone(r["moeda"])
        self.assertTrue(r["avisos"][0].startswith("Moeda e cotação pendentes"))
        self.assertTrue(r["avisos"][1].startswith("Moeda do pedido não identificada"))
        # Com a cotação informada, calcula e continua avisando da moeda.
        r = calcular_cadastro(cadastro_exemplo(moeda=None, cotacao=1))
        self.assertFalse(r["cotacaoPendente"])
        self.assertTrue(r["avisos"][0].startswith("Moeda do pedido não identificada"))

    def test_numeros_escritos_como_texto(self):
        cad = cadastro_exemplo(cotacao="1,0", frete="R$ 200,00", fator="10")
        cad["itens"][0].update(precoOrigem="10,00", quantidade="60")
        cad["itens"][1].update(precoOrigem="R$ 10", fator="12")
        r = calcular_cadastro(cad)
        self.assertEqual((r["pecas"], r["mercadoriaBrl"], r["freteBrl"]), (100, 1000, 200))
        self.assertEqual(cad["itens"][1]["precoVenda"], 139.99)
        # O bug antigo: "0.775" virava 775. Cotação nunca tem milhar.
        cad = cadastro_exemplo(cotacao="0.775")
        calcular_cadastro(cad)
        self.assertEqual(cad["itens"][0]["custoProdutoBrl"], 7.75)

    def test_quantidade_zero_continua_zero(self):
        cad = cadastro_exemplo()
        cad["itens"][0]["quantidade"] = 0
        cad["itens"][1]["quantidade"] = None  # sem quantidade: conta 1, como no app
        r = calcular_cadastro(cad)
        self.assertEqual(r["pecas"], 1)
        self.assertEqual(
            r["avisos"],
            [
                "Linha 1: quantidade 0: a peça fica com estoque 0 (não vira 1); confira no documento.",
                "Linha 2: sem quantidade: considerei 1 peça; confira no documento.",
                "Linha 3: quantidade 0: a peça fica com estoque 0 (não vira 1); confira no documento.",
            ],
        )
        self.assertEqual(cad["itens"][0]["quantidade"], 0)  # o cadastro não é alterado
        self.assertEqual([quantidade(v) for v in (0, "0", None, "", "12", "1.000", 2.5, "abc", -3)], [0, 0, 1, 1, 12, 1000, 3, 1, 0])
        self.assertIsNone(ler_quantidade(12)[1])

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
        self.assertEqual(numero("0.775"), 0.775)  # era 775
        self.assertEqual(numero("5.432", milhar=False), 5.432)
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
            self.assertEqual(gravado["itens"][0]["precoVenda"], 119.99)

    def _rodar(self, cad: dict, *opcoes: str, saida: io.StringIO | None = None) -> tuple[int, dict, str]:
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "cadastro.json"
            arq.write_text(json.dumps(cad), encoding="utf-8")
            saida, erro = saida if saida is not None else io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
                codigo = calcular.main([str(arq), *opcoes])
            return codigo, json.loads(arq.read_text(encoding="utf-8")), erro.getvalue()

    def test_sem_cotacao_precos_pendentes_codigo_2(self):
        texto = io.StringIO()
        codigo, gravado, _ = self._rodar(cadastro_exemplo(cotacao=None), "--sem-busca", saida=texto)
        self.assertEqual(codigo, 2)
        self.assertIn("Cotação: PENDENTE", texto.getvalue())
        self.assertIn("Falta a cotação", texto.getvalue())
        self.assertIsNone(gravado["pedido"]["cotacao"])  # nunca vira 1
        self.assertIsNone(gravado["itens"][0]["precoVenda"])
        json_saida = io.StringIO()
        codigo, _, erro = self._rodar(cadastro_exemplo(cotacao=None), "--sem-busca", "--json", saida=json_saida)
        self.assertEqual(codigo, 2)
        self.assertIn("Falta a cotação", erro)
        self.assertTrue(json.loads(json_saida.getvalue())["cotacaoPendente"])

    def test_sem_cotacao_busca_a_ptax_da_data_da_compra(self):
        chamadas = []

        def falsa(moeda, data, tipo):
            chamadas.append((moeda, data, tipo))
            return {"moeda": moeda, "cotacao": 0.7745, "data": "2026-09-25", "fonte": "PTAX Banco Central (boletim de fechamento)", "tipo": tipo}, [], False

        original = calcular.buscar_cotacao
        calcular.buscar_cotacao = falsa
        try:
            codigo, gravado, erro = self._rodar(cadastro_exemplo(cotacao=None, dataCompra="2026-09-26"))
            self.assertEqual(codigo, 0)
            self.assertEqual(chamadas, [("CNY", "2026-09-26", "venda")])
            self.assertEqual((gravado["pedido"]["cotacao"], gravado["pedido"]["cotacaoData"]), (0.7745, "2026-09-25"))
            self.assertIn("Cotação buscada: CNY 0,7745", erro)
            # Sem a data da compra não dá para buscar: fica pendente.
            chamadas.clear()
            codigo, _, _ = self._rodar(cadastro_exemplo(cotacao=None))
            self.assertEqual((codigo, chamadas), (2, []))
            # Busca que falha (rede bloqueada): pendente, com o motivo.
            calcular.buscar_cotacao = lambda moeda, data, tipo: (None, ["sem conexão com www4.bcb.gov.br"], True)
            codigo, gravado, erro = self._rodar(cadastro_exemplo(cotacao=None, dataCompra="2026-09-26"))
            self.assertEqual(codigo, 2)
            self.assertIn("Não consegui buscar a PTAX de CNY para 2026-09-26", erro)
            self.assertIsNone(gravado["pedido"]["cotacao"])
        finally:
            calcular.buscar_cotacao = original

    def test_moeda_pela_opcao_ou_pela_ptax(self):
        codigo, gravado, _ = self._rodar(cadastro_exemplo(moeda=None, cotacao=None), "--moeda", "brl")
        self.assertEqual((codigo, gravado["pedido"]["moeda"], gravado["pedido"]["cotacao"]), (0, "BRL", 1))
        with tempfile.TemporaryDirectory() as tmp:
            ptax = Path(tmp) / "ptax.json"
            ptax.write_text(json.dumps({"moeda": "USD", "cotacao": 5.1991, "data": "2026-09-25", "fonte": "PTAX"}), encoding="utf-8")
            codigo, gravado, _ = self._rodar(cadastro_exemplo(moeda=None, cotacao=None), "--ptax", str(ptax))
            self.assertEqual((codigo, gravado["pedido"]["moeda"], gravado["pedido"]["cotacao"]), (0, "USD", 5.1991))
            codigo, _, erro = self._rodar(cadastro_exemplo(moeda="CNY", cotacao=None), "--ptax", str(ptax))
            self.assertEqual(codigo, 1)
            self.assertIn("A cotação é de USD, mas o pedido está em CNY", erro)
        codigo, _, erro = self._rodar(cadastro_exemplo(), "--moeda", "EUR")
        self.assertEqual(codigo, 1)


if __name__ == "__main__":
    unittest.main()
