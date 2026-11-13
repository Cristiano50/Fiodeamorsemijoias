# Parecer do Administrador: precificação, operação e prioridades do app

> Fio de Amor Semijoias · consignação (maletas/revendedoras) e varejo · ERP UP Vendas
> Data: 13/11/2026 · Configuração vigente: `src/config/precificacao.json` · Benchmark: `docs/especialistas/benchmark-sistemas.md`

## 1. Resumo executivo

- **O preço passa a sair de um fator por faixa de custo (8,0 a 3,0), e não de um fator único.** O fator atual do UP (custo R$ 2,75 → R$ 22,99, "% Lucro" 736, fator 8,36) funciona para peça de entrada. Aplicado ao pedido inteiro, levaria um conjunto de custo R$ 78 a R$ 656,99, preço fora do mercado. A 1ª faixa (fator 8,0) reproduz exatamente o preço atual do UP: 2,75 × 8 = 22,00, que arredonda para **R$ 22,99**.
- **Pedido X260926017:** investimento de **R$ 7.378,63** (¥ 8.225,90 × 0,78 × 1,15). O valor potencial em etiqueta é de **R$ 40.130**, com markup médio de **5,44** e margem bruta após comissão de 30% de **73,7%**, se tudo vender. O **ponto de equilíbrio chega com 26% das peças vendidas**.
- **Uma etiqueta e um preço por peça:** CONSIGNADO = VAREJO (multiplicador 1,0). A "Tabela Preço 2" do UP, hoje vazia, passa a ser **ATACADO/REVENDA (0,60)**.
- **MVP do app:** importação com conferência, custo total com rateio, motor de preço com alerta de margem, referência e código de barras numérico, etiqueta 95×12, exportação e sincronização com o UP. O acerto de maleta e o financeiro continuam no UP, que já faz isso bem.

## 2. Fluxo operacional ideal

| # | Etapa | O que fazer | Controle | Apoio do app |
|---|---|---|---|---|
| 1 | Pedido | Comprar dentro do orçamento (OTB) e do mix-alvo por tipo. Guardar PDF/fotos do fornecedor | Gestora aprova | Importar PDF/foto e gerar o `itens.json` |
| 2 | Recebimento e conferência | Contar cada linha (qtd, modelo, cor, banho). Fotografar avarias. Lançar as divergências como crédito com o fornecedor | Só entra no estoque o que foi **conferido** | Tela lado a lado: foto do pedido × recebido, com campo "qtd conferida" |
| 3 | Custo total | Usar a cotação **do dia do pagamento**, congelada por pedido. Ratear frete, agente e impostos **pelo valor**. Somar o custo fixo por peça (etiqueta e saquinho) | Custos reais lançados antes de precificar | Campos de custos por pedido e simulação "e se" |
| 4 | Classificação e cadastro | Tipo, banho/material, tamanho, cor da pedra. Converter os códigos do fornecedor (G, MR, 14K/14KF, 白金, se, G达) em banho/cor. Criar variações (ex.: SH5122A em 3 cores = 3 SKUs filhos) | Revisar sugestões de baixa confiança | Classificação automática e de-para editável |
| 5 | Precificação | Aplicar `precificacao.json`. Aprovar em lote. Justificar cada preço manual | Alerta se margem < 50% | Motor de preço com o "% Lucro" do UP calculado |
| 6 | Etiquetagem | Etiqueta 95×12 mm (duas faces de 12×30 mm): frente com REF e preço, verso com código de barras. Imprimir **a quantidade conferida** | Etiquetar só depois do preço aprovado | Etiquetas em ZPL/PPLA/PDF em lote e reimpressão avulsa |
| 7 | Fotos | Foto real em fundo branco (padrão) e 1 a 2 publicitárias. Conferir pedra e fecho nas imagens com IA | Nenhum SKU vai para catálogo sem foto | Checklist e geração de fotos |
| 8 | Sincronização UP | Enviar produto, custo, % Lucro (CONSIGNADO), Tabela Preço 2 (ATACADO) e estoque | Log de envio. Não sobrescrever preço editado no UP sem confirmar | Exportação/API com relatório de erros |
| 9 | Maletas | Montar por romaneio com bipagem. 13 un/SKU = 1 por maleta em até 10 maletas, mais 3 para a loja. Maleta de ~R$ 4.000 em etiqueta (~85 peças). Ciclo de 30 dias | Bipar na saída e na volta | (Futuro) Sugestão de mix por maleta |
| 10 | Acerto e giro | Vendido = enviado − devolvido. Comissão escalonada. Peça parada há mais de 120 dias troca de maleta. Acima de 180 dias vai para LIQUIDAÇÃO | Inadimplência e perdas por revendedora | Relatório de giro por SKU e fornecedor, para recompra |

