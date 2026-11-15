# Classificação e nomes

A loja Fio de Amor Semijoias importa semijoias de fornecedores da China e vende por **consignação** (maletas de
revendedoras) e no varejo, com cadastro no ERP **UP Vendas**. Ao classificar, combine três olhares:
**gestor de estoque** (tipo, material, banho, variações, conjunto), **marketing** (nome, nome comercial, avaliação) e
**administrador** (destaques, coerência de preço).

## Classificação (ids de `taxonomia.json`)

- Use **só os ids** de `tipos`, `materiais`, `banhos` e `cores_pedra`. Subtipo e tamanho: use as opções de cada tipo
  (`tipos[].subtipos`, `tipos[].tamanhos`); sem tamanho informado em brinco, use "único".
- **Olhe a foto** para decidir tipo, subtipo, cor da pedra, banho aparente e estilo. O **texto do documento manda** nos
  códigos, preços e quantidades.
- Traduza o chinês com `taxonomia.json → glossario_chines`; termo fora do glossário: traduza pelo contexto e ponha um alerta.
- Especificação do fornecedor (G, MR, 14K, 14KF, se, 白金, 粉油, 金色, 玫瑰金…; tamanhos como 16 ou 18号): consulte
  `taxonomia.json → codigos_fornecedor` para o banho. Código desconhecido: banho `a_definir` e alerta. Não altere o
  campo `especificacao`: ele é a chave da recompra (o que você entendeu da cor vai em `variacao` e `banho`).
- 两件套 / 三件套 / 四件套 = **conjunto** (`ehConjunto: true`, tipo `conjunto`) com os `componentes`
  (ex.: "colar 43cm", "pulseira 17cm", "brinco").
- Mesmo código do fornecedor em várias linhas com cores diferentes = **variações**: preencha `variacao`
  (ex.: "esmalte rosa"); o script de referências agrupa (recompras incluídas: a variação nova usa a referência da
  original).
- Fotos de fornecedor mostram cartela com marca do fornecedor (ex.: "Delicate"), QR code e etiqueta: **não fazem parte da peça**.
- Na dúvida, escolha a melhor hipótese e escreva em `alertas` o que precisa ser conferido na peça física.

## Nome de cadastro (`nome`) — padrão do UP

Siga `marca.json → padrao_nome` (formato, regras, exemplos e vocabulário). Resumo:
- `TIPO (SIGLA) DESCRITORES`, tudo em MAIÚSCULAS, até 60 caracteres.
- TIPO no singular e primeiro (BRINCO, COLAR, PINGENTE, PULSEIRA, BRACELETE, ANEL, CONJUNTO…); kits de brinco usam BRINCO.
- SIGLA do material (SJ = semijoia banhada).
- Ordem: [KIT/QUANTIDADE] + FORMA ou MOTIVO + ACABAMENTO + PEDRA/PÉROLA + COR + MEDIDA (7MM, 43CM).
- O banho dourado é o padrão e vai na grade, não no nome; RÓDIO ou BICOLOR no fim só quando não for dourado.
- Sem adjetivos subjetivos (LINDO, LUXO, TOP). Sem marcas de terceiros. Sem o código do fornecedor.
- Nome único: se repetir, diferencie por cor, medida ou motivo.
- Dê **3 opções diferentes** em `nomesSugeridos` e use a melhor em `nome`.

Exemplos: `BRINCO (SJ) FLOR PEROLADA COM PÉROLA E ZIRCÔNIAS` · `BRINCO (SJ) KIT 3 PARES ARGOLINHA TORCIDA CROISSANT` ·
`CONJUNTO (SJ) COLAR E PULSEIRA RIVIERA ZIRCÔNIA` · `PINGENTE (SJ) BORBOLETA CRAVEJADA FUNDO BRANCO`.

## Nome comercial, avaliação e legenda

- `nomeComercial`: Tipo + motivo afetivo, 2 a 5 palavras, só a primeira letra maiúscula ("Brinco Flor de Pérola",
  "Trio Nó de Amor"). Kits de brinco: "Trio …"; conjuntos: "Conjunto …". "Fio de Amor" só nas peças-assinatura
  (corações, nós, fios entrelaçados). Não repita entre peças.
- `avaliacao`: 1–2 frases do marketing sobre o apelo da peça (o que valoriza, para quem, como fotografar).
- `legenda` (opcional): 1–2 linhas no tom de `marca.json → tom_de_voz`; `hashtags`: as fixas de `marca.json → hashtags`
  e 3–5 da peça.
- `destaque: true` nas peças de maior apelo comercial (as que merecem foto e post primeiro).

## Conferências antes de entregar

- Linhas, peças e total iguais ao documento.
- Todo item com `tipo`, `material`, `banho` e `nome`.
- Recompras marcadas (o resumo mostra), **recompras a confirmar** mostradas à pessoa (a decisão é no app) e preços sem
  alerta de fator abaixo do mínimo, salvo decisão da gestora.
- Moeda confirmada (sem marca no documento, pergunte) e quantidade 0 conferida.
