---
name: fiodeamor-cadastro
description: Cadastra semijoias da Fio de Amor a partir do pedido ou catálogo do fornecedor (PDF ou fotos) com preço, nome, referência, planilha do UP Vendas e envio ao app.
---

# Cadastro de peças · Fio de Amor Semijoias

Use esta skill quando alguém da loja enviar um **pedido ou catálogo de fornecedor** (PDF, quase sempre chinês, ou fotos)
e pedir para cadastrar, precificar, dar nome ou gerar a planilha do UP Vendas.
Fale sempre em **português do Brasil**, de forma simples: quem usa é a equipe da loja, não programadores.

O resultado é sempre:
1. as **planilhas do UP Vendas** (XLSX e CSV), como as do app: **produtos novos** (cadastro no UP) e **recompras**
   (entrada de estoque de produtos que já existem no UP);
2. o **cadastro para o app** da loja (`cadastro-<pedido>.json`), enviado sozinho quando a skill está conectada;
3. um **resumo** para conferência.

As regras vêm de `referencias/` (as mesmas do app): `precificacao.json` (fator, arredondamento, tabelas),
`taxonomia.json` (tipos, materiais, banhos, cores, glossário chinês, referência), `marca.json` (padrão de nomes e tom de voz),
`fiscal.json` (NCM, cenário de custo) e `sistema.json`. O formato do cadastro está em `referencias/formato-cadastro.md`.
Leia `referencias/classificacao-e-nomes.md` antes de classificar.

## Passo a passo

Trabalhe numa pasta própria (ex.: `/tmp/cadastro`). Os scripts estão em `scripts/` desta skill; chame-os com o caminho
completo. Se faltar biblioteca: `pip install pymupdf openpyxl pillow`.

### 0. Perguntas rápidas (só o que faltar)
- **Frete** do pedido em R$ (pedidos da China). Sem frete, o custo fica só a mercadoria: avise.
- **Fator** do pedido, se a loja quiser um diferente do padrão (×10). Abaixo de ×10 só com a gestora: confirme. No app,
  fator abaixo do mínimo (e preço manual abaixo dele) **só vale se quem importar o cadastro for a gestora**, logada, em
  "Importar pedido → Cadastro feito no Claude". Enviado pela skill (passo 8, pela chave) ou importado por uma
  funcionária, o app usa o fator mínimo e descarta o preço manual abaixo dele — o resumo avisa quando houver.
- **Data da compra**, se o documento não trouxer (a cotação é a do dia da compra).
Não pergunte o que dá para ler no documento.

### 1. Conectar ao app (se houver)
```
python3 scripts/app.py contexto --saida /tmp/cadastro/contexto.json
```
- Deu certo: use `--contexto /tmp/cadastro/contexto.json` nos passos seguintes (regras atuais, próximas referências e as
  peças já cadastradas, para reconhecer **recompra**).
- Código 2 (sem conexão): siga sem o app. Se a pessoa tiver a **lista de produtos exportada do UP**, peça e use em
  `--lista-up` no passo 5 (serve para recompra e para continuar a numeração). Sem nada disso, pergunte a última
  referência usada no mês de cada tipo (ou siga e avise que começou em 001).

### 2. Ler o pedido
```
python3 scripts/extrair_pdf.py pedido.pdf --saida /tmp/cadastro
```
Cria `cadastro.json` (pedido + itens com código, especificação, descrição, quantidade, preço e foto) e `fotos/`.
Confira o resumo: **linhas, peças e total devem bater com o documento**. Se não bater, olhe as páginas e corrija o
`cadastro.json` antes de seguir (avise o que corrigiu).
- **Especificação/cor do fornecedor** (G, MR, 14KF, 金色, 玫瑰金, MR白油, tamanho 16 ou 18号…): é a célula logo antes do
  preço. Não é especificação a sequência, o código repetido nem a descrição. Ela entra na chave da recompra: não mude.
- **Moeda**: só vale com marca no documento — dólar (US$, USD, 美元) > real (R$, BRL) > yuan (¥, RMB, 元, 人民币).
  Sem marca, `pedido.moeda` fica vazia e o resumo avisa: **pergunte à pessoa** (yuan, dólar ou real) e grave
  `CNY`, `USD` ou `BRL` (ou use `--moeda` no passo 6). Não adivinhe pelo chinês.
- **Quantidade 0 continua 0** (não vira 1): confirme com a pessoa se a peça veio mesmo. Linha sem preço × quantidade
  legível fica com quantidade 1 e sem preço, com aviso: corrija pelo documento.
