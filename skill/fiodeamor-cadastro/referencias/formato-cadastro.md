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
    "fornecedor": "广州宁裕铧首饰有限公司",   // nome ORIGINAL do documento (é o que a recompra usa)
    "dataCompra": "2026-09-26",              // AAAA-MM-DD
    "moeda": "CNY",                          // CNY | BRL | USD
    "cotacao": 0.7745,                       // R$ por 1 unidade da moeda (BRL = 1)
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
      "especificacao": "G",                 // coluna de especificação/cor do fornecedor (G, MR, 14K, MR粉油…)
      "descricaoOriginal": "21#纽扣耳钉",
      "quantidade": 12,
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
      "codigoBarras": null,                 // só o código CRIADO PELO UP (recompra). Peça nova: null (o UP gera)

      // preço (scripts/calcular.py preenche)
      "fator": null,                        // fator só desta peça (vence o do pedido)
      "precoManual": null,                  // preço fixado à mão (vence o fator)
      "custoProdutoBrl": 7.75, "custoAdicionalBrl": 1.03, "custoTotalBrl": 8.78,
      "fatorAplicado": 10, "precoVenda": 87.99,
      "precos": { "consignado": 87.99, "atacado": 52.99 },
      "ncm": "71171900",
      "alertas": []
    }
  ]
}
```

## Regras

- **Peça nova não leva código de barras**: o UP Vendas cria no cadastro. O app importa os códigos depois
  (UP Vendas → Códigos de barras do UP) ou recebe bipado no pedido.
- **Recompra** (mesmo código do fornecedor + mesma especificação + mesmo fornecedor de um cadastro anterior):
  `recompraDe` = referência original, `referencia` = a mesma, `codigoBarras` = o código do UP do original, se houver.
  O app confere de novo na importação.
- **Preço**: o app recalcula com as mesmas regras na importação; os valores da skill servem para a planilha do UP e
  para conferência. Se a loja digitou um preço à mão, use `precoManual`.
- **Pacote**: igual ao `cadastro.json`, mas cada item troca `foto` por `fotoBase64` (`data:image/jpeg;base64,…`).
