"""PTAX: leitura do CSV do boletim de fechamento e comportamento sem rede (nenhum teste acessa a internet)."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ptax  # noqa: E402
from fiodeamor.cambio import ErroRede, boletim_bcb, buscar_cotacao, dias_uteis_ate, ler_boletim, url_boletim  # noqa: E402

CSV = (
    "25/09/2026;005;A;AFN;0,08004000;0,08030000;64,75000000;64,95000000\r\n"
    "25/09/2026;220;A;USD;5,19850000;5,19910000;1,00000000;1,00000000\r\n"
    "25/09/2026;795;A;CNY;0,77430000;0,77450000;6,71280000;6,71370000\r\n"
    "25/09/2026;978;B;EUR;5,92630000;5,92800000;1,14000000;1,14020000\r\n"
)


def _http_404(url):
    return urllib.error.HTTPError(url, 404, "Not Found", {}, None)


class TestBoletim(unittest.TestCase):
    def test_ler_csv(self):
        self.assertEqual(
            ler_boletim(CSV, "CNY"),
            {"moeda": "CNY", "cotacao": 0.7745, "data": "2026-09-25",
             "fonte": "PTAX Banco Central (boletim de fechamento)", "tipo": "venda"},
        )
        self.assertEqual(ler_boletim(CSV, "cny", "compra")["cotacao"], 0.7743)
        self.assertEqual(ler_boletim(CSV, "USD")["cotacao"], 5.1991)
        self.assertIsNone(ler_boletim(CSV, "XYZ"))

    def test_url(self):
        self.assertEqual(url_boletim("2026-09-25"), "https://www4.bcb.gov.br/Download/fechamento/20260925.csv")

    def test_volta_ate_o_ultimo_dia_util(self):
        pedidas = []

        def baixar(url, timeout):
            pedidas.append(url)
            if url.endswith("20260925.csv"):
                return CSV.encode()
            raise _http_404(url)

        c = boletim_bcb("CNY", "2026-09-27", baixar_=baixar)  # domingo → sábado → sexta
        self.assertEqual(c["data"], "2026-09-25")
        self.assertEqual([u[-12:] for u in pedidas], ["20260927.csv", "20260926.csv", "20260925.csv"])

    def test_rede_bloqueada(self):
        def baixar(url, timeout):
            raise ErroRede(f"sem conexão com {url.split('/')[2]} (Tunnel connection failed: 403 Forbidden)")

        cotacao, erros, bloqueada = buscar_cotacao("CNY", "2026-09-26", baixar_=baixar)
        self.assertIsNone(cotacao)
        self.assertTrue(bloqueada)
        self.assertEqual(len(erros), 3)

    def test_brl(self):
        cotacao, _, _ = buscar_cotacao("BRL", "2026-09-26", baixar_=None)
        self.assertEqual(cotacao["cotacao"], 1.0)

    def test_dias_uteis(self):
        self.assertEqual([d.isoformat() for d in dias_uteis_ate("2026-09-27", 3)], ["2026-09-25", "2026-09-24", "2026-09-23"])


class TestLinhaDeComando(unittest.TestCase):
    def test_csv_ja_baixado(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "boletim.csv"
            arq.write_text(CSV, encoding="utf-8")
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                self.assertEqual(ptax.main(["2026-09-26", "--moeda", "CNY", "--csv", str(arq)]), 0)
            self.assertEqual(json.loads(saida.getvalue())["cotacao"], 0.7745)

    def test_sem_rede_sai_com_codigo_2_e_url(self):
        original = ptax.buscar_cotacao
        ptax.buscar_cotacao = lambda moeda, data, tipo: (None, ["sem conexão com www4.bcb.gov.br"], True)
        try:
            saida, erro = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
                codigo = ptax.main(["2026-09-26", "--moeda", "CNY"])
        finally:
            ptax.buscar_cotacao = original
        self.assertEqual(codigo, 2)
        self.assertIn("https://www4.bcb.gov.br/Download/fechamento/20260925.csv", erro.getvalue())
        self.assertIn("rede deste ambiente parece bloqueada", erro.getvalue())
        dados = json.loads(saida.getvalue())
        self.assertIsNone(dados["cotacao"])
        self.assertEqual(dados["urlsCsv"][0], "https://www4.bcb.gov.br/Download/fechamento/20260925.csv")

    def test_data_invalida(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ptax.main(["26/09/2026"]), 1)


if __name__ == "__main__":
    unittest.main()
