# Formato do cadastro (`cadastro.json`)

Arquivo de trabalho da skill e, com as fotos embutidas, o **pacote** que o app da Fio de Amor importa
(`POST /api/skill/cadastro` ou o botão "Importar cadastro do Claude" na tela Importar pedido).

Os nomes dos campos são os mesmos do app (tabela `produtos` e `pedidos`), para não haver tradução no meio do caminho.
Os ids de classificação (`tipo`, `material`, `banho`, `corPedra`, `tamanho`) são os ids de `referencias/taxonomia.json`.

```jsonc
{
  "formato": "fiodeamor-cadastro",
  "versao": 1,
  "id": "uuid do cadastro (o app usa para não importar duas vezes)",
  "geradoEm": "2026-11-14T13:00:00Z",
  "geradoPor": "skill fiodeamor-cadastro",

  "pedido": {
    "numero": "X260926017",
    "fornecedor": "广州某某饰品有限公司",   // nome ORIGINAL do documento (é o que a recompra usa)
    "dataCompra": "2026-09-26",              // AAAA-MM-DD
    "moeda": "CNY",                          // CNY | BRL | USD; null = o documento não mostra (pergunte)
    "cotacao": 0.7745,                       // R$ por 1 unidade da moeda (BRL = 1); null = pendente, nunca 1
    "cotacaoFonte": "PTAX Banco Central (boletim de fechamento)",
    "cotacaoData": "2026-09-25",
    "frete": 850.0,                          // R$ do frete do pedido (China), ou null
    "fator": null,                           // fator do pedido digitado pela loja; null = padrão (10)
    "totalDocumento": 8225.9,                // total impresso no documento, na moeda do pedido
    "arquivoNome": "pedido.pdf",
    "cabecalho": "texto do cabeçalho do documento",
    "colunas": "序 条码 图片 货名 ...",
    "observacoes": null
  },

  "itens": [
    {
      "linha": 1,
      "textoOriginal": "1 | GSH747A | 21#纽扣耳钉 | G | 12 | 10 | 120",  // linha como foi lida
      "codigoFornecedor": "GSH747A",
      "especificacao": "G",                 // especificação/cor do fornecedor (G, MR, 14KF, MR粉油, 金色, 玫瑰金, 16, 18号…)
      "descricaoOriginal": "21#纽扣耳钉",
      "quantidade": 12,                     // 0 continua 0 (não vira 1); vazia = 1, com aviso
      "precoOrigem": 10.0,                  // preço unitário na moeda do pedido
      "foto": "fotos/linha-001.jpg",        // caminho na pasta de trabalho; no pacote vira "fotoBase64"

      // classificação e nomes (Claude preenche seguindo as referências)
      "traducao": "Brinco de pino botão 21#",
      "tipo": "brinco", "subtipo": "Brinco médio",
      "material": "semijoia", "banho": "ouro_18k",
      "corPedra": ["zirconia_branca"], "tamanho": "unico",
      "variacao": null,                     // ex.: "esmalte rosa" quando o mesmo código vem em cores
      "grupo": null,                        // mesmo grupo = mesma referência (variações)
      "ehConjunto": false, "componentes": [],
      "estilo": "clássico",
      "nome": "BRINCO (SJ) BOTÃO TRAMA CRAVEJADO ZIRCÔNIA",
      "nomeComercial": "Brinco Botão Trama de Luz",
      "nomesSugeridos": ["…", "…", "…"],
      "avaliacao": "texto curto do marketing",
      "legenda": null, "hashtags": [],
      "destaque": false,

      // códigos
      "referencia": "BR_2611001",           // gerada por scripts/referencias.py (ou a do original, na recompra)
      "recompraDe": null,                   // referência do produto original quando é recompra
      "recompraCandidatas": null,           // opcional: referências possíveis quando a skill não teve certeza
      "codigoBarras": null,                 // só o código CRIADO PELO UP (recompra). Peça nova: null (o UP gera)

      // preço (scripts/calcular.py preenche)
      "fator": null,                        // fator só desta peça (vence o do pedido)
      "precoManual": null,                  // preço fixado à mão (vence o fator)
      "custoProdutoBrl": 7.74, "custoAdicionalBrl": 1.04, "custoTotalBrl": 8.78,
      "fatorAplicado": 10, "precoVenda": 89.99,   // 8,78 × 10 = 87,80 → 89,99 na escada de preços
      "precos": { "consignado": 89.99, "atacado_revenda": 49.99 },
      "ncm": "71171900",
      "alertas": []
    }
  ]
}
```

