# Parecer do Gestor de Estoque – Fio de Amor Semijoias

> Base: pedido **X260926017** do fornecedor de Guangzhou (shopping Yabao), de 26/09/2026: 72 linhas, 858 unidades, ¥ 8.225,90.
> Configuração: `src/config/taxonomia.json`. Classificação linha a linha: `amostras/pedido-X260926017/classificacao-estoque.json`.
> Preço e fiscal ficam em `src/config/precificacao.json` e `src/config/fiscal.json`, que não são assunto deste parecer.

## 1. Resumo das decisões

- **Referência** `{PREFIXO}_{AA}{MM}{SSS}` (ex.: `BR_2611001`). É o mesmo desenho do `BR_2202909` que a cliente já usa: prefixo do tipo, underline e 7 dígitos. Uma referência por **modelo**. Na recompra, a referência existente é reaproveitada.
- **Código de barras** EAN-13 interno `91` + SEQ10 + DV, um por **SKU** (variação). Nunca começa com 2 (balança), nunca com 789 (GS1 Brasil) e fica fora da faixa `9000…` que o UP gera. O contador é compatível com o Code128-C de 8 dígitos do parecer do administrador. A simbologia é escolhida depois do teste de leitura no caixa.
- **Especificação do fornecedor** (多规格) = variante escolhida. **Foto** = padrão do catálogo. `MR` provavelmente é 默认 ("padrão"): a cor é a da foto.
- **Conjunto** (两/三/四件套) é **um produto** CJ. **Cartela com vários pares** é brinco, subtipo "Kit de brincos". Só se desmembra conjunto por regra (seção 9).
- **Só entra no saldo o que foi conferido.** Divergência vira relatório com foto e vídeo, enviado ao fornecedor em até 7 dias.
- **Este pedido:** 72 linhas viram **66 modelos** (referências) com **72 SKUs** (EANs). 21 linhas têm algum ponto a confirmar na chegada (`conferir_na_chegada = true`).

## 2. Procedimento de entrada de mercadoria

| # | Etapa | O que fazer | Saída no app |
|---|---|---|---|
| 0 | Pré-recebimento | Pedido importado com status **Em trânsito**. Imprimir a lista de conferência com foto, código, especificação, quantidade e unidade (par, cartela, peça ou conjunto). Confirmar o pagamento: neste documento consta `实收: 0`, ou seja, nada registrado como pago. | Lista de conferência |
| 1 | Recebimento | Conferir volumes, lacre e peso contra o documento de transporte. Fotografar a caixa fechada e **filmar a abertura sem cortes**, que é a prova aceita por fornecedor chinês e transportadora. | Volumes OK / avaria de transporte |
| 2 | Triagem | Na bancada **REC**, separar por linha pela **etiqueta do fornecedor** (QR + 货号), não pela aparência. Há modelos quase iguais com letras diferentes (SH5395C/E, SH5185A/B). | — |
| 3 | Contagem | Contagem de **100%**, porque semijoia não admite amostragem. A unidade segue `unidade_venda`: par, cartela, peça ou conjunto. | `qtd_conferida` |
| 4 | Atributos | Banho/cor contra a especificação. Cor do esmalte. Medidas (aro, cm, mm). **分左右** precisa ter 1 esquerdo + 1 direito. Conjunto completo, com extensor. Cartela com todos os pares. Tarraxas presentes. | Divergência por linha |
| 5 | Qualidade | Procurar banho falhado ou manchado, pedra solta ou faltando, esmalte lascado ou com bolha, fecho ou dobradiça que não funciona, pino torto, oxidação. Peça com defeito vai para **QUA**. | `qtd_avaria` + foto |
| 6 | Fechamento | Saldo vendável = conferido − avaria. O app só libera cadastro e sincronização depois deste passo. | Status **Conferido** |
| 7 | Cadastro | Referência, EAN, custo de entrada (rateio de frete e tributos), preço e saldo. Sincroniza com o UP. | Produtos no UP |
| 8 | Etiqueta e embalagem | Seção 4. Imprimir pela quantidade **conferida**. | Etiquetas |
| 9 | Guarda e liberação | Endereçar (seção 5), fotografar cada SKU e mudar o status para **Disponível**. | Endereço + fotos |

Meta para um pedido do porte deste (~70 linhas): conferência em D+0, cadastro em D+1, disponível para maleta em D+2.

## 3. Divergências

