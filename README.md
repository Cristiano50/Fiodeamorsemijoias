# Fio de Amor Semijoias · Cadastro de produtos

Aplicativo da **Fio de Amor Semijoias** para cadastrar as peças que chegam dos fornecedores:

1. **Importa o pedido ou catálogo** (PDF do fornecedor ou fotos). O app recorta a foto de cada peça e lê código, descrição, preço e quantidade. No pedido de exemplo, leu 72 de 72 linhas e o total bateu com o documento.
2. **Converte a moeda pela cotação do dia da compra.** Usa a PTAX de venda do Banco Central; em fim de semana ou feriado, usa o último dia útil.
3. **Calcula custo e preço:**
   - custo = preço × cotação (ou o custo real de importação, se você escolher um cenário do contador);
   - preço = custo × **fator multiplicador**, por faixa de custo ou por tipo, com arredondamento para ,99;
   - tabelas Consignado, Varejo, Atacado e Liquidação.
4. **Classifica cada peça com IA (Claude):** material (semijoia, prata, aço…), tipo (brinco, colar, anel, pulseira, bracelete, óculos, relógio…), subtipo, banho, cor da pedra (zircônia, cristal, azul, preto, pérola, esmalte…) e tamanho (único, aro de anel, comprimento). Também traduz o chinês e **avalia a peça, sugerindo 3 nomes de cadastro** no padrão `BRINCO (SJ) …` e um nome comercial.
5. **Gera referência e código de barras:**
   - referência por tipo: `BR_2611001` (brinco), `CL_` colar, `AN_` anel, `PU_` pulseira, `BC_` bracelete…;
   - **EAN-13 interno** `91…`, com dígito verificador;
   - variações da mesma peça compartilham a referência.
6. **Imprime etiquetas:** rabicho térmico 95×12 mm, folha A4 Pimaco (6180 e 6187) e cartela de brinco.
7. **Estúdio de fotos para publicidade:**
   - artes com a identidade da marca (feed, stories, quadrado, catálogo/WhatsApp, vitrine), feitas no navegador e sem custo;
   - **foto com modelo gerada por IA** (Google Gemini ou OpenAI) a partir da foto do catálogo, mantendo a peça fiel;
   - legenda e hashtags.
8. **Envia para o UP Vendas:** por API (conector configurável) ou por **planilha** com os campos da tela "Cadastro de Produtos Simplificado".
9. **Especialistas:** um comitê de IA avalia cada pedido pelo olhar do **gestor de estoque, do contador, do administrador e do marketing**. Os mesmos especialistas existem como subagentes do Claude Code em `.claude/agents/`.

## Como rodar (no computador da loja)

Requisitos: [Node.js 20 ou mais novo](https://nodejs.org).

```bash
git clone https://github.com/Cristiano50/fiodeamorsemijoias.git
```

```bash
cd fiodeamorsemijoias
```

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Depois disso, abra **http://localhost:3000**. Os dados ficam em `./dados/fiodeamor.db`. Faça backup dessa pasta.

As chaves das IAs podem ser coladas no próprio app, em **Configurações → Integrações**, ou em um arquivo `.env.local` (veja o modelo em `.env.example`):

| Para quê | Variável | Onde obter |
| --- | --- | --- |
| Análise das peças, nomes, legendas, parecer | `ANTHROPIC_API_KEY` | console.anthropic.com |
| Fotos com modelo (opção 1) | `GEMINI_API_KEY` | aistudio.google.com |
| Fotos com modelo (opção 2) | `OPENAI_API_KEY` | platform.openai.com |
| Senha de acesso ao app (se estiver na internet) | `APP_SENHA` | você escolhe |

Sem as chaves o app continua funcionando:
- a importação lê preço e quantidade sozinha;
- você classifica e dá nome às peças manualmente;
- as artes da marca são feitas no navegador.

## Como rodar na nuvem (acesso pelo celular)

O banco usa libSQL, então o mesmo código roda com um banco [Turso](https://turso.tech) (`DATABASE_URL` + `DATABASE_AUTH_TOKEN`). Publique na [Vercel](https://vercel.com) importando o repositório e definindo as variáveis acima. **Defina `APP_SENHA`**.

## Fluxo de trabalho

1. **Importar pedido:** arraste o PDF ou as fotos. Confira a data da compra, a moeda e a cotação (vem sozinha) e clique em *Criar pedido*.
2. No **pedido**, revise:
   - o cenário de custo e os componentes (frete, taxa do agente, impostos);
   - os nomes (escolha entre as sugestões), o tipo e o banho;
   - os alertas da IA.

   Use **Parecer dos especialistas** para uma análise do pedido.
3. **Gerar referências e EAN** → **Aprovar** → **Etiquetas**.
4. Em cada produto, abra o **Estúdio de fotos** para criar as artes e as fotos com modelo.
5. **UP Vendas:** baixe a planilha ou envie pela API.

## Estrutura

```
src/app/            telas (Next.js) e rotas /api
src/lib/            regras: precos.ts (custo/fator), codigos.ts (EAN/referência), cambio.ts (PTAX),
                    extracao.ts + pdf-cliente.ts (leitura do pedido), upvendas.ts, ai/ (Claude, Gemini/OpenAI)
src/config/         regras definidas pelos especialistas (editáveis em Configurações):
                    taxonomia.json (estoque), fiscal.json (contador), precificacao.json (administrador), marca.json (marketing)
docs/especialistas/ pareceres completos de cada especialista + pesquisa de sistemas semelhantes
.claude/agents/     subagentes do Claude Code: gestor-estoque, contador, administrador, marketing
scripts/            utilitários (migrações, teste de extração de PDF)
```

## Testes

```bash
npm test
```

O comando testa o cálculo de EAN-13, a referência, o custo e o preço, e confere a leitura das linhas do pedido.

Para testar a leitura de um PDF real (o arquivo não vai para o GitHub):

```bash
npx tsx scripts/testar-extracao.mts caminho/do/pedido.pdf
```

## Privacidade

A pasta `amostras/` (pedidos reais, custos dos fornecedores) e a pasta `dados/` (banco local) **não são enviadas** ao GitHub.
