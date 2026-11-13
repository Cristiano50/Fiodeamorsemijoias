# Parecer do contador: custo de importação, precificação e cuidados fiscais

**Empresa:** Fio de Amor Semijoias (Simples Nacional, comércio varejista, venda direta e em consignação, ERP UP Vendas)
**Data:** 13/11/2026. **Parâmetros do sistema:** `src/config/fiscal.json`

> **Aviso.** Este parecer é uma orientação geral para montar o sistema de cadastro. Ele **não substitui o contador responsável pela empresa**. NCM, alíquotas, enquadramento no Simples, CFOP/CSOSN e o modelo de consignação dependem da UF, do faturamento e da forma real de importação, e **o contador da empresa precisa validá-los**. Os valores marcados como *estimativa* são premissas editáveis, não dados oficiais.

---

## 1. Resumo executivo

1. **Hoje o custo cadastrado parece ser só o preço convertido.** No exemplo do UP Vendas, o custo de R$ 2,75 bate com ¥3,50 × 0,78 = R$ 2,73 (é uma hipótese, que precisa ser confirmada). O custo real de uma peça importada (*landed cost*) fica entre **2,3 e 2,5 vezes** esse valor quando a importação é regular em nome do CNPJ.
2. **Cotação:** use a **PTAX de venda, boletim de fechamento, do dia da compra**. Se nesse dia não houver cotação, use a do último dia útil anterior. O pedido X260926017 é de sábado (26/09/2026), então vale a PTAX de 25/09/2026.
3. **Custo unitário** = preço em CNY × cotação × **fator de custo** + embalagem por peça. Os custos do pedido são **rateados por valor**.
4. **NCM:** para semijoia de latão/cobre/aço com banho, o código correto é **7117.19.00** e não 7117.90.00. Prata 925 vai em 7113.11.00.
5. **Simples:** a receita da revenda de mercadoria **importada pela própria empresa** vai, no entendimento da RFB, para o **Anexo II** (ADI RFB 1/2018), e não para o Anexo I. Os tributos da importação são pagos fora do DAS e não geram crédito.
6. **Markup não é margem.** O "% Lucro" de 736% do UP Vendas é markup: corresponde a 88% de margem bruta, mas só se o custo estiver certo.

## 2. Cotação do dia da compra

| Decisão | Recomendação | Motivo |
|---|---|---|
| Fonte | PTAX do Banco Central (API Olinda, `CotacaoMoedaDia` / `CotacaoMoedaPeriodo`) | É a taxa oficial, auditável, e existe para CNY e USD |
| Compra ou venda | **Venda** | Quem importa compra moeda, ou seja, o banco vende. A Receita converte o valor aduaneiro pela PTAX de venda (taxa do Siscomex). É também a opção mais conservadora |
| Boletim | **Fechamento** | Os boletins de abertura e intermediários são prévias |
| Dia sem cotação | Último dia útil anterior | Cobre sábado, domingo, feriado e compras feitas antes das ~13h, quando sai o fechamento |

- **Formato da API:** a data vai como `MM-DD-AAAA` entre aspas simples, por exemplo `@dataCotacao='09-25-2026'`. As URLs-modelo estão em `fiscal.json → cotacao`. Recomendo consultar `CotacaoMoedaPeriodo` de "data − 10 dias" até "data" e pegar o último fechamento. Uma única chamada resolve fins de semana e feriados.
- **Cotação efetiva:** quando a loja souber quanto realmente pagou (R$ debitados ÷ CNY pagos, pela fatura do cartão ou pelo recibo do agente), essa taxa substitui a PTAX. Ela **já inclui spread e IOF**, então esses dois componentes devem ser zerados para não serem contados duas vezes.
- **Custo gerencial e custo fiscal:** a declaração de importação (DIR/DI/DUIMP) e a nota de entrada usam a taxa do Siscomex da **data do registro**, que pode ser diferente da data da compra. Para precificar, o dia da compra atende ao pedido do cliente. Na contabilidade vale o valor da nota de entrada.
- **Exemplo deste parecer:** usei **0,78 R$/CNY como parâmetro**. Não consegui consultar a API do BCB daqui. As referências de mercado de 25/09/2026 que encontrei (USD/BRL ≈ 5,18–5,20 e USD/CNY ≈ 6,70–6,76, fontes não oficiais) indicam algo perto de **0,77**. **O sistema deve sempre buscar a PTAX oficial.**