| Tipo | Exemplo | No estoque | Com o fornecedor |
|---|---|---|---|
| Falta | Veio 10 de 13 | Cadastrar 10; linha fica "pendente 3" | Envio no próximo pedido ou crédito (欠货) |
| Sobra | Veio 14 de 13 | Separar e só cadastrar se a cliente aceitar pagar | Informar (preserva a relação) |
| Cor ou banho diferente | 14K veio prateado | Cadastrar com o banho **real**, nunca com o pedido | Aceitar (com desconto) ou trocar |
| Modelo trocado | Código diferente na etiqueta | Novo produto com o código real, se a cliente aprovar | Crédito ou devolução |
| Defeito | Esmalte lascado | QUA. Não entra no saldo vendável | Crédito com foto e vídeo em até 7 dias |
| Par errado | Dois esquerdos em 分左右 | Avaria | Crédito |
| Conjunto incompleto | Sem extensor ou sem brinco | Não vender como conjunto até resolver | Reposição da peça |

O app gera o relatório com linha, código, foto do catálogo, foto da peça, quantidade e tipo, pronto para enviar por WeChat ou WhatsApp. Créditos obtidos ficam numa **conta corrente com o fornecedor** e são abatidos no próximo pedido.

## 4. Etiquetagem

- Etiqueta **rabicho 95×12** (padrão do parecer do administrador): REF e preço na frente, barras no verso.
- **Onde colar:** brinco em cartela, no verso da cartela. Bracelete, na peça. Pingente, na argola. Kit de brincos, na cartela. Conjunto, na embalagem, com uma mini-etiqueta `REF/1`, `REF/2`… em cada componente para remontar se separarem.
- **Remover ou cobrir as etiquetas do fornecedor** (QR, 货号 e o código de preço tipo `409S0IP0ek 0184`) antes da vitrine ou da maleta. Assim a revendedora não rastreia o fornecedor e o leitor do caixa não lê o QR chinês por engano.
- As cartelas vêm com a marca **"Delicate"** do fornecedor. Avaliar recartelar com a marca Fio de Amor, ao menos kits e brincos de maior valor.

## 5. Endereçamento e guarda

- **Locais:** `REC` (recebimento), `QUA` (quarentena/avaria), `EST` (estoque), `VIT` (vitrine), `MAL-nn` (uma por maleta de revendedora). Se o UP tiver múltiplos depósitos, usar um por local. Se não tiver, controlar por romaneio.
- **Endereço em EST:** `{armário}{gaveta}-{divisória}`, ex.: `A03-12`. Ordenar por prefixo de tipo e, dentro dele, por referência crescente. A divisória leva uma etiqueta com a REF.
- **Guarda:** saquinho zip por SKU com papel antioxidante. Esmaltados **não empilhar**: são 20 linhas e 251 unidades neste pedido. Conjuntos em caixinha, braceletes em pé. Ambiente seco, longe de perfume.
- **PEPS (primeiro que entra, primeiro que sai):** as peças mais antigas vão primeiro para maleta e vitrine. Registrar o **nº do pedido do fornecedor como lote** na movimentação de entrada.

## 6. Referência

- **Formato:** `{PREFIXO}_{AA}{MM}{SSS}`. PREFIXO vem de `tipos[].prefixo`. AAMM é o mês do **primeiro** cadastro do modelo. SSS vai de 001 a 999 por prefixo dentro do mês.
- **Por quê:** é o mesmo comprimento e o mesmo separador do padrão atual, então etiquetas e relatórios do UP não mudam. AAMM mostra a idade do modelo na própria etiqueta, o que ajuda a decidir promoção ou rebanho. 999 modelos por mês por tipo é muito acima do volume (este pedido tem 45 modelos de brinco).
- **Unicidade:** a chave do modelo é fornecedor + código-raiz do fornecedor. Antes de criar, buscar no UP pelo Código Externo. Se existir, é **recompra**: mesma REF, mesmos EANs, só entra saldo.
- **Contador** fica no banco do app e nunca recua. Na migração, começa do maior SSS existente no UP para o mesmo `PREFIXO_AAMM`, mais 1.
- O parecer do administrador usa `BR-000123` como exemplo. Recomendo manter o underline e os 7 dígitos que já existem no UP, para não haver dois padrões convivendo.

## 7. Código de barras

- **EAN-13 = `91` + SEQ10 + DV**, com SEQ10 = `00` + SEQ8. Exemplo: `9100000000015`. DV = pesos 1/3 da esquerda para a direita, `(10 − soma mod 10) mod 10`. O código do UP `9000023019929` valida com esse algoritmo (soma 61, DV 9).
- **Evitar:** `2x` (muitos PDVs leem como etiqueta de balança e cobram preço errado), `789/790` (GS1 Brasil, só com associação), `690–699` (China, pode vir de fábrica em óculos e relógio), `9000…` (faixa gerada pelo UP), `977–979` e `98x/99x`.
- **Um EAN por SKU.** Cada cor, banho ou aro tem o seu. Nunca muda e nunca é reutilizado. Recompra usa o mesmo código. Antes de gravar, consultar o UP pelo código. Se houver conflito, pular o número e registrar.
- **Tamanho:** na face de 12×30 mm, o EAN-13 com módulo de 0,25 mm ocupa ~28,3 mm. Cabe, mas fica abaixo do mínimo GS1 e sem margem. O Code128-C de 8 dígitos do administrador ocupa ~25 mm. **Decisão:** imprimir 20 etiquetas de cada e testar no leitor do caixa. Como o contador é o mesmo (SEQ8), qualquer escolha serve, e o código impresso é o que vai para o campo de barras do UP.
- Marketplace: cadastrar como "sem GTIN / produto próprio".