- **Números escritos como texto** valem do jeito brasileiro ou não: "10,5" ou "10.5"; "1.234,56" ou "1,234.56";
  "R$", "¥", "US$", "RMB" e espaços são ignorados. Ponto de milhar só no formato 1.234 e só em dinheiro: em cotação e
  fator o ponto é sempre decimal ("0.775" é 0,775).
Fotos de catálogo (sem tabela): o script copia as imagens para `paginas/`; identifique as peças olhando as fotos e
preencha os itens você mesmo (recorte com Pillow e salve em `fotos/linha-NNN.jpg`).

### 3. Cotação
```
python3 scripts/ptax.py AAAA-MM-DD --moeda CNY > /tmp/cadastro/ptax.json
```
PTAX de venda do boletim de fechamento do Banco Central na data da compra (fim de semana/feriado = último dia útil),
na moeda do pedido (`--moeda CNY` ou `USD`).
Guarde a saída (JSON) em `/tmp/cadastro/ptax.json`: ela entra no passo 6.
Se a rede bloquear (código 2), abra com a ferramenta de busca da web a URL que o script mostrar
(`https://www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv`) e passe o arquivo baixado com `--csv arquivo.csv`,
ou peça a cotação à pessoa e use `--cotacao` no passo 6.
**A cotação nunca vira 1** (só o real, BRL, é 1). Se faltar, o `calcular.py` tenta buscar a PTAX da data da compra;
sem conseguir, deixa os preços **pendentes** (código 2) e diz o que fazer.

### 4. Classificar e dar nome (você)
Para cada item, olhando a **foto** e a linha do documento, preencha no `cadastro.json`:
`traducao`, `tipo`, `subtipo`, `material`, `banho`, `corPedra`, `tamanho`, `variacao`, `ehConjunto`, `componentes`,
`estilo`, `nome` (padrão do UP), `nomeComercial`, `nomesSugeridos` (3 opções), `avaliacao` (1–2 frases), `destaque`
(as peças de maior apelo) e `alertas` (dúvidas). Use **só os ids** de `taxonomia.json`. Regras em
`referencias/classificacao-e-nomes.md`. Trabalhe em lotes de ~15 itens e grave o arquivo a cada lote.

### 5. Recompra e referências
```
python3 scripts/referencias.py /tmp/cadastro/cadastro.json [--contexto contexto.json | --lista-up produtos-up.xlsx]
```
Peça já comprada antes usa a referência, o nome, o **código de barras do UP** e o **preço vigente** da original. A chave da recompra é a
mesma do app: **fornecedor** (nome original, sem espaços, minúsculas) + **código do fornecedor** + **especificação**
(os dois em maiúsculas, sem espaço, hífen ou ponto; letras de largura total viram normais: "abc-123 a" = "ＡＢＣ１２３Ａ").
- Exatamente **um** original com a mesma chave → recompra (`recompraDe` = referência do original).
- Mais de um original possível (ou especificação/fornecedor vazios de um dos lados) → **recompra a confirmar**:
  a peça ganha `recompraCandidatas` (as referências possíveis), fica sem referência e fora das planilhas do UP.
  **Na dúvida a skill não decide; o app mostra "Recompra a confirmar"**: mostre as opções à pessoa (a saída do script
  traz cada uma) e peça para escolher no app ("É esta" ou "Não é recompra").
- Pedido **sem o nome do fornecedor** → só candidatas, nunca recompra automática. Com a lista do UP (sem o app), tudo o
  que ela achar fica "a confirmar" (a lista não tem fornecedor nem especificação).

As variações (mesmo código do fornecedor, **recompras incluídas**) dividem a referência; o grupo com recompra usa a
referência da original. As novas seguem `BR_2611001` (prefixo do tipo + ano + mês + sequência).

