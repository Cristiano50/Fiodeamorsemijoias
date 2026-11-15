"""Pedido de exemplo X260926017 (PDF real do fornecedor): extração + cálculo, com os números conferidos no app.

O PDF fica em ``amostras/pedido-X260926017/pedido.pdf``, que não vai para o GitHub; sem ele o teste é pulado.
Outro caminho pode ser indicado na variável de ambiente ``FIODEAMOR_PEDIDO_EXEMPLO``.

Expectativas que mudaram (revisão de 15/11/2026): o documento não tem marca de moeda (¥/RMB/元…), então a moeda
fica None com aviso (tests/vetores/cabecalho.json; antes o chinês fazia virar CNY); com a escada de preços, a venda
potencial com fator 10 e sem frete passou de 64.138,42 para 63.976,42 e a peça de ¥40,50 com frete de R$ 850 passou
de 355,99 para 349,99 (custo 35,55 × 10 = 355,50 → 349,99). Esses números precisam bater com o app.
"""

import copy
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# testes → scripts → fiodeamor-cadastro → skill → raiz do repositório
PDF = Path(
    os.environ.get("FIODEAMOR_PEDIDO_EXEMPLO")
    or Path(__file__).resolve().parents[4] / "amostras" / "pedido-X260926017" / "pedido.pdf"
)


TEM_PYMUPDF = importlib.util.find_spec("pymupdf") is not None


@unittest.skipUnless(TEM_PYMUPDF, "PyMuPDF não instalado (pip install pymupdf)")
@unittest.skipUnless(PDF.is_file(), f"PDF de exemplo não encontrado ({PDF})")
class TestPedidoExemplo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import extrair_pdf

        cls.tmp = tempfile.TemporaryDirectory()
        cls.pasta = Path(cls.tmp.name)
        cls.cadastro, cls.info = extrair_pdf.gerar_cadastro([PDF], cls.pasta)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_extracao_bate_com_o_documento(self):
        self.assertEqual(self.info["linhas"], 72)
        self.assertEqual(self.info["pecas"], 858)
        self.assertEqual(self.info["totalLido"], 8225.9)
        self.assertEqual(self.info["totalDocumento"], 8225.9)
        self.assertTrue(self.info["confere"])
        # Único aviso: a moeda, que o documento não mostra (a skill pergunta à pessoa).
        self.assertEqual(len(self.info["avisos"]), 1)
        self.assertTrue(self.info["avisos"][0].startswith("Moeda não identificada"))

    def test_pedido(self):
        p = self.cadastro["pedido"]
        self.assertEqual(p["numero"], "X260926017")
        self.assertTrue(p["fornecedor"].endswith("首饰有限公司"))  # nome real fora do repositório público
        self.assertEqual(p["dataCompra"], "2026-09-26")
        self.assertIsNone(p["moeda"])  # sem ¥/RMB/元/人民币 no documento: não adivinha pelo chinês
        self.assertEqual(p["totalDocumento"], 8225.9)
        self.assertEqual(p["arquivoNome"], "pedido.pdf")
        self.assertIn("单号:X260926017", p["cabecalho"])
        self.assertEqual(p["colunas"], "序 | 条码 | 图片 | 货名 | 货号 | 多规格 | 单价 | 数量 | 金额")
        self.assertEqual(self.cadastro["formato"], "fiodeamor-cadastro")

    def test_itens_e_fotos(self):
        primeiro = self.cadastro["itens"][0]
        self.assertEqual(
            {k: primeiro[k] for k in ("linha", "textoOriginal", "codigoFornecedor", "especificacao", "descricaoOriginal",
                                       "quantidade", "precoOrigem", "foto")},
            {"linha": 1, "textoOriginal": "1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120",
             "codigoFornecedor": "GSH747A", "especificacao": "G", "descricaoOriginal": "耳钉-21#",
             "quantidade": 12, "precoOrigem": 10, "foto": "fotos/linha-001.jpg"},
        )
        from PIL import Image

        for it in self.cadastro["itens"]:
            caminho = self.pasta / it["foto"]
            self.assertTrue(caminho.is_file(), caminho)
        with Image.open(self.pasta / "fotos" / "linha-001.jpg") as img:
            self.assertEqual(img.format, "JPEG")
            self.assertGreaterEqual(max(img.size), 850)
        json.dumps(self.cadastro, ensure_ascii=False)  # serializável

    def test_venda_potencial_sem_frete_fator_10(self):
        from fiodeamor.calculo import calcular_cadastro

        cad = copy.deepcopy(self.cadastro)
        cad["pedido"].update(moeda="CNY", cotacao=0.7745, frete=None, fator=10)
        r = calcular_cadastro(cad)
        self.assertEqual(r["vendaPotencial"], 63976.42)  # escada de preços (era 64.138,42 com ",99 para cima")
        self.assertEqual(r["mercadoriaBrl"], 6370.96)
        self.assertEqual(r["linhas"], 72)
        self.assertEqual(r["pecas"], 858)

    def test_frete_850(self):
        from fiodeamor.calculo import calcular_cadastro

        cad = copy.deepcopy(self.cadastro)
        cad["pedido"].update(moeda="CNY", cotacao=0.7745, frete=850, fator=None)
        r = calcular_cadastro(cad)
        self.assertEqual(r["fretePct"], 13.34)
        peca = next(i for i in cad["itens"] if i["precoOrigem"] == 40.5)
        self.assertEqual(peca["custoTotalBrl"], 35.55)
        self.assertEqual(peca["precoVenda"], 349.99)  # 355,50 na escada (era 355,99)
        self.assertEqual(peca["fatorAplicado"], 10)


if __name__ == "__main__":
    unittest.main()