## 8. Variações

- **Variação** = mesmo modelo físico (mesmo formato, preço e subtipo) que muda só a cor do esmalte ou da pedra, o banho ou o aro. Uma REF com grade. Cada variação tem EAN, saldo e **foto próprios**.
- **Como agrupar:** (a) mesmo código com especificações diferentes; (b) mesmo código-raiz com letra final diferente **e** mesmo preço **e** mesma forma na foto. A letra final costuma ser a cor, mas confirmar antes de agrupar. Preço ou subtipo diferente: produto separado.
- **Código Externo:** código-raiz no produto. Na variação, código completo + especificação (ex.: `SH5395C MR`).
- **Descrição da variação:** `SEMIJOIA BANHADA A OURO 18K - ESMALTE ROSA`.
- **Anel de aro fixo:** uma variação por aro. Anel aberto: uma variação, "Ajustável".

**Grupos neste pedido**

| Grupo | Linhas | Variações |
|---|---|---|
| SH5122A | 34, 35, 36 | esmalte branco / azul-turquesa / rosa (**mesma foto nas 3**: fotografar cada cor) |
| SH5395 | 24 (C), 43 (E) | rosa perolado / branco perolado |
| SH5185 | 25 (B), 45 (A) | rosa / branco |
| DGYH3018 | 55 (B), 57 (D) | marrom + creme / colorido |
| DGYH2220 | 64 (F), 65 (A) | bege + café / branco perolado |

## 9. Conjuntos e kits

- **Conjunto** (两件套, 三件套, 四件套) é um produto tipo `conjunto`, prefixo CJ, com um EAN e saldo em conjuntos. Componentes e medidas ficam na descrição. Quando a linha traz dois códigos (`YS449A/XJST37C`, `YL576A/LHH1154AS`), o Código Externo do conjunto fica com os dois.
- **Desmembrar só quando:** um componente se danificou ou perdeu; o conjunto está parado há mais de 120 dias e os avulsos giram; ou a cliente decidiu vender avulso antes do cadastro.
- **Como desmembrar:** baixa de 1 conjunto com o movimento "desmembramento" (não é venda) e entrada de cada peça com REF do seu tipo. O custo é rateado pelo peso ou, sem balança, por colar 55% / pulseira ou bracelete 30% / brinco 10% / anel 5%, ajustado ao número de peças. A soma tem que fechar com o custo do conjunto.
- **Kit de brincos** (cartela com 3 pares, como a linha "MR" e 三个尺寸混打): é brinco, vendido por cartela. **Não desmembrar.**
- **Este pedido:** 8 conjuntos (62 unidades, 27,9% do valor) e 8 kits (88 cartelas, o que dá 264 pares físicos).

## 10. Curva ABC e giro

- **ABC por faturamento dos últimos 90 dias**, recalculada todo mês: A = 80% do faturamento, B = 15%, C = 5%. Modelos com menos de 60 dias de casa ficam fora e são avaliados por sell-through.
- **ABC inicial deste pedido (por investimento):** A, que soma 50% do valor, tem **19 linhas**: os 8 conjuntos, 9 braceletes, o kit TG2660CH e o MR1833A. B (30%) tem 24 linhas e C (20%) tem 29. Os itens A são conferidos primeiro, guardados em local de maior controle e só vão para as melhores revendedoras.
- **Inventário rotativo:** A todo mês, B a cada dois meses, C a cada três, mais um geral por semestre. As maletas são conferidas em todo acerto.
- **Indicadores (metas em `precificacao.json → metas`):** sell-through de 30, 60 e 90 dias; ≥ 65% do pedido vendido em 180 dias; giro anual ≥ 4; cobertura de 60 a 90 dias; estoque parado há mais de 120 dias ≤ 15%.
- **Ação por idade sem venda:** 90 dias, trocar de maleta ou destacar na vitrine. 120 dias, montar kit ou promoção. 180 dias, liquidação (tabela LIQUIDAÇÃO) ou rebanho. Inspecionar oxidação em cada etapa.
- **Recompra:** ponto de pedido = venda média diária × prazo de entrega (China ≈ 30 a 45 dias até a prateleira) + 50% de segurança. O fornecedor chinês descontinua modelo rápido, então os campeões devem ser recomprados em até 30 dias.