## 3. Política de preço

### 3.1 Fórmula

```
custo_total = preço_origem × cotação × (1 + custos_adicionais% ) + custo_fixo_por_peça   (2 casas)
fator       = preço manual > fator manual > faixa de custo (usar_faixas=true) > fator do tipo > fator_padrão (5,0)
preço_bruto = max(custo_total × fator, piso_monotônico)       piso = "até" da faixa anterior × fator anterior
preço_final = ceil(preço_bruto − 0,99) + 0,99   (termina em ,99, arredonda para cima, mínimo R$ 19,99)
% Lucro UP  = (preço_final / custo_total − 1) × 100
```

**Por que o fator cai conforme o custo sobe.** Na peça barata, comissão, etiqueta, embalagem, perda e o tempo de cadastro pesam muito em R$ por peça. Além disso, a cliente aceita bem a faixa de R$ 19,99 a 29,99 para peças de entrada. Na peça cara, a cliente compara preço e o capital fica parado na maleta por mais tempo. As referências do setor dão de 2,5× a 4× sobre o custo para semijoia nacional e cerca de 4× (*triple keystone*) para *fashion jewelry*. Para importado barato em consignação, 5× a 8× é viável e é o que a loja já pratica.

**Piso monotônico.** Sem ele, uma peça de custo R$ 10,76 (faixa ≤ 12, fator 5,0) sairia por R$ 53,99, mais barata que uma de R$ 10,00 (fator 5,5, R$ 55,99). A revendedora perceberia a incoerência. O piso cria pequenos "platôs" de 6 a 11% de largura no início de cada faixa.

### 3.2 Faixas de custo (`faixas_custo`)

| Custo total até (R$) | 3,00 | 4,00 | 5,00 | 6,50 | 8,00 | 10,00 | 12,00 | 16,00 | 22,00 | 30,00 | 45,00 | 65,00 | 100,00 | acima |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fator | 8,0 | 7,5 | 7,0 | 6,5 | 6,0 | 5,5 | 5,0 | 4,5 | 4,25 | 4,0 | 3,75 | 3,5 | 3,25 | 3,0 |
| Preço de etiqueta resultante | ≤ 24 | 24–30 | 30–35 | 35–42 | 42–48 | 48–55 | 55–60 | 60–72 | 72–94 | 94–120 | 120–169 | 169–228 | 228–325 | > 325 |

### 3.3 Fatores por tipo (`fatores_por_tipo`)

Os fatores por tipo valem quando `usar_faixas=false` e servem de referência. Foram calibrados pelo custo típico de cada tipo de importado chinês e pelo preço que a cliente aceita.

| Tipo | Fator | Justificativa |
|---|---|---|
| brinco | 6,0 | Custo de R$ 3 a 11. Item de impulso e de maior giro na maleta. Etiqueta de R$ 20 a 60 |
| piercing, pingente | 6,5 | Custo muito baixo (R$ 2 a 6). Preço absoluto continua baixo (R$ 18 a 40) |
| anel, tornozeleira | 6,0 | Custo baixo. O anel tem risco de numeração, compensado pelo fator |
| choker, pulseira | 5,5 | Peças finas e de moda, com custo de R$ 4 a 10 |
| colar, gargantilha, bracelete, acessório de cabelo, chaveiro | 5,0 | Custo médio (R$ 6 a 18). Preço de R$ 30 a 90 é comparável no mercado |
| corrente | 4,5 | Commodity: a cliente compara pelo comprimento e pela espessura |
| conjunto | 3,8 | Custo alto (R$ 12 a 80). Precisa caber em R$ 50 a 300. Concentra capital |
| óculos | 3,5 | Concorre com camelô e marketplace. Custo de R$ 15 a 30 |
| relógio | 3,0 | Preço muito comparável e risco de defeito ou bateria. Margem baixa por natureza |

