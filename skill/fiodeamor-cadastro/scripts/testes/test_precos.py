"""Regras de preço, fator, frete e arredondamento — os mesmos casos de tests/regras.test.ts do app."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fiodeamor import config  # noqa: E402
from fiodeamor.precos import (  # noqa: E402
    arredondar,
    calcular_custos,
    calcular_preco,
    detalhar_custos,
    escolher_fator,
    r2,
    round_js,
    to_fixed,
    valores_do_cenario,
)

POL = config.precificacao()
FISCAL = config.fiscal()
COMPONENTES = FISCAL["custo_aquisicao"]["componentes"]
ZERADO = {c["id"]: 0 for c in COMPONENTES}


class TestArredondamento(unittest.TestCase):
    def test_terminar_em_99_com_minimo(self):
        regra = {"modo": "terminar_em", "centavos": 0.99}
        self.assertEqual(arredondar(22.99, regra), 22.99)
        self.assertEqual(arredondar(23.1, regra), 23.99)
        self.assertEqual(arredondar(23.0, regra), 23.99)
        self.assertEqual(arredondar(5, {"modo": "terminar_em", "centavos": 0.99, "minimo": 19.99}), 19.99)

    def test_minimo_da_politica_da_loja(self):
        self.assertEqual(arredondar(3.2, POL["arredondamento"]), 19.99)
        self.assertEqual(arredondar(3.2, POL["arredondamento"], aplicar_minimo=False), 3.99)

    def test_aritmetica_igual_ao_javascript(self):
        # Math.round arredonda 0,5 para cima (o round do Python iria para o par).
        self.assertEqual(round_js(0.5), 1.0)
        self.assertEqual(round_js(2.5), 3.0)
        self.assertEqual(round_js(-0.5), 0.0)
        self.assertEqual(r2(1.005), 1.01)  # com Number.EPSILON, como no app
        self.assertEqual(to_fixed(84.5), "85")


class TestFator(unittest.TestCase):
    def test_fator_do_pedido(self):
        r = calcular_preco(2.73, "brinco", POL, fator_pedido=10)
        self.assertEqual(r["fator"], 10)
        self.assertEqual(r["origemFator"], "fator do pedido")
        self.assertEqual(r["preco"], 27.99)
        self.assertEqual([a for a in r["alertas"] if a.startswith("Fator")], [])

    def test_pedido_em_branco_usa_fator_padrao(self):
        r = calcular_preco(5, "colar", POL)
        self.assertEqual(r["fator"], 10)
        self.assertEqual(r["origemFator"], "padrão")
        self.assertEqual(r["preco"], 50.99)

    def test_fator_da_peca_vence_e_preco_manual_vence_tudo(self):
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_manual=12, fator_pedido=10)["preco"], 120.99)
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_manual=12, fator_pedido=10)["origemFator"], "fator da peça")
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_pedido=10, preco_manual=149.9)["preco"], 149.9)

    def test_fator_abaixo_do_minimo_gera_alerta(self):
        # Exemplo do UP: custo 2,75 × 8,36 = R$ 22,99.
        r = calcular_preco(2.75, "brinco", POL, fator_pedido=8.36)
        self.assertEqual(r["preco"], 22.99)
        self.assertEqual(r["lucroPct"], 736)
        self.assertTrue(any("abaixo do mínimo" in a for a in r["alertas"]))
        self.assertIn("Fator ×8.36 abaixo do mínimo da loja (×10).", r["alertas"])

    def test_preco_manual_nao_alerta_fator_minimo(self):
        r = calcular_preco(2.75, "brinco", POL, fator_pedido=8.36, preco_manual=30)
        self.assertFalse(any(a.startswith("Fator") for a in r["alertas"]))

    def test_sem_custo_alerta(self):
        r = calcular_preco(0, None, POL)
        self.assertIn("Sem custo: confira preço de origem e cotação.", r["alertas"])

    def test_tabelas_de_preco(self):
        r = calcular_preco(8.78, "brinco", POL, fator_pedido=10)
        self.assertEqual(r["precos"], {"consignado": 87.99, "varejo": 87.99, "atacado_revenda": 52.99, "liquidacao": 61.99})

    def test_faixas_monotonicas(self):
        com_faixas = {**POL, "usar_faixas": True}
        anterior = 0.0
        c = 1.0
        while c <= 120:
            p = calcular_preco(c, None, com_faixas)["preco"]
            self.assertGreaterEqual(p, anterior, f"custo {c} gerou {p} < {anterior}")
            anterior = p
            c += 0.25

    def test_faixa_escolhida_e_piso(self):
        com_faixas = {**POL, "usar_faixas": True}
        e = escolher_fator(3.5, None, com_faixas)
        self.assertEqual((e["fator"], e["origem"], e["piso"]), (7.5, "faixa até 4", 24.0))
        self.assertEqual(escolher_fator(500, None, com_faixas)["origem"], "faixa até ∞")

    def test_fator_por_tipo(self):
        pol = {**POL, "fatores_por_tipo": {"colar": 12}}
        self.assertEqual(escolher_fator(5, "colar", pol)["origem"], "tipo colar")
        self.assertEqual(calcular_preco(5, "colar", pol)["preco"], 60.99)


class TestCustos(unittest.TestCase):
    def test_somente_mercadoria(self):
        m = calcular_custos([{"id": "a", "precoOrigem": 3.5, "quantidade": 10}], {"cotacao": 0.785, "custos": ZERADO}, COMPONENTES)
        self.assertEqual(m["a"]["custoTotalBrl"], 2.75)

    def test_frete_da_loja(self):
        # Mercadoria: 100 peças × ¥10 × 1,00 = R$ 1.000; frete R$ 200 → 20% sobre cada peça.
        itens = [
            {"id": "a", "precoOrigem": 10, "quantidade": 60},
            {"id": "b", "precoOrigem": 10, "quantidade": 40},
            {"id": "c", "precoOrigem": 25, "quantidade": 0},
        ]
        m = calcular_custos(itens, {"cotacao": 1, "custos": {**ZERADO, "frete_internacional": 200}, "rateio": "valor"}, COMPONENTES)
        self.assertEqual(m["a"]["custoProdutoBrl"], 10)
        self.assertEqual(m["a"]["custoAdicionalBrl"], 2)
        self.assertEqual(m["a"]["custoTotalBrl"], 12)
        self.assertEqual(m["c"]["custoTotalBrl"], 30)
        # Pedido de exemplo: ¥8.225,90 × 0,7745 = R$ 6.370,96; frete R$ 850 → +13,34% por peça.
        ex = calcular_custos(
            [{"id": "x", "precoOrigem": 3.5, "quantidade": 858}],
            {"cotacao": 0.7745, "custos": {**ZERADO, "frete_internacional": 3.5 * 0.7745 * 858 * 0.1334}},
            COMPONENTES,
        )
        self.assertEqual(ex["x"]["custoTotalBrl"], round_js(3.5 * 0.7745 * 1.1334 * 100) / 100)

    def test_frete_rateado_por_peca(self):
        itens = [{"id": "a", "precoOrigem": 10, "quantidade": 50}, {"id": "b", "precoOrigem": 30, "quantidade": 50}]
        m = calcular_custos(itens, {"cotacao": 1, "custos": {**ZERADO, "frete_internacional": 200}, "rateio": "peca"}, COMPONENTES)
        self.assertEqual(m["a"]["custoAdicionalBrl"], 2)
        self.assertEqual(m["b"]["custoAdicionalBrl"], 2)

    def test_cenario_do_contador(self):
        # Reproduz o parecer: fator de custo 2,458 no pedido de exemplo.
        cen = FISCAL["custo_aquisicao"]["cenarios_importacao"]["rts_courier_cnpj"]
        valores = valores_do_cenario(COMPONENTES, cen)
        d = detalhar_custos([{"id": "pedido", "precoOrigem": 8225.9, "quantidade": 1}], {"cotacao": 0.78, "custos": valores}, COMPONENTES)
        self.assertLess(abs(d["fatorCusto"] - 2.458), 0.01, f"fator {d['fatorCusto']}")


class TestConfig(unittest.TestCase):
    def test_cenarios_com_regra_da_loja_primeiro(self):
        padrao, cenarios = config.cenarios()
        self.assertEqual(padrao, "mercadoria_frete")
        self.assertEqual(next(iter(cenarios)), "mercadoria_frete")
        self.assertTrue(all(v == 0 for v in cenarios["mercadoria_frete"]["valores"].values()))
        self.assertIn("rts_courier_cnpj", cenarios)

    def test_ncm(self):
        self.assertEqual(config.ncm_para(FISCAL, "brinco", "semijoia"), "71171900")
        self.assertEqual(config.ncm_para({"ncm": []}, "brinco", None, "123"), "123")
        regras = {"ncm": [{"tipo": "*", "material": "*", "ncm": "1"}, {"tipo": "anel", "material": "*", "ncm": "2"},
                          {"tipo": "anel", "material": "prata", "ncm": "3"}]}
        self.assertEqual(config.ncm_para(regras, "anel", "prata"), "3")
        self.assertEqual(config.ncm_para(regras, "anel", "aco"), "2")
        self.assertEqual(config.ncm_para(regras, "colar", "aco"), "1")

    def test_sistema(self):
        s = config.sistema()
        self.assertEqual(s["referenciaModelo"], "{PREFIXO}_{AA}{MM}{SEQ:3}")
        self.assertEqual(s["cenarioCustoPadrao"], "mercadoria_frete")
        self.assertEqual(s["origemCodigoBarras"], "upvendas")


if __name__ == "__main__":
    unittest.main()
