---
name: fiodeamor-cadastro
description: Cadastra semijoias da Fio de Amor a partir do pedido ou catálogo do fornecedor (PDF ou fotos) com preço, nome, referência, planilha do UP Vendas e envio ao app.
---

# Cadastro de peças · Fio de Amor Semijoias

Use esta skill quando alguém da loja enviar um **pedido ou catálogo de fornecedor** (PDF, quase sempre chinês, ou fotos)
e pedir para cadastrar, precificar, dar nome ou gerar a planilha do UP Vendas.
Fale sempre em **português do Brasil**, de forma simples: quem usa é a equipe da loja, não programadores.

O resultado é sempre:
1. a **planilha do UP Vendas** (XLSX e CSV) para importar no UP;
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
- **Fator** do pedido, se a loja quiser um diferente do padrão (×10). Abaixo de ×10 só com a gestora: confirme.
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
Fotos de catálogo (sem tabela): o script copia as imagens para `paginas/`; identifique as peças olhando as fotos e
preencha os itens você mesmo (recorte com Pillow e salve em `fotos/linha-NNN.jpg`).

### 3. Cotação
```
python3 scripts/ptax.py AAAA-MM-DD --moeda CNY
```
PTAX de venda do boletim de fechamento do Banco Central na data da compra (fim de semana/feriado = último dia útil).
Se a rede bloquear (código 2), abra com a ferramenta de busca da web a URL que o script mostrar
(`https://www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv`, linha do CNY, coluna de venda) ou peça a cotação à pessoa.
Grave em `pedido.cotacao`, `pedido.cotacaoData` e `pedido.cotacaoFonte`. Grave também `pedido.frete` e `pedido.fator`.

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
Peça já comprada antes usa a referência, o nome e o **código de barras do UP** da original. As variações (mesmo código
do fornecedor) dividem a referência. As novas seguem `BR_2611001` (prefixo do tipo + ano + mês + sequência).

### 6. Preço
```
python3 scripts/calcular.py /tmp/cadastro/cadastro.json
```
Custo da peça = preço × cotação × (1 + frete ÷ mercadoria em R$). Preço = custo × fator (padrão ×10), arredondado para
cima terminando em ,99. Preço digitado pela loja vai em `precoManual`; fator só de uma peça vai em `fator`.
Mostre os alertas (ex.: fator abaixo do mínimo).

### 7. Saídas
```
python3 scripts/gerar_saidas.py /tmp/cadastro/cadastro.json --saida /tmp/cadastro/saida
```
Gera `planilha-up-<pedido>.xlsx` e `.csv`, `cadastro-<pedido>.json` e `resumo-<pedido>.md`.
**Código de barras:** peça nova vai **sem código** — o UP Vendas cria no cadastro (é o código que a loja usa).
Recompra vai com o código do UP da peça original.

### 8. Enviar ao app
```
python3 scripts/app.py enviar /tmp/cadastro/saida/cadastro-<pedido>.json
```
Conectado: o pedido aparece no app (mostre o link que o script devolve) e o app confere a recompra de novo.
Sem conexão: entregue o `cadastro-<pedido>.json` e diga para importar no app em
**Importar pedido → Cadastro feito no Claude**.

### 9. Entrega
Apresente os arquivos (planilha do UP, cadastro, resumo) e um resumo curto: linhas, peças, total conferido,
cotação usada, frete, custo, venda potencial, recompras, alertas que precisam de decisão. Lembre os próximos passos:
1. importar a planilha no UP Vendas (ele cria os códigos de barras);
2. no app, trazer os códigos do UP (UP Vendas → Códigos de barras do UP, ou bipar em "Códigos do UP" no pedido);
3. no app, criar as fotos com IA, aprovar e imprimir as etiquetas.

## Cuidados
- Nunca invente preço, quantidade ou código: o documento manda. Na dúvida, alerta.
- Não mude regras de preço por conta própria: fator, frete e arredondamento vêm de `precificacao.json` (ou do contexto do app).
- O nome do fornecedor fica **como está no documento** (em chinês): é por ele que a recompra reconhece as peças.
- Não exponha a chave de `conexao.json` em respostas.