## 3. Custo real (landed cost): componentes e fórmula

| Componente | Padrão (editável) | Base | Comentário |
|---|---|---|---|
| Taxa do agente/redirecionador | 8% | mercadoria | Comissão de compra; não entra no valor aduaneiro se vier discriminada |
| Frete internacional (courier) | R$ 1.000/pedido | pedido | Cerca de 8–10 kg. Substituir pelo valor real |
| Spread de câmbio | 4% | valores pagos ao exterior | Cartão 4–6%, fintech 1–3%, agente via Pix 3–8% |
| IOF câmbio | 3,5% | (pago ao exterior) × (1 + spread) | Cartão 3,5%. Contrato de câmbio de importação no CNPJ tem alíquota menor (confirmar com o banco) |
| Imposto de Importação | 60% (RTS) | valor aduaneiro = mercadoria + frete + seguro | Remessa expressa até US$ 3.000 para CNPJ. A isenção até US$ 50 é **só para pessoa física** |
| IPI / PIS / COFINS importação | 0 (RTS) ou 7,8% / 2,10% / 9,65% (formal) | VA (+II no IPI) | No RTS, os 60% substituem esses tributos |
| Siscomex / despachante | R$ 0 + R$ 150 (RTS) ou R$ 300 + R$ 1.500 (formal) | pedido | Taxa de desembaraço do courier ou honorários do despachante |
| ICMS importação | 17% (17–20% conforme a UF) | **por dentro** sobre VA + II + IPI + PIS + COFINS + Siscomex | No Simples é custo: pago fora do DAS e sem crédito |
| Frete nacional | R$ 80/pedido | pedido | |
| Perdas e defeitos | 2% | mercadoria | Peças quebradas, oxidadas ou faltantes |
| Embalagem e etiqueta | R$ 0,40/peça | por peça | Somada direto, sem rateio |

**Fórmula** (a mesma de `fiscal.json → custo_aquisicao.formula`):

```
M      = Σ(preço_CNY × qtd) × cotação
VA     = M + frete_int + seguro
ICMS   = (VA + II + IPI + PIS + COFINS + Siscomex) ÷ (1 − alíq) × alíq
FATOR  = (M + todos os custos do pedido, exceto embalagem) ÷ M
custo_unitário = preço_CNY × cotação × FATOR + embalagem_por_peça
```

**Rateio recomendado: por valor.** Câmbio, IOF, agente, II, ICMS e perdas já são proporcionais ao valor, então o rateio por valor é exato para eles. O frete seria rateado por peso, mas o pedido não informa o peso de cada item, e peso e valor andam juntos (conjuntos e braceletes pesam mais e custam mais). Ratear por peça faria um pingente de ¥3 carregar o mesmo frete e imposto que um conjunto de ¥87,50.

### 3.1 Exemplo numérico: pedido X260926017

O pedido tem 72 linhas, 858 peças e soma ¥8.225,90, cerca de US$ 1.220. Premissas: cotação de **0,78 (ilustrativa)** e remessa expressa no CNPJ (RTS) com ICMS de 17%.

| Item | R$ | % da mercadoria |
|---|---:|---:|
| Mercadoria (¥8.225,90 × 0,78) | 6.416,20 | 100,0% |
| Taxa do agente (8%) | 513,30 | 8,0% |
| Frete internacional | 1.000,00 | 15,6% |
| Spread (4%) + IOF (3,5%) | 605,81 | 9,4% |
| II 60% sobre VA de R$ 7.416,20 | 4.449,72 | 69,4% |
| ICMS 17% por dentro | 2.430,37 | 37,9% |
| Desembaraço + frete nacional | 230,00 | 3,6% |
| Perdas (2%) | 128,32 | 2,0% |
| **Subtotal rateável** | **15.773,73** | **fator = 2,458** |
| Embalagem (858 × R$ 0,40) | 343,20 | |
| **Custo total do pedido** | **16.116,93** | média de R$ 18,78 por peça |

Com o fator 2,458, cada ¥1 custa R$ 1,92 na loja (0,78 × 2,458), e não R$ 0,78.

| Código | Peça | ¥ | Custo Compra Bruto | Custo Insumo | **Custo Total** |
|---|---|---:|---:|---:|---:|
| JCF1512A | pingente | 3,50 | 2,73 | 4,38 | **7,11** |
| GSH747A | brinco | 10,00 | 7,80 | 11,78 | **19,58** |
| DGYH3018B | bracelete | 12,00 | 9,36 | 14,05 | **23,41** |
| YM157A | conjunto colar + pulseira | 87,50 | 68,25 | 99,94 | **168,19** |

