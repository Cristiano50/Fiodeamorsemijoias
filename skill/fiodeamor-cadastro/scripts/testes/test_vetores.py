"""Vetores comuns com o app (tests/vetores/*.json): o app (TypeScript) e a skill (Python) têm de dar o mesmo resultado.

* especificacao.json — leitura da especificação/cor do fornecedor (ler_linha / lerLinha);
* cabecalho.json — moeda do documento (ler_cabecalho / lerCabecalho);
* escada.json — escada de preços (arredondar).

Os vetores ficam na raiz do repositório (não vão no ZIP da skill): sem eles, o teste é pulado.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fiodeamor import config  # noqa: E402
from fiodeamor.extracao import ler_cabecalho, ler_linha  # noqa: E402
from fiodeamor.precos import arredondar, calcular_preco  # noqa: E402

# testes → scripts → fiodeamor-cadastro → skill → raiz do repositório
VETORES = Path(__file__).resolve().parents[4] / "tests" / "vetores"


def carregar(nome: str) -> dict:
    return json.loads((VETORES / nome).read_text(encoding="utf-8"))


@unittest.skipUnless((VETORES / "escada.json").is_file(), f"vetores não encontrados ({VETORES})")
class TestVetores(unittest.TestCase):
    def test_especificacao(self):
        v = carregar("especificacao.json")
        self.assertGreater(len(v["casos"]), 10)
        for c in v["casos"]:
            with self.subTest(texto=c["texto"]):
                l = ler_linha(c["texto"])
                self.assertEqual(l.get("codigo"), c["codigo"])
                self.assertEqual(l.get("especificacao") or "", c["especificacao"])
                self.assertEqual(l.get("preco"), c["preco"])
                self.assertEqual(l.get("quantidade"), c["quantidade"])

    def test_moeda_do_cabecalho(self):
        for c in carregar("cabecalho.json")["casos"]:
            with self.subTest(texto=c["texto"]):
                self.assertEqual(ler_cabecalho(c["texto"])["moeda"], c["moeda"])

    def test_escada(self):
        v = carregar("escada.json")
        regra = {"modo": "escada", "minimo": v["minimo"], "centavos": 0.99, "degraus": v["degraus"]}
        pol = config.precificacao()
        # A política da skill (referencias/precificacao.json) usa a mesma escada dos vetores.
        self.assertEqual(pol["arredondamento"]["degraus"], v["degraus"])
        self.assertEqual(pol["arredondamento"]["minimo"], v["minimo"])
        for c in v["casos"]:
            with self.subTest(bruto=c["bruto"]):
                self.assertEqual(arredondar(c["bruto"], regra), c["preco"])
                self.assertEqual(arredondar(c["bruto"], pol["arredondamento"]), c["preco"])
                # Preço de venda com custo = bruto e fator 1 (o mínimo de fator só gera alerta).
                self.assertEqual(calcular_preco(c["bruto"], None, pol, fator_pedido=1)["preco"], c["preco"])


if __name__ == "__main__":
    unittest.main()
