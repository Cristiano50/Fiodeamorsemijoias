"""Números escritos como texto (porta de lerNumeroBr) e células seguras (porta de src/lib/csv.ts).

Os primeiros casos são os mesmos de tests/utilitarios.test.ts do app.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fiodeamor.numeros import ler_numero_br, texto_numero_js  # noqa: E402
from fiodeamor.planilha import celula_csv, celula_planilha, texto_seguro_planilha  # noqa: E402


class TestLerNumeroBr(unittest.TestCase):
    def test_casos_do_app(self):
        # tests/utilitarios.test.ts — "Números digitados: vírgula, ponto, milhar e moeda"
        self.assertEqual(ler_numero_br("850,50"), 850.5)
        self.assertEqual(ler_numero_br("850.50"), 850.5)
        self.assertEqual(ler_numero_br("850.5"), 850.5)
        self.assertEqual(ler_numero_br("1.234,56"), 1234.56)
        self.assertEqual(ler_numero_br("1,234.56"), 1234.56)
        self.assertEqual(ler_numero_br("R$ 1.234"), 1234)
        self.assertEqual(ler_numero_br("12.345.678"), 12345678)
        self.assertEqual(ler_numero_br("0,7745"), 0.7745)
        self.assertEqual(ler_numero_br("0.775"), 0.775)
        self.assertEqual(ler_numero_br("5.432", milhar=False), 5.432)
        self.assertEqual(ler_numero_br("5.432"), 5432)
        self.assertEqual(ler_numero_br("10"), 10)
        self.assertEqual(ler_numero_br("-3,5"), -3.5)
        self.assertIsNone(ler_numero_br(""))
        self.assertIsNone(ler_numero_br("abc"))
        self.assertIsNone(ler_numero_br("1,2,3"))
        self.assertEqual(ler_numero_br(12.5), 12.5)
        # O bug do frete: "850,50" mostrado e lido de novo continua 850,5 (não 8.505).
        self.assertEqual(ler_numero_br("850,50"), 850.5)

    def test_moedas_espacos_e_negativos(self):
        self.assertEqual(ler_numero_br("¥ 8.225,90"), 8225.9)
        self.assertEqual(ler_numero_br("CN¥12"), 12)
        self.assertEqual(ler_numero_br("US$ 450.00"), 450)
        self.assertEqual(ler_numero_br("rmb 3,5"), 3.5)
        self.assertEqual(ler_numero_br("1 234,5"), 1234.5)  # espaço que não quebra
        self.assertEqual(ler_numero_br("(1.234,50)"), -1234.5)
        self.assertEqual(ler_numero_br("(-5)"), 5)  # como no app: parênteses e "-" se anulam
        self.assertIsNone(ler_numero_br("-(5)"))  # "-" fora dos parênteses: não é número (como no app)
        self.assertIsNone(ler_numero_br("1.2.3"))
        self.assertIsNone(ler_numero_br("１２"))  # dígitos de largura total não são número (como no app)
        self.assertIsNone(ler_numero_br(None))
        self.assertIsNone(ler_numero_br(True))
        self.assertIsNone(ler_numero_br(float("nan")))

    def test_ponto_sozinho(self):
        # Milhar só no formato 1.234 (grupos de 3) e nunca começando por 0; com milhar=False, sempre decimal.
        self.assertEqual(ler_numero_br("1.500"), 1500)
        self.assertEqual(ler_numero_br("1.5"), 1.5)
        self.assertEqual(ler_numero_br("0.500"), 0.5)
        self.assertEqual(ler_numero_br("3.1415"), 3.1415)
        self.assertEqual(ler_numero_br("1.500", milhar=False), 1.5)
        self.assertEqual(ler_numero_br(".5"), 0.5)

    def test_texto_numero_js(self):
        self.assertEqual(
            [texto_numero_js(v) for v in (10.0, 8.36, 0.1 + 0.2, -0.0, 1e21, 1e-7, 1e16, 0.000001, 5)],
            ["10", "8.36", "0.30000000000000004", "0", "1e+21", "1e-7", "10000000000000000", "0.000001", "5"],
        )


class TestCelulas(unittest.TestCase):
    def test_casos_do_app(self):
        # tests/utilitarios.test.ts — "CSV seguro: texto com cara de fórmula não vira fórmula no Excel"
        self.assertEqual(texto_seguro_planilha('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")")
        self.assertEqual(texto_seguro_planilha("+55 11"), "'+55 11")
        self.assertEqual(texto_seguro_planilha("BRINCO (SJ)"), "BRINCO (SJ)")
        self.assertEqual(celula_csv(-5), "-5")
        self.assertEqual(celula_csv(77.99), "77,99")
        self.assertEqual(celula_csv("a;b"), '"a;b"')
        self.assertEqual(celula_csv('diz "oi"'), '"diz ""oi"""')
        self.assertEqual(celula_csv(True), "Sim")
        self.assertEqual(celula_csv(None), "")

    def test_planilha(self):
        self.assertEqual(celula_planilha("=SOMA(A1)"), "'=SOMA(A1)")
        self.assertEqual(celula_planilha("@x"), "'@x")
        self.assertEqual(celula_planilha(12.5), 12.5)
        self.assertEqual(celula_planilha(False), "Não")
        self.assertEqual(celula_planilha(None), "")
        self.assertEqual(celula_planilha(float("inf")), "")


if __name__ == "__main__":
    unittest.main()