## Regras

- **Peça nova não leva código de barras**: o UP Vendas cria no cadastro. O app importa os códigos depois
  (UP Vendas → Códigos de barras do UP) ou recebe bipado no pedido.
- **Especificação** (`especificacao`): a célula logo antes do trio preço × quantidade = total. Não é especificação
  a 1ª célula (sequência), o próprio código repetido nem a descrição (texto em chinês sem outra célula de texto antes).
  Vale número (tamanho: 16, 17.5), texto latino até 16 caracteres (G, MR, 14KF) e texto com chinês até 12 caracteres
  quando há uma descrição antes (金色, 玫瑰金, 18号). Os mesmos casos do app em `tests/vetores/especificacao.json`.
- **Chave da recompra**: fornecedor (nome ORIGINAL sem espaços, minúsculas) + código do fornecedor + especificação; o
  código e a especificação em maiúsculas, sem espaço, hífen ou ponto, com largura total → ASCII ("abc-123 a" =
  "ＡＢＣ１２３Ａ" = "ABC123A"). Original possível: mesmo código, fornecedor igual (ou desconhecido de um dos lados),
  especificação igual (ou vazia de um dos lados).
- **Recompra** (exatamente um original possível e ele casa a chave inteira, com o fornecedor conhecido):
  `recompraDe` = referência original, `referencia` = a mesma, `codigoBarras` = o código do UP do original, se houver.
  O app confere de novo na importação.
- **Recompra a confirmar** (`recompraCandidatas`, campo novo e opcional): mais de um original possível, ou
  fornecedor/especificação desconhecidos de um dos lados. `recompraDe` = null, `recompraCandidatas` = [referências
  possíveis], `referencia` = null (sai da decisão) e a peça fica fora da planilha do UP da skill. **Na dúvida a skill
  não decide; o app mostra "Recompra a confirmar"** e a pessoa escolhe ("É esta" ou "Não é recompra").
  Pedido sem fornecedor: só candidatas, nunca recompra automática. Contexto antigo do app (sem `fornecedorChave`):
  a chave do fornecedor sai do nome e a especificação igual ao próprio código vale vazia.
- **Variações**: mesmo código do fornecedor (normalizado) em 2+ linhas = mesmo `grupo` = mesma referência, recompras
  incluídas (o grupo com recompra usa a referência da original).
- **Moeda** (`pedido.moeda`): pela marca do documento, nesta ordem: USD (USD, US$, 美元, 美金) > BRL (R$, BRL, 雷亚尔) >
  CNY (¥, RMB, CNY, 人民币, 元). Sem marca: null — a skill avisa e pergunta (o app, se receber null, usa CNY e pede
  para conferir). Casos em `tests/vetores/cabecalho.json`.
- **Cotação**: para moeda diferente de BRL, nunca vira 1. Sem cotação, a skill busca a PTAX da data da compra; sem PTAX,
  os preços ficam pendentes (custos e preços null), com aviso.
- **Quantidade**: 0 continua 0 (com aviso) na conta, na planilha e no pacote; vazia conta 1 (com aviso), como no app.
- **Números**: no `cadastro.json` podem vir como texto ("10,5", "R$ 1.234,56", "0,7745"), lidos como o `lerNumeroBr` do
  app: vírgula ou ponto decimal; ponto de milhar só no formato 1.234 / 12.345.678 e só em dinheiro (preço, frete,
  total); cotação e fator sem milhar ("0.775" = 0,775). No pacote eles já vão como números.
- **Preço**: custo × fator levado ao preço possível mais próximo da escada (sempre ,99): 19,99 (mínimo); de 5 em 5 até
  49,99; de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100 em 100 acima; empate fica com o
  maior (`precificacao.json → arredondamento`, modo "escada"; o modo antigo "terminar_em" continua aceito). As outras
  tabelas usam a mesma escada sem o mínimo. O app recalcula com as mesmas regras na importação; os valores da skill
  servem para a planilha do UP e para conferência. Se a loja digitou um preço à mão, use `precoManual`.
- **Planilha do UP**: toda célula de texto que começa com = + - @, tab ou enter ganha um apóstrofo na frente (não vira
  fórmula); números continuam números.
- **Pacote**: igual ao `cadastro.json`, mas cada item troca `foto` por `fotoBase64` (`data:image/jpeg;base64,…`).
