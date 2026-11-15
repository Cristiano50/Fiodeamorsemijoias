"""Leitura das linhas e do cabeçalho do pedido (tests/regras.test.ts) e agrupamento do texto por faixa/coluna.

Os vetores comuns com o app (tests/vetores/*.json) rodam em test_vetores.py. Expectativas que mudaram com eles:
o código repetido antes do preço não é mais especificação; cabeçalho sem marca de moeda dá moeda None (era CNY).
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fiodeamor.extracao import Caixa, Trecho, ler_cabecalho, ler_linha, ler_total, montar_linhas, texto_da_faixa  # noqa: E402


class TestLerLinha(unittest.TestCase):
    def test_pedido_chines_preco_vezes_quantidade(self):
        l = ler_linha("1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120")
        self.assertEqual(
            [l.get("codigo"), l.get("descricao"), l.get("especificacao"), l.get("preco"), l.get("quantidade")],
            ["GSH747A", "耳钉-21#", "G", 10, 12],
        )
        self.assertIsInstance(l["quantidade"], int)
        v = ler_linha("34 | SH5122A | 耳钉-滴油款 | SH5122A | MR粉油 | 4.5 | 13 | 58.5")
        self.assertEqual(v["especificacao"], "MR粉油")
        self.assertEqual(v["preco"], 4.5)

    def test_codigo_composto_e_quebra_de_linha(self):
        l = ler_linha("67 | YL576A | 三件套-白锆-18+43CM+延长扣 | YL576A/LHH1154AS | 14K | 57 | 6 | 342")
        self.assertEqual((l["codigo"], l["especificacao"], l["preco"], l["quantidade"]), ("YL576A", "14K", 57, 6))

    def test_coluna_de_especificacao_vazia(self):
        # Sem a coluna 多规格, a célula antes dos números é o próprio código repetido: não é especificação
        # (antes virava a "especificação" MR336A).
        l = ler_linha("5 | MR336A | MR混款 | MR336A | 12.5 | 11 | 137.5")
        self.assertNotIn("especificacao", l)
        self.assertEqual((l["codigo"], l["preco"], l["quantidade"], l["descricao"]), ("MR336A", 12.5, 11, "MR混款"))
        self.assertEqual(ler_linha("só texto | 耳环"), {"descricao": "耳环"})

    def test_especificacao_chinesa_e_tamanho(self):
        self.assertEqual(ler_linha("4 | ABC126D | 戒指 | 金色 | 6.5 | 12 | 78")["especificacao"], "金色")
        self.assertEqual(ler_linha("6 | ABC127E | 戒指 | 16 | 6.5 | 10 | 65")["especificacao"], "16")
        self.assertNotIn("especificacao", ler_linha("8 | ABC128F | 手链-爱心 | 10 | 12 | 120"))  # é a descrição
        self.assertEqual(ler_linha("1 | ABC123A | 耳钉 | ROSE GOLD 14K | 10 | 12 | 120")["especificacao"], "ROSE GOLD 14K")

    def test_largura_total_vira_ascii(self):
        l = ler_linha("1 | ＡＢＣ１２３Ａ | 耳钉 | Ｇ | １０ | １２ | １２０")
        self.assertEqual((l["codigo"], l["especificacao"], l["preco"], l["quantidade"]), ("ABC123A", "G", 10, 12))

    def test_conta_que_nao_fecha_nao_vira_preco(self):
        l = ler_linha("1 | AB123 | 10 | 12 | 999")
        self.assertNotIn("preco", l)
        self.assertEqual(l["codigo"], "AB123")


class TestCabecalho(unittest.TestCase):
    def test_data_numero_moeda(self):
        c = ler_cabecalho("客户:FA\n下单时间2026-09-26 | 单号:X260926017")
        # Sem ¥/RMB/元/人民币 (nem US$ ou R$) não há como saber a moeda: None (antes, o chinês fazia virar CNY).
        self.assertEqual(c, {"data": "2026-09-26", "numero": "X260926017", "moeda": None})
        self.assertEqual(ler_cabecalho("单号:X1 合计 ¥8225.9")["moeda"], "CNY")

    def test_outros_formatos(self):
        self.assertEqual(ler_cabecalho("Pedido: 12345 em 2026/3/7 total R$ 10"), {"data": "2026-03-07", "numero": "12345", "moeda": "BRL"})
        self.assertEqual(ler_cabecalho("Order #AB-99 USD")["moeda"], "USD")
        self.assertEqual(ler_cabecalho("合计 ￥ 120 · 美金 30")["moeda"], "USD")  # dólar tem prioridade
        self.assertIsNone(ler_cabecalho("USDT 10 RMB3")["moeda"])  # marca dentro de outra palavra não conta

    def test_total_do_documento(self):
        self.assertEqual(ler_total("合计 | 858 | 8225.9\n订单优惠:0 | 应收:8225.9 | 实收:0"), 8225.9)
        self.assertEqual(ler_total("TOTAL: R$ 1,234.50"), 1234.5)
        self.assertEqual(ler_total("合计 | 10 | 99.5"), 99.5)
        self.assertIsNone(ler_total("nada aqui"))


class TestFaixas(unittest.TestCase):
    def test_montar_linhas_e_texto_da_faixa(self):
        def t(x, y, texto, largura=10):
            return Trecho(x=x, xc=x + largura / 2, y_topo=y - 7, y_base=y, texto=texto)

        trechos = [
            t(70, 140, "1"), t(110, 140, "GSH747A", 28), t(200, 136, "耳环-三个尺寸", 40), t(210, 145, "混打", 14),
            t(340, 140, "G"), t(410, 140, "10"), t(460, 140, "12"), t(508, 140, "120"),
            t(70, 300, "2"),  # outra linha da tabela, fora da faixa
        ]
        caixa = Caixa(148, 113, 196, 162)
        self.assertEqual(texto_da_faixa(trechos, caixa), "1 | GSH747A | 耳环-三个尺寸混打 | G | 10 | 12 | 120")
        self.assertEqual(texto_da_faixa(trechos, Caixa(0, 500, 10, 600)), "")
        self.assertEqual(montar_linhas([t(50, 10, "b"), t(10, 11, "a"), t(10, 30, "c")]), ["a | b", "c"])


try:
    from PIL import Image  # noqa: F401

    TEM_PILLOW = True
except Exception:  # noqa: BLE001 — ausente ou instalado errado
    TEM_PILLOW = False


@unittest.skipUnless(TEM_PILLOW, "Pillow não instalado")
class TestFotos(unittest.TestCase):
    def test_fotos_viram_paginas_com_pedido_vazio(self):
        import extrair_pdf
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            Image.new("RGBA", (3000, 2000), (200, 100, 50, 128)).save(pasta / "catalogo.png")
            cadastro, info = extrair_pdf.gerar_cadastro([pasta / "catalogo.png"], pasta / "saida")
            self.assertEqual(cadastro["itens"], [])
            self.assertEqual(cadastro["paginas"], ["paginas/pagina-001.jpg"])
            self.assertEqual(cadastro["pedido"]["arquivoNome"], "catalogo.png")
            self.assertIsNone(cadastro["pedido"]["numero"])
            with Image.open(pasta / "saida" / "paginas" / "pagina-001.jpg") as img:
                self.assertEqual((img.format, img.size), ("JPEG", (2000, 1333)))
            with self.assertRaises(ValueError):
                extrair_pdf.gerar_cadastro([pasta / "planilha.xlsx"], pasta / "saida")


if __name__ == "__main__":
    unittest.main()