**Sensibilidade (estimativas):**
- Com ICMS de 20%, o fator sobe para **2,542**.
- Na importação formal (DI/DUIMP, II 18%, IPI 7,8%, PIS 2,10%, COFINS 9,65%, ICMS 18% e cerca de R$ 1.800 de custos fixos), o fator fica em **2,456**, empatado com o RTS neste tamanho de pedido. Ele cai para cerca de 2,30 com o dobro do volume e para cerca de 2,21 com cinco vezes o volume. **Acima de ~US$ 1.500–2.000 por embarque, a importação formal compensa**, mas exige habilitação no Radar Siscomex e despachante.
- Comprando de um importador nacional com nota fiscal, o custo é o valor da NF mais o frete e a embalagem (origem 2).

## 4. Como preencher o UP Vendas

| Campo | O que lançar | Exemplo (JCF1512A) |
|---|---|---:|
| Custo Compra Bruto | Preço do fornecedor convertido (¥ × cotação), sem acréscimos | 2,73 |
| Custo Insumo | Rateio da importação (agente, câmbio, IOF, frete, II, ICMS, despesas, perdas) + embalagem e etiqueta | 4,38 |
| Milésimos | **0**. "G", "14K", "MR" e "白金" indicam cor ou tipo de banho, não espessura. Só preencher com certificado do fornecedor. Anunciar milésimos sem prova é risco perante o CDC | 0 |
| Banho Ouro / Prata / Ródio / Verniz | **0**. A peça já chega banhada. Usar só se a loja mandar para galvanoplastia ou aplicar verniz no Brasil | 0 |
| Custo Total | Compra Bruto + Insumo + banhos = custo real | **7,11** |
| % Lucro (tabela CONSIGNADO) | Markup sobre o Custo Total (ver item 5) | — |

## 5. Markup x margem, Simples e comissão de consignação

- **Markup** (o "% Lucro" do UP Vendas) incide sobre o custo: `preço = custo × (1 + M/100)`. O **fator multiplicador** é `1 + M/100`, e 736% equivale a ×8,36.
- **Margem** incide sobre o preço: `margem = (preço − custo) ÷ preço = M ÷ (100 + M)`. Por exemplo, markup de 100% dá margem de 50%, e markup de 736% dá margem de 88%.
- **O que precisa sair do preço:** Simples (~7%), comissão da revendedora (ex.: 30%), taxa de cartão (~3%), despesas fixas (ex.: 15%) e o lucro desejado (ex.: 10%). Esses percentuais incidem sobre o preço, então use o **markup divisor**: `fator mínimo = 1 ÷ (1 − 0,65) = 2,857`, o que corresponde a **% Lucro ≈ 186% sobre o Custo Total real**.

**Teste do preço atual (R$ 22,99 para uma peça de ¥3,50):**

| | R$ | % do preço |
|---|---:|---:|
| Preço de venda | 22,99 | 100% |
| (−) Comissão da revendedora 30% | 6,90 | 30,0% |
| (−) Simples ~7% | 1,61 | 7,0% |
| (−) Custo real (RTS) | 7,11 | 30,9% |
| **= Margem de contribuição** | **7,37** | **32,1%** |

Com o custo "cru" de R$ 2,75 e markup de 736%, a margem aparente é de 88%. A margem de contribuição real é de **~32%**, e é dela que ainda saem as despesas fixas. O preço de R$ 22,99 continua viável (o fator 2,857 daria R$ 20,32), mas **o 736% aplicado sobre o custo real geraria R$ 59,45, fora do mercado.** Por isso o markup deve ser recalibrado depois que o custo passar a ser o landed cost. Hoje, 736% sobre o custo "cru" equivale a cerca de ×3,2 sobre o custo real. **Atenção ao combinar com `src/config/precificacao.json`:** se os fatores dessa política (×5 a ×8 nas faixas baratas) foram pensados para um custo com apenas +15% de adicionais, aplicados sobre o landed cost eles dobram o preço de etiqueta. Sobre o custo real, a faixa coerente é de **×2,8 a ×3,3**.