### 3.4 Exemplos com itens reais (cotação 0,78; custos adicionais 15%; comissão de 30%)

| Item | ¥ | ×0,78 | Custo total | Faixa / fator | Bruto | **Etiqueta** | Markup | % Lucro UP | Comissão | Líquido loja | Margem bruta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Brinco GSH1422A | 5,00 | 3,90 | 4,49 | ≤ 5 / 7,0 | 31,43 | **31,99** | 7,12 | 612,47 | 9,60 | 22,39 | 17,90 (79,9%) |
| Bracelete DGYH3018B | 12,00 | 9,36 | 10,76 | ≤ 12 / 5,0 (piso 55,00) | 55,00 | **55,99** | 5,20 | 420,35 | 16,80 | 39,19 | 28,43 (72,5%) |
| Conjunto YL576A (3 peças) | 57,00 | 44,46 | 51,13 | ≤ 65 / 3,5 | 178,96 | **178,99** | 3,50 | 250,07 | 53,70 | 125,29 | 74,16 (59,2%) |
| *Referência: pingente GXLL04A* | 3,10 | 2,42 | 2,78 | ≤ 3 / 8,0 | 22,24 | **22,99** | 8,27 | 726,98 | 6,90 | 16,09 | 13,31 (82,7%) |

Na tabela ATACADO (0,60), os mesmos itens saem por R$ 19,19, 33,59 e 107,39, com margens de 76,6%, 68,0% e 52,4%.

### 3.5 Tabelas de preço e comissão

| Tabela | Mult. | Uso | No UP |
|---|---|---|---|
| CONSIGNADO (base) | 1,00 | Preço de etiqueta na maleta | Tabela CONSIGNADO |
| VAREJO | 1,00 | Loja física, Instagram, WhatsApp. **Mesmo preço**, para não concorrer com a revendedora nem exigir duas etiquetas | Usa a CONSIGNADO |
| ATACADO/REVENDA | 0,60 | Compra definitiva à vista (revendedora ou lojista), pedido mínimo de R$ 500 em etiqueta | Tabela Preço 2 |
| LIQUIDAÇÃO | 0,70 | Peça parada há mais de 180 dias ou com avaria leve. Uso pontual com aprovação | Promoção |

**Comissão da revendedora** (`comissao_escalonada`), sobre as vendas do ciclo: **30%** até R$ 1.499,99, **35%** até R$ 2.999,99 e **40%** acima disso. O setor pratica de 20% a 40%, e o escalonamento 30/35/40 é comum. Se a revendedora der desconto à vista (máx. 10%), ele sai da comissão dela, não da tabela.

**Margem mínima de 50%** sobre a receita líquida da loja (`margem_definicao`). Isso equivale a um markup mínimo de 2,86 com comissão de 30% e de 3,33 com comissão de 40% ou no atacado. A menor faixa (3,0) passa com 30% e só dispara alerta em conjunto caro vendido por revendedora de 40% ou no atacado, que são justamente os casos que devem ser revistos.

### 3.6 Governança

- Cotação e custos ficam **congelados por pedido**. Se o custo de reposição de um modelo mudar mais de 10%, o app sugere reprecificar o lote novo, sem mexer no que já está etiquetado na rua.
- Todo preço manual tem motivo registrado. Os relatórios mostram o **markup efetivo** (preço ÷ custo), não só o fator da faixa.
- Revisar as faixas a cada 6 meses, cruzando o sell-through por faixa de preço. Se a faixa de R$ 50 a 99 girar menos de 50% em 180 dias, reduzir os fatores dela.

## 4. Análise do pedido X260926017 (fornecedor de Guangzhou, 26/09/2026)

Classificação: 耳钉/耳环 = brinco, 吊坠 = pingente, 手环 (单个) = bracelete, 戒指 = anel, 两/三/四件套 = conjunto.

