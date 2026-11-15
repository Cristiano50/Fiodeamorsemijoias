"""Regras de preço, fator, frete e arredondamento — os mesmos casos de tests/regras.test.ts do app.

Com a escada de preços (precificacao.json → arredondamento.modo "escada", 15/11/2026) os preços esperados mudaram:
2,73 × 10 = 27,30 → 24,99 (era 27,99); 5 × 10 = 50 → 49,99 (era 50,99); 10 × 12 = 120 → 119,99 (era 120,99);
2,75 × 8,36 = 22,99 → 24,99 (era 22,99; % lucro 808,73, era 736); 5 × 12 = 60 → 59,99 (era 60,99);
tabelas de 8,78 × 10 = 87,80 → 89,99 / 89,99 / 49,99 / 59,99 (eram 87,99 / 87,99 / 52,99 / 61,99);
3,20 sem o mínimo → 4,99 (era 3,99). Os vetores da escada estão em tests/vetores/escada.json (test_vetores.py).
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fiodeamor import config  # noqa: E402
from fiodeamor.precos import (  # noqa: E402
    arredondar,
    brl_js,
    custos_iniciais,
    calcular_custos,
    calcular_preco,
    detalhar_custos,
    escolher_fator,
    numero_curto_br,
    pontos_da_escada,
    preco_manual_abaixo_do_minimo,
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
        # Sem o mínimo (tabelas secundárias) a escada começa em 4,99.
        self.assertEqual(arredondar(3.2, POL["arredondamento"], aplicar_minimo=False), 4.99)

    def test_politica_da_loja_e_a_escada(self):
        regra = POL["arredondamento"]
        self.assertEqual(regra["modo"], "escada")
        self.assertEqual((regra["minimo"], regra["centavos"]), (19.99, 0.99))
        self.assertEqual([(d["ate"], d["passo"]) for d in regra["degraus"]], [(49.99, 5), (99.99, 10), (199.99, 20), (399.99, 50), (None, 100)])


class TestEscada(unittest.TestCase):
    regra = POL["arredondamento"]

    def test_pontos(self):
        self.assertEqual(
            pontos_da_escada(self.regra, 500),
            [4.99, 9.99, 14.99, 19.99, 24.99, 29.99, 34.99, 39.99, 44.99, 49.99, 59.99, 69.99, 79.99, 89.99, 99.99,
             119.99, 139.99, 159.99, 179.99, 199.99, 249.99, 299.99, 349.99, 399.99, 499.99],
        )

    def test_mais_proximo_e_empate_fica_com_o_maior(self):
        self.assertEqual(arredondar(47.4, self.regra), 44.99)
        self.assertEqual(arredondar(22.49, self.regra), 24.99)  # 2,50 para cada lado: fica o maior
        self.assertEqual(arredondar(54.99, self.regra), 59.99)
        self.assertEqual(arredondar(1234.5, self.regra), 1199.99)

    def test_minimo(self):
        self.assertEqual(arredondar(19.99, self.regra), 19.99)
        self.assertEqual(arredondar(21, self.regra), 19.99)
        self.assertEqual(arredondar(0, self.regra), 19.99)
        self.assertEqual(arredondar(52.79, self.regra, aplicar_minimo=False), 49.99)
        # Os mesmos casos de tests/regras.test.ts: tabelas secundárias de uma peça de 19,99.
        self.assertEqual(arredondar(11.99, self.regra, aplicar_minimo=False), 9.99)  # atacado (× 0,6)
        self.assertEqual(arredondar(13.99, self.regra, aplicar_minimo=False), 14.99)  # liquidação (× 0,7)
        self.assertEqual(arredondar(2, self.regra, aplicar_minimo=False), 4.99)
        r = calcular_preco(1.5, "brinco", POL, fator_pedido=10)
        self.assertEqual((r["preco"], r["precos"]["atacado_revenda"], r["precos"]["liquidacao"]), (19.99, 9.99, 14.99))

    def test_sem_erro_de_ponto_flutuante(self):
        # Cada centavo de 0 a 1.000 cai num ponto da escada, sempre o mais próximo (contas em centavos inteiros).
        pontos = [round(p * 100) for p in pontos_da_escada(self.regra, 1200)]
        for c in range(0, 100_000, 7):
            esperado = min(pontos, key=lambda p: (abs(p - c), -p))
            self.assertEqual(arredondar(c / 100, self.regra, aplicar_minimo=False), esperado / 100, c)

    def test_terminar_em_continua_valendo(self):
        regra = {"modo": "terminar_em", "centavos": 0.99, "direcao": "cima", "minimo": 19.99}
        self.assertEqual(arredondar(23.1, regra), 23.99)
        self.assertEqual(arredondar(37.2, regra), 37.99)
        self.assertEqual(arredondar(3.2, regra, aplicar_minimo=False), 3.99)
        self.assertEqual(calcular_preco(2.73, "brinco", {**POL, "arredondamento": regra}, fator_pedido=10)["preco"], 27.99)

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
        self.assertEqual(r["precoBruto"], 27.3)
        self.assertEqual(r["preco"], 24.99)  # escada: 27,30 fica mais perto de 24,99 que de 29,99
        # Arredondar para baixo na escada não gera alerta de fator (o fator escolhido, 10, não está abaixo do mínimo).
        self.assertEqual([a for a in r["alertas"] if a.startswith("Fator")], [])

    def test_pedido_em_branco_usa_fator_padrao(self):
        r = calcular_preco(5, "colar", POL)
        self.assertEqual(r["fator"], 10)
        self.assertEqual(r["origemFator"], "padrão")
        self.assertEqual(r["preco"], 49.99)

    def test_fator_da_peca_vence_e_preco_manual_vence_tudo(self):
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_manual=12, fator_pedido=10)["preco"], 119.99)
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_manual=12, fator_pedido=10)["origemFator"], "fator da peça")
        self.assertEqual(calcular_preco(10, "brinco", POL, fator_pedido=10, preco_manual=149.9)["preco"], 149.9)

    def test_fator_abaixo_do_minimo_gera_alerta(self):
        # Exemplo do UP: custo 2,75 × 8,36 = R$ 22,99 bruto → 24,99 na escada.
        r = calcular_preco(2.75, "brinco", POL, fator_pedido=8.36)
        self.assertEqual(r["precoBruto"], 22.99)
        self.assertEqual(r["preco"], 24.99)
        self.assertEqual(r["lucroPct"], 808.73)
        self.assertTrue(any("abaixo do mínimo" in a for a in r["alertas"]))
        self.assertIn("Fator ×8.36 abaixo do mínimo da loja (×10).", r["alertas"])

    def test_preco_manual_nao_alerta_fator_minimo(self):
        r = calcular_preco(2.75, "brinco", POL, fator_pedido=8.36, preco_manual=30)
        self.assertFalse(any(a.startswith("Fator") for a in r["alertas"]))

    def test_preco_manual_abaixo_do_fator_minimo(self):
        # Compara com o preço que o fator mínimo daria na escada (2,75 × 10 = 27,50 → 29,99), sem alerta falso.
        self.assertEqual(preco_manual_abaixo_do_minimo(29.99, 2.75, POL), {"abaixo": False, "fatorEfetivo": 10.91, "precoMinimo": 29.99})
        r = calcular_preco(2.75, "brinco", POL, preco_manual=24.99)
        self.assertIn("Preço manual abaixo do fator mínimo (×10): fator efetivo ×9,09.", r["alertas"])
        self.assertEqual(calcular_preco(0, "brinco", POL, preco_manual=24.99)["alertas"][0], "Sem custo: confira preço de origem e cotação.")
        self.assertEqual([numero_curto_br(v) for v in (10, 0.13, 1234.5, 1.005)], ["10", "0,13", "1.234,5", "1,01"])
        # Os mesmos casos de tests/regras.test.ts.
        self.assertEqual(calcular_preco(2.75, "brinco", POL, preco_manual=22.99)["lucroPct"], 736)
        self.assertFalse(preco_manual_abaixo_do_minimo(44.99, 4.73, POL)["abaixo"])  # 4,73 × 10 = 47,30 → 44,99
        m = preco_manual_abaixo_do_minimo(39.99, 4.73, POL)
        self.assertEqual((m["abaixo"], m["fatorEfetivo"]), (True, 8.45))
        self.assertTrue(any(a.startswith("Preço manual abaixo do fator mínimo") for a in calcular_preco(4.73, "brinco", POL, preco_manual=39.99)["alertas"]))
        self.assertFalse(preco_manual_abaixo_do_minimo(9.99, 0, POL)["abaixo"])
        self.assertFalse(preco_manual_abaixo_do_minimo(9.99, None, POL)["abaixo"])
        r = calcular_preco(4.73, "brinco", POL, fator_pedido=10)
        self.assertEqual(r["preco"], 44.99)  # 47,30 → 44,99: arredondar para baixo não gera alerta
        self.assertEqual([a for a in r["alertas"] if a.startswith(("Fator", "Preço manual"))], [])

    def test_recompra_fica_com_o_preco_vigente(self):
        # Os mesmos casos de tests/regras.test.ts: custo 7,90 × 10 = 79 → 79,99 pela escada; vigente 59,99 → +33%.
        r = calcular_preco(7.9, "brinco", POL, fator_pedido=10, preco_vigente=59.99)
        self.assertEqual((r["preco"], r["precoCalculado"], r["precos"]["consignado"]), (59.99, 79.99, 59.99))
        self.assertGreater(r["custoMudouPct"], 10)
        self.assertIn("Custo mudou: preço vigente R$\u00a059,99, pelo custo novo R$\u00a079,99 (+33,34%).", r["alertas"])
        # Diferença pequena: sem alerta.
        s = calcular_preco(6.1, "brinco", POL, fator_pedido=10, preco_vigente=59.99)
        self.assertEqual(s["precoCalculado"], 59.99)
        self.assertFalse(any(a.startswith("Custo mudou") for a in s["alertas"]))
        # O fator abaixo do mínimo não alerta na recompra (o preço é o do original).
        r8 = calcular_preco(6.1, "brinco", POL, fator_pedido=8, preco_vigente=59.99)
        self.assertFalse(any(a.startswith("Fator") for a in r8["alertas"]))
        # Para baixo também avisa; sem preço vigente, o preço é o calculado.
        baixo = calcular_preco(5, "brinco", POL, fator_pedido=10, preco_vigente=59.99)
        self.assertIn("Custo mudou: preço vigente R$\u00a059,99, pelo custo novo R$\u00a049,99 (-16,67%).", baixo["alertas"])
        self.assertEqual(calcular_preco(7.9, "brinco", POL, fator_pedido=10, preco_vigente=None)["preco"], 79.99)
        self.assertIsNone(calcular_preco(7.9, "brinco", POL)["custoMudouPct"])
        self.assertEqual([brl_js(v) for v in (59.99, 1234.5, 79.995)], ["R$\u00a059,99", "R$\u00a01.234,50", "R$\u00a080,00"])

    def test_custos_iniciais(self):
        self.assertEqual(custos_iniciais(850, 2, 0.4), {"frete_internacional": 850, "perdas_defeitos": 2, "embalagem_etiqueta": 0.4})
        self.assertEqual(custos_iniciais(0, None, -1), {})

    def test_sem_custo_alerta(self):
        r = calcular_preco(0, None, POL)
        self.assertIn("Sem custo: confira preço de origem e cotação.", r["alertas"])

    def test_tabelas_de_preco(self):
        r = calcular_preco(8.78, "brinco", POL, fator_pedido=10)
        # 87,80 → 89,99; as outras tabelas usam a mesma escada, sem o mínimo: 53,99 → 49,99 e 62,99 → 59,99.
        self.assertEqual(r["precos"], {"consignado": 89.99, "varejo": 89.99, "atacado_revenda": 49.99, "liquidacao": 59.99})

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
        self.assertEqual(calcular_preco(5, "colar", pol)["preco"], 59.99)


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