**Simples Nacional:**
- Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12.
- Com RBT12 de R$ 500 mil, o Anexo I dá 6,73% e o **Anexo II** (importação própria, ADI RFB 1/2018) dá 7,23%.
- O contador deve informar a alíquota do mês. A tabela está em `fiscal.json → tributos_venda`.
- **Modelo da consignação:** se a revendedora *compra* a peça com desconto, a receita da loja é 70% do preço e o Simples incide sobre 70%. Se ela é *comissionada*, a receita é 100% e a comissão é despesa. A forma de contratar a revendedora muda a base do DAS e precisa ser definida com o contador.

## 6. Cuidados fiscais

**Documentação da importação (guardar por 5 anos ou mais):**
1. Pedido ou proforma e **fatura comercial (invoice) em nome do CNPJ**, com a descrição em português ou inglês, a quantidade e o valor real.
2. Comprovante de pagamento: fatura do cartão, contrato de câmbio ou recibo do agente com a taxa aplicada.
3. Conhecimento de transporte (AWB/HAWB) e **declaração de importação (DIR, DI ou DUIMP) no CNPJ da loja**.
4. Comprovantes de recolhimento do II/tributos federais e do ICMS (ou guia de exoneração).
5. **NF-e de entrada, CFOP 3.102**, emitida pela loja com os valores da declaração, na entrada da mercadoria.

**Não aceitar o "porta a porta com imposto incluso" sem documentos.** Esse serviço geralmente usa CPF de terceiros, fraciona a remessa ou declara um valor abaixo do real. O resultado é estoque sem origem comprovada, impossibilidade de emitir nota de entrada, risco de perdimento e autuação de ICMS. Compra feita no CPF do sócio para revender no CNPJ também é irregular.

**Consignação** (a Fio de Amor como consignante, conforme o Ajuste SINIEF 02/93):

| Etapa | CFOP |
|---|---|
| Remessa em consignação | 5.917 (6.917 fora do estado) |
| Retorno físico das peças | NF 5.918/6.918 do consignatário. A loja escritura **1.918/2.918** ou emite NF de entrada 1.918 se a revendedora não for contribuinte |
| Venda efetivada pela revendedora | A loja fatura **5.114**. O consignatário faz a devolução simbólica 5.919, e a loja dá entrada com 1.919 |
| Venda direta | 5.102 / 6.102 (6.108 para não contribuinte de outra UF, verificar DIFAL) |
| Entrada da importação | 3.102 (compra de importador nacional: 1.102/2.102) |

**Atenção às revendedoras pessoa física.** Vários estados não aceitam consignação mercantil com não contribuinte. Nesse caso, as alternativas são a remessa para venda fora do estabelecimento (5.904/1.904) ou a venda porta a porta com **ICMS-ST** (Convênio ICMS 45/99, CEST do segmento 28, CFOP 5.403/5.405, CSOSN 201/202). É o ponto de maior risco de autuação no modelo de maletas e precisa ser definido com o contador conforme a UF.

**CSOSN e origem:**
- CSOSN 102 nas vendas.
- Remessas e retornos de consignação: 400 ou 900, conforme a orientação da UF.
- Origem **1** para importação direta e **2** para compra de importador nacional. Nunca use 0.

## 7. NCM: recomendação e riscos

- **7117.19.00** é "Bijuterias de metais comuns, mesmo prateados, dourados ou platinados — Outras". Na SC Cosit 98.261/2023, a RFB classificou um brinco de latão com banho de ouro 18k nesse código e afirmou que a espessura do banho galvânico é irrelevante. Esse é o enquadramento de semijoia de latão, cobre, zamac, aço ou titânio, com ou sem banho, inclusive dos conjuntos.
- **7117.90.00** é "Bijuterias — Outras", ou seja, bijuteria de **outras matérias** (resina, acrílico, vidro, madeira, tecido). O 71179000 usado hoje está errado para peças de metal. Em regra, a alíquota de II é a mesma (TEC 18%) e o IPI também (7,8%), por isso o efeito no imposto é pequeno (confirmar as tabelas vigentes). Ainda assim, NCM errado gera multa de 1% sobre o valor aduaneiro na importação (art. 711 do Regulamento Aduaneiro, mínimo de R$ 500), retificação de declarações, divergência no SPED/NF-e e pode levar à aplicação errada de ST ou benefício estadual.
- **Prata 925:** 7113.11.00. Exija declaração do teor. Peça apenas "prateada" é 7117.19.00.
- **Outros produtos** (detalhes em `fiscal.json → ncm`):
  - óculos de sol: 9004.10.00;
  - relógio de pulso analógico a pilha: 9102.11.00 (digital: 9102.12.00);
  - acessórios de cabelo: **96.15**, porque a Nota 11 do Cap. 71 os exclui de "bijuteria" (9615.11.00 para plástico, 9615.19.00 para metal, 9615.90.00 para grampos);
  - chaveiros: **classificação incerta**, 8306.29.00, 7326.90.90 ou 3926.40.00 conforme o material. Recomendo confirmar.