## 11. Consignação (maletas)

- A maleta sai e volta por **bipagem** (romaneio). O acerto e o financeiro continuam no UP.
- **Mix:** 1 unidade por modelo em cada maleta. Com 13 unidades por modelo dá para ~10 maletas + vitrine + reserva. Os conjuntos (6 unidades) ficam só com as revendedoras de maior venda.
- **No retorno**, inspecionar banho, pedra, tarraxa e par. Avaria em consignação segue a política acordada com a revendedora.

## 12. Alertas sobre o pedido X260926017

| Tipo | Linhas | Unid. | % unid. | ¥ | % valor | ¥/unid. |
|---|---|---|---|---|---|---|
| Brinco (inclui 8 kits) | 45 | 550 | 64,1% | 3.659,70 | 44,5% | 6,65 |
| Bracelete | 11 | 143 | 16,7% | 1.833,00 | 22,3% | 12,82 |
| Conjunto | 8 | 62 | 7,2% | 2.292,50 | 27,9% | 36,98 |
| Pingente | 7 | 91 | 10,6% | 362,70 | 4,4% | 3,99 |
| Anel | 1 | 12 | 1,4% | 78,00 | 0,9% | 6,50 |

1. **Concentração em brincos:** 62,5% das linhas e 64% das unidades. O pedido não traz nenhum colar, corrente, pulseira avulsa, gargantilha ou tornozeleira.
2. **91 pingentes sem nenhuma corrente.** Comprar correntes (ex.: veneziana de 45 cm) ou vender pingente + corrente como combo. Sem isso, o pingente não gira.
3. **Divergências de cor previstas:** XM1998T (pedido 14K, foto prateada); XM2027C (pedido 白金/ouro branco, foto dourada); GXLL04A (etiqueta na foto "MR", pedido 14k); HT881A (único item prateado); SH4842A e HS177A ("se"/双色 = bicolor, mas a foto é só dourada).
4. **MR336A "MR混款":** modelos sortidos e especificação vazia. As 11 cartelas podem vir diferentes da foto.
5. **Tamanhos não informados:** anel GSH1183A (sem aro), anéis dos conjuntos ZWQ625A e ZWQ423A, comprimentos de ZWQ423A e XJX1054. Em YS449A, "20#+16# / 12#+10#" parece diâmetro das esferas em mm, não aro.
6. **Fotos insuficientes:** SH5122A tem a mesma foto nas 3 cores. A foto de GSH1551A mostra 3 cores, mas o pedido é só rosa. Sem foto própria, essas variações não vão para o catálogo.
7. **Quantidades atípicas** (o padrão é 13, e 6 nos conjuntos): MR1542A 6, MR1854A 7, SH5125A 9, NYH572A 9, TQ14A 10, MR336A 11, MR459A 11, MR1833A 14. Podem ser falta no fornecedor (欠货): conferir.
8. **⭐️ em SY1516A, CX554A e HS177A:** marcação manual do vendedor, sem significado informado.
9. **Design inspirado em grife** (CX554A e HS177A, motivo de parafuso): não usar o nome da marca no cadastro, na etiqueta nem em anúncio.
10. **Dois tons de dourado:** 14 linhas (161 unidades) são tom 14K e as demais 18K. Não misturar na mesma composição de vitrine sem avisar, e deixar o banho claro na grade.
11. **Item mais caro:** YM157A (¥87,50 o conjunto, ¥525 a linha). Inventário mensal.
12. **Esmaltados** (20 linhas): o risco de lascar é alto. Inspecionar 100% e embalar separado.

## 13. Perguntas para a cliente

1. O `BR_2202909` segue a lógica ano/mês + sequência? Pode adotar `BR_AAMMSSS`?
2. Qual código de barras imprimir: EAN-13 `91…` ou Code128-C de 8 dígitos? (Depende do teste de leitura no caixa.) O PDV do UP tem leitura de balança ativa?
3. Confirmar com o fornecedor: **MR** = 默认 (cor da foto)? **14KF**: o que significa o "F"? **G达**: o que significa "达"? **se** = bicolor? **白金** em XM2027C: prateado ou dourado?
4. Como descrever o tom 14K para a cliente final: "banhada a ouro" ou "ouro 18k"?
5. Recartelar os brincos "Delicate" com a marca Fio de Amor?
6. Vender os conjuntos fechados ou avulsos desde a entrada?
7. O UP permite múltiplos depósitos (EST, VIT, MAL-nn) e mais de um código de barras por variação?
8. O que significa a ⭐️? O pedido foi pago (o documento mostra `实收: 0`)?