| Tipo | Linhas | Peças (%) | ¥ | Custo R$ (% invest.) | Etiqueta (mín.–máx.) | Receita potencial (%) | Markup | Preço médio | Margem pós-comissão |
|---|---|---|---|---|---|---|---|---|---|
| Brinco | 45 | 550 (64,1%) | 3.659,70 | 3.282,75 (44,5%) | 22,99–56,99 | 21.106,50 (52,6%) | 6,43 | 38,38 | 77,8% |
| Conjunto | 8 | 62 (7,2%) | 2.292,50 | 2.056,37 (27,9%) | 60,99–255,99 | 7.715,38 (19,2%) | 3,75 | 124,44 | 61,9% |
| Bracelete | 11 | 143 (16,7%) | 1.833,00 | 1.644,20 (22,3%) | 54,99–78,99 | 8.396,57 (20,9%) | 5,11 | 58,72 | 72,0% |
| Pingente | 7 | 91 (10,6%) | 362,70 | 325,34 (4,4%) | 21,99–40,99 | 2.456,09 (6,1%) | 7,55 | 26,99 | 81,1% |
| Anel | 1 | 12 (1,4%) | 78,00 | 69,97 (0,9%) | 37,99 | 455,88 (1,1%) | 6,52 | 37,99 | 78,1% |
| **Total** | **72** | **858** | **8.225,90** | **7.378,63** | 22,99–255,99 | **40.130,42** | **5,44** | **46,77** | **73,7%** |

**Resultado econômico (CONSIGNADO, comissão de 30%):**
- Receita líquida da loja se tudo vender: R$ 28.091. Margem bruta de R$ 20.713 (73,7%). Com comissão de 40% para todas as revendedoras: R$ 24.078 de receita líquida e margem de 69,4%.
- **Ponto de equilíbrio com 26,3% vendido.** Com 60% vendido, sobram R$ 16.855 líquidos, o que dá **R$ 9.476** de lucro bruto além do capital recuperado. Com 70%, **R$ 12.285**. Esses valores são antes do Simples Nacional (~4 a 7% sobre a receita), das despesas fixas e das perdas.
- Distribuição de preços de etiqueta: até R$ 29,99 com 143 peças (17%), R$ 30 a 49,99 com 439 (51%), R$ 50 a 99,99 com 246 (29%), R$ 100 a 199,99 com 24 (3%) e R$ 200 ou mais com 6 (0,7%). O pedido é saudável para maleta.
- **Comparação com o fator único de 8,36:** daria R$ 62.120 em etiqueta, preço médio de R$ 72,40, conjunto YM157A a R$ 656,99 e bracelete CX554A a R$ 153,99. O valor ficaria inflado, o giro seria baixo e a revendedora desanimaria.

**Diagnóstico do mix e recomendações para a próxima compra:**
1. Os brincos são 64% das peças. Isso é bom para giro e ticket de entrada, mas falta "look": não há colar avulso, corrente, pulseira fina, choker nem tornozeleira, e há só 1 anel. Na próxima compra, reservar de 15 a 20% do investimento para colares, correntes e anéis (numeração variada).
2. Os conjuntos têm 28% do capital com 7% das peças. É o maior risco de encalhe, porque não dá para pôr 1 de cada SKU em toda maleta. Limitar conjuntos a cerca de 20% do investimento e fazer rodízio entre as maletas.
3. Itens que exigem atenção na conferência: a linha 5 (MR混款 = modelos sortidos) pede contagem por modelo. As linhas 37 e 38 (两件套) são conjuntos de 2 peças a confirmar (brinco + brinco?). SH5122A aparece em 3 cores (3 SKUs). As linhas 12, 17, 20 e 23 dizem 分左右 (par assimétrico): conferir os pares.
4. Com 13 un/SKU, a distribuição é de cerca de 8 maletas de R$ 4.000 em etiqueta (~85 peças cada), deixando ~20% na loja e na reserva.
5. **Risco no custo:** os 15% de custos adicionais só valem para compra via agente com frete e tributos embutidos. Na importação formal (NCM 7117), há II de ~16,2%, IPI de ~7,8%, PIS/COFINS de ~11,75% e ICMS, e a carga pode passar de 60% sobre o FOB. Com +40%, o investimento vai a R$ 8.983 e os preços sobem ~22%. O app precisa permitir lançar os custos reais do pedido **antes** de etiquetar.

## 5. KPIs a acompanhar