### 6. Preço
```
python3 scripts/calcular.py /tmp/cadastro/cadastro.json --ptax /tmp/cadastro/ptax.json --frete 850 [--fator 10] [--contexto /tmp/cadastro/contexto.json]
```
(`--cotacao 0,7745` no lugar de `--ptax` quando a cotação veio da pessoa; `--contexto` quando o app respondeu no passo 1;
`--moeda CNY|USD|BRL` quando o documento não mostrava a moeda.)
Custo da peça = preço × cotação × (1 + frete ÷ mercadoria em R$). Preço = custo × fator (padrão ×10), levado ao
**preço possível mais próximo da escada** (sempre ,99): 19,99 (mínimo); de 5 em 5 até 49,99; de 10 em 10 até 99,99;
de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100 em 100 acima; empate fica com o maior. Ex.: 27,30 → 24,99;
87,80 → 89,99; 355,50 → 349,99. As outras tabelas (atacado, liquidação) usam a mesma escada, sem o mínimo.
Preço digitado pela loja vai em `precoManual`; fator só de uma peça vai em `fator`.
**Recompra fica com o preço vigente da original** (no UP é um produto só, com um preço só): o `referencias.py` guarda
o preço atual da original (`precoVigente`, do contexto do app) e o `calcular.py` mantém esse preço. O preço pelo custo
novo é calculado mesmo assim; se diferir mais de 10%, a peça ganha o alerta "Custo mudou: preço vigente R$ X, pelo
custo novo R$ Y (±Z%)" — mostre para a gestora decidir no app. Sem o preço no contexto (sem o app), calcula normal.
**Custos padrão da loja**: se o `sistema.json` (ou o contexto do app) trouxer `perdasPctPadrao` (% de perdas e
defeitos) ou `embalagemPorPecaPadrao` (R$ de embalagem e etiqueta por peça), eles entram no custo quando o pedido não
traz esses valores em `custos` — como o app faz no pedido novo. O resumo mostra em "Outros custos".
Mostre os alertas (ex.: fator abaixo do mínimo — o fator escolhido, não o arredondado: a escada arredondar para baixo
não gera alerta) e os avisos (moeda, cotação pendente, quantidade 0, fator ou preço manual abaixo do mínimo, que no
app só valem se a gestora importar).
Códigos de saída: 0 = ok; 2 = preços pendentes (falta a cotação ou a moeda); 1 = erro.

### 7. Saídas
```
python3 scripts/gerar_saidas.py /tmp/cadastro/cadastro.json --saida /tmp/cadastro/saida [--contexto /tmp/cadastro/contexto.json]
```
Gera as mesmas duas planilhas do app (só as que têm linhas), o `cadastro-<pedido>.json` e o `resumo-<pedido>.md`:
- `planilha-up-novos-<pedido>.xlsx` / `.csv` — **produtos novos**: cadastro completo no UP ("Cadastro de Produtos
  Simplificado"). Peça nova vai **sem código de barras** — o UP Vendas cria no cadastro (é o código que a loja usa).
- `planilha-up-recompras-<pedido>.xlsx` / `.csv` — **recompras**: entrada de estoque de produtos que JÁ existem no UP
  (código de barras do UP + quantidade; linhas com o mesmo código somam a quantidade e o custo é a média ponderada;
  quantidade 0 fica de fora). Recompra **não** vai na planilha de novos (duplicaria o produto no UP). Recompra sem o
  código do UP vai sem código, pela referência: traga os códigos no app antes de dar a entrada.
As células são protegidas como no app: texto que começa com = + - @ (ou tab/enter) ganha um apóstrofo na frente, para
não virar fórmula no Excel; números continuam números. A quantidade 0 vai 0 no estoque.
**Recompra a confirmar** vai no cadastro do app e no resumo, mas fica **fora das duas planilhas**: depois de decidir no
app, baixe a planilha do UP pelo app.
As planilhas da skill vão sem o link da foto (as fotos ficam no app); com o app na internet, a planilha baixada pelo
app (pedido → Planilha UP) leva o link para o UP baixar a foto.

### 8. Enviar ao app
```
python3 scripts/app.py enviar /tmp/cadastro/saida/cadastro-<pedido>.json
```
Conectado: o pedido aparece no app (mostre o link que o script devolve) e o app confere a recompra de novo.
Sem conexão: entregue o `cadastro-<pedido>.json` e diga para importar no app em
**Importar pedido → Cadastro feito no Claude**.

### 9. Entrega
Apresente os arquivos (planilhas do UP, cadastro, resumo) e um resumo curto: linhas, peças, total conferido,
cotação usada, frete, custo, venda potencial, recompras, **recompras a confirmar** (com as opções), alertas e avisos
que precisam de decisão. Lembre os próximos passos:
1. importar no UP Vendas a planilha de **produtos novos** (ele cria os códigos de barras) e dar a entrada de estoque das
   **recompras** pela planilha de recompras;
2. no app, trazer os códigos do UP (UP Vendas → Códigos de barras do UP, ou bipar em "Códigos do UP" no pedido);
3. no app, criar as fotos com IA, aprovar e imprimir as etiquetas.

## Cuidados
- Nunca invente preço, quantidade, moeda ou código: o documento manda. Na dúvida, alerta (e pergunte).
- Recompra: na dúvida a skill não decide; a confirmação é no app ("Recompra a confirmar").
- Não mude regras de preço por conta própria: fator, frete e arredondamento vêm de `precificacao.json` (ou do contexto do app).
- Fator ou preço manual abaixo do mínimo: só a gestora usa no app (importando logada); avise a pessoa.
- O nome do fornecedor fica **como está no documento** (em chinês): é por ele que a recompra reconhece as peças.
- Não exponha a chave de `conexao.json` em respostas.