- **Alertas deste pedido:**
  - "14KF" pode significar *gold filled* (camada laminada). Nesse caso o código seria 7113.20.00 (plaqué). Peça a especificação ao fornecedor.
  - Peças com **zircônia** (锆) são tratadas no mercado como 7117.19.00, mas a Nota 11 exclui artigos com pedras sintéticas. Se a zircônia for considerada pedra sintética, a classificação poderia ir para 7116.20.00. É um ponto a validar.

## 8. O que o contador da empresa deve confirmar

1. A UF da empresa, a alíquota de ICMS na importação (17% ou 20% no RTS, alíquota interna na formal) e se há ICMS-ST ou antecipação para bijuterias na entrada ou na venda porta a porta.
2. Como a loja realmente importa (courier no CNPJ, agente, importador nacional) e se a documentação está em nome do CNPJ.
3. A **segregação entre Anexo I e Anexo II** no PGDAS-D para mercadoria importada diretamente (ADI RFB 1/2018) e a alíquota efetiva atual.
4. O modelo jurídico e fiscal das revendedoras (consignação, venda fora do estabelecimento ou venda porta a porta com ST) e os CFOP/CSOSN correspondentes.
5. A troca de NCM de 7117.90.00 para **7117.19.00** no cadastro e nas próximas declarações, e os casos de 14KF, zircônia e chaveiros.
6. A alíquota de IOF no meio de pagamento usado e se já existe portaria reduzindo o II do RTS (a Lei 15.502/2026 autoriza até 30%; sem portaria, vale 60%).
7. A partir de 2027, os efeitos da reforma tributária (CBS/IBS) no Simples e na importação.

## Fontes consultadas (novembro de 2026)

O acesso direto aos sites estava bloqueado neste ambiente, inclusive a API `olinda.bcb.gov.br`. Por isso, as fontes abaixo foram lidas por meio de resultados de busca, e o formato da API não foi testado ao vivo.

- Classificação de brincos, SC Cosit 98.261/2023: https://tributodevido.com.br/portal/classificacao-fiscal-na-ncm-de-brincos/ · NCM 7117: https://buscadorncm.com.br/ncm/71171900
- Notas explicativas da posição 71.17: https://www.eaduana.com/sistema-armonizado/notas-explicativas/partidas/partida-7117
- PTAX, dados abertos do BCB: https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios · PTAX de venda na importação: https://www.dhl.com/discover/pt-br/conselhos-de-logistica/ptax
- Lei 15.502/2026: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15502.htm · MP de maio de 2026: https://www12.senado.leg.br/noticias/materias/2026/05/13/medida-provisoria-zera-taxa-das-blusinhas-para-importacoes-de-ate-us-50
- Remessas e pessoa jurídica: https://blog.econeteditora.com.br/remessas-internacionais-importacao · ICMS de 20%: https://acionista.com.br/aliquota-do-icms-sobre-compras-internacionais-sobe-de-17-para-20/
- IOF: https://planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12499.htm · https://www.arqfinance.com/pt-BR/articles/aliquota-iof-compras-exterior-cartao
- ADI RFB 1/2018 (Simples e importadora): https://www.ibet.com.br/ato-declaratorio-interpretativo-rfb-no-1-de-14-de-marco-de-2018/
- Convênio ICMS 45/99: https://www.confaz.fazenda.gov.br/legislacao/convenios/1999/CV045_99 · Anexo I do Simples: https://www.contabilizei.com.br/contabilidade-online/anexo-1-simples-nacional/
- Câmbio em setembro de 2026 (não oficial): https://tribunadosertao.com.br/geral/2026/09/25/985641-dolar-recua-a-r-518-mas-registra-alta-de-110-na-semana · https://gomarkets.com/en/fxstreet-news/pboc-sets-usd-cny-reference-rate-at-6-7521-vs-6-7580-previous-e3a197e8ce48