| KPI | Fórmula | Meta | Frequência |
|---|---|---|---|
| Markup médio realizado | Σ preço vendido ÷ Σ custo vendido | ≥ 5,0 | Mensal |
| Margem bruta pós-comissão | (líquido − custo) ÷ líquido | ≥ 65% (mín. 50% por peça) | Mensal |
| Sell-through do ciclo da maleta | R$ vendido ÷ R$ enviado no ciclo | ≥ 35% / 30 dias | Por acerto |
| Sell-through do pedido | Peças vendidas ÷ compradas | ≥ 65% em 180 dias | Mensal, por pedido e fornecedor |
| Ticket médio e peças por venda | R$ vendido ÷ nº de vendas | ≥ R$ 75 e ≥ 1,6 peça | Mensal |
| Venda média por revendedora | R$ vendido ÷ revendedoras ativas | Ranking e escala de comissão | Por ciclo |
| Estoque parado | R$ sem venda há > 120 dias ÷ R$ em estoque | ≤ 15% | Mensal |
| Perdas e avarias | Peças não devolvidas ou quebradas ÷ enviadas | ≤ 2% | Por acerto |
| Garantia de banho | Trocas ÷ vendidas | ≤ 3%, por fornecedor | Trimestral |
| Inadimplência no acerto | R$ em atraso ÷ R$ a receber | ≤ 3% | Semanal |
| Lead time de entrada | Recebimento → peça na maleta | ≤ 5 dias úteis | Por pedido |
| Prontidão do cadastro | SKUs com foto, etiqueta e sync OK ÷ SKUs | 100% antes de sair | Por pedido |
| Divergência na conferência | Peças divergentes ÷ peças do pedido | ≤ 1% | Por pedido e fornecedor |

## 6. Funcionalidades priorizadas para o app

**MVP (P0/P1): a esteira de entrada de mercadoria**
1. **Importação de PDF/foto com conferência:** extrair as linhas e mostrar a miniatura do fornecedor ao lado da qtd conferida. Divergências geram um relatório para o fornecedor.
2. **Custo total por pedido:** cotação manual ou PTAX congelada por pedido. Custos adicionais lançados em R$ ou % e rateados por valor. Custo fixo por peça.
3. **Motor de preço lendo `precificacao.json`:** faixas com piso monotônico, ,99, mínimo, tabelas, comissão. **Alerta de margem**. Simulação "e se" (cotação e custos). Edição e aprovação em lote. Exibe markup efetivo e % Lucro UP.
4. **Classificação:** tipo, banho, tamanho e pedra, com de-para dos códigos do fornecedor e criação de variações (SKU pai e filhos).
5. **Referência e código de barras:** REF legível (ex.: `BR-000123`) e **código numérico de 8 dígitos em Code128-C**. A 203 dpi (Argox OS-214, Elgin L42, Zebra ZD220), com módulo de 0,25 mm, ocupa ~25 mm com as zonas de silêncio e cabe na face de 30 mm. Um Code128 alfanumérico de 10 ou mais caracteres não cabe, e um EAN-13 fica abaixo do tamanho mínimo.
6. **Etiqueta 95×12 "rabicho":** frente com REF e preço, verso com as barras. Saída em ZPL (Zebra/Elgin), PPLA (Argox) e PDF. Imprime pela qtd conferida.
7. **Sincronização e exportação com o UP Vendas:** produto, custo, % Lucro da CONSIGNADO, Tabela Preço 2 = ATACADO, estoque. Planilha de importação como plano B, log e reenvio.
8. **Fotos:** padrão em fundo branco e 1 publicitária por SKU, com checklist "pronto para maleta".

**Futuro (P2/P3)**
- Montagem de maleta por bipagem (romaneio) integrada ao acerto do UP. Não duplicar o acerto nem o financeiro.
- **Maleta inteligente:** mix sugerido pelo histórico da revendedora (ideia da Gestão Joias).
- Reprecificação ao mudar o custo de reposição e histórico de preço por SKU.
- Painel de recompra: sell-through por fornecedor, código e faixa de preço, mais orçamento de compra (OTB) por tipo.
- Catálogo digital e WhatsApp por tabela de preço. Consulta da revendedora.
- Garantia digital por WhatsApp e QR na etiqueta (Dynamic PRO).
- Alerta de "preço acima do teto de mercado" por tipo. Tabela MARKETPLACE (~1,15) se a loja entrar em Shopee ou Mercado Livre.
