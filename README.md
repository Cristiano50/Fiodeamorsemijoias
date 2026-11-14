# Fio de Amor Semijoias · Cadastro de produtos

Aplicativo da **Fio de Amor Semijoias** para cadastrar as peças que chegam dos fornecedores:

1. **Importa o pedido ou catálogo** (PDF do fornecedor ou fotos). O app recorta a foto de cada peça e lê código, descrição, preço e quantidade. No pedido de exemplo, leu 72 de 72 linhas e o total bateu com o documento.
2. **Converte a moeda pela cotação do dia da compra.** Usa a PTAX de venda do boletim de fechamento do Banco Central, que inclui o **yuan (CNY)**; em fim de semana ou feriado, usa o último dia útil. Exemplo: pedido de 26/09/2026 (sábado) → PTAX de 25/09/2026, R$ 0,7745 por yuan.
3. **Calcula custo e preço:**
   - custo da peça = preço × cotação × (1 + **frete ÷ valor da mercadoria em R$**). O frete do pedido (campo "Frete") é rateado pelo valor de cada peça. Ex.: frete de R$ 850 sobre R$ 6.370,96 de mercadoria = +13,34% em cada peça. Também há os cenários de importação do contador, com impostos;
   - preço = custo × **fator multiplicador**, com arredondamento para ,99;
   - o **funcionário digita o fator** num campo em branco no pedido (vale para todas as peças) ou numa peça específica; em branco, vale o padrão da loja (×10). Fator abaixo de 10 gera alerta;
   - tabelas Consignado, Varejo, Atacado e Liquidação.
4. **Classifica cada peça com IA (Claude):** material (semijoia, prata, aço…), tipo (brinco, colar, anel, pulseira, bracelete, óculos, relógio…), subtipo, banho, cor da pedra (zircônia, cristal, azul, preto, pérola, esmalte…) e tamanho (único, aro de anel, comprimento). Também traduz o chinês e **avalia a peça, sugerindo 3 nomes de cadastro** no padrão `BRINCO (SJ) …` e um nome comercial.
5. **Gera a referência e usa o código de barras do UP Vendas:**
   - referência por tipo: `BR_2611001` (brinco), `CL_` colar, `AN_` anel, `PU_` pulseira, `BC_` bracelete…; variações da mesma peça compartilham a referência;
   - o **código de barras é o que o UP cria** no cadastro. A planilha vai sem código para o UP gerar o dele;
   - os códigos voltam para o app de dois jeitos: pela lista de produtos exportada do UP (**UP Vendas → Códigos de barras do UP**), que liga cada código à peça pela referência e pela grade, ou bipando no pedido (**Códigos do UP**);
   - a recompra herda o código da peça original, e as etiquetas, as vendas e o catálogo usam o código do UP;
   - se um dia preferir, em Configurações → Referência e código de barras dá para voltar ao EAN-13 interno do app (`91…`).
6. **Imprime etiquetas:** rabicho térmico 95×12 mm, folha A4 Pimaco (6180 e 6187) e cartela de brinco.
7. **Fotos com IA (padrão: peça em expositor):**
   - botão **"Criar foto com IA"** em cada produto do catálogo, em cada linha do pedido e na ficha do produto;
   - a IA (Google **Gemini 3 Pro Image** ou OpenAI **gpt-image-2**) cria a foto da peça real no **expositor de veludo da loja**: bandeja, caixinha de anel, busto ou suporte de brinco, de acordo com o tipo. Também pode ser numa modelo;
   - em **Configurações → Fotos de referência**, cadastre fotos no estilo da loja por tipo de peça. A IA recebe a foto da peça e a referência do mesmo tipo e reproduz o cenário;
   - o **especialista de marketing** (IA com visão) compara com a peça real e aprova pela rubrica da marca (fidelidade, realismo, apelo comercial, identidade e limpeza). Se reprovar, gera de novo com os ajustes, em até 3 tentativas;
   - pode gerar para o pedido inteiro de uma vez. As artes (feed, stories, quadrado, catálogo) usam a foto aprovada como base; também há legenda e hashtags.
8. **Envia para o UP Vendas:** por **planilha** com os campos da tela "Cadastro de Produtos Simplificado", que funciona hoje, ou por API. O conector da API está pronto, mas falta a documentação do UP; veja [docs/upvendas-suporte.md](docs/upvendas-suporte.md), que traz uma mensagem pronta para o suporte.
9. **Especialistas:** um comitê de IA avalia cada pedido pelo olhar do **gestor de estoque, do contador, do administrador e do marketing**. Os mesmos especialistas existem como subagentes do Claude Code em `.claude/agents/`.
10. **Recompra inteligente:** ao importar de novo uma peça que já veio antes (mesmo código e especificação do fornecedor), o app reaproveita a referência, o EAN, o nome e a classificação, sem gastar IA. Mostra também quanto o preço do fornecedor mudou. Se não for recompra, use **Não é recompra**. O nome do fornecedor fica guardado como veio no documento (ex.: em chinês), porque é por ele que a recompra reconhece as peças. No pedido, **renomear** dá um apelido ao fornecedor, que aparece nas telas ao lado do nome original e vale para todos os pedidos dele.
11. **Fotos para aprovar:** fila com a peça real ao lado da foto criada pela IA e a nota do marketing. A loja aprova, pede para refazer ou recusa. Só a foto **aprovada pela loja** vai para o catálogo do WhatsApp/Instagram e para o UP.
12. **Pedido no celular:** no celular, as linhas do pedido viram cartões com foto, preço, fator e botões grandes.
13. **Usuários e permissões:**
    - a **gestora** vê tudo;
    - a **funcionária** cadastra, mas não usa fator abaixo do mínimo, não exclui e não mexe em Configurações;
    - o **Histórico** registra quem mudou o quê (fator, preço, cotação, fotos, envio ao UP).
14. **Gastos com IA:** custo estimado por mês, por uso, por pedido e por dia, em dólar e em real. Tem limite mensal: ao atingir o limite, o app para de chamar a IA.
15. **Backup automático:** uma cópia por dia do banco, guardando as 14 mais recentes, com botão **Baixar backup agora**. Para usar na nuvem, veja [docs/nuvem.md](docs/nuvem.md).
16. **Catálogo do WhatsApp Business e Instagram Shopping:** link de feed (CSV) para o Commerce Manager da Meta, com preço, estoque, foto aprovada e um link que abre a conversa no WhatsApp da loja.
17. **Vendas e recompra:** importe a planilha de vendas exportada do UP (CSV ou XLSX). O app liga cada venda à peça pelo código de barras e calcula:
    - giro, *sell-through* e curva ABC;
    - peças paradas e o ranking das revendedoras;
    - a **lista de recompra**, em planilha com foto, código do fornecedor e quantidade sugerida, com uma aba por fornecedor, pronta para mandar à China (sem preços).

    A mesma planilha pode ser importada de novo sem duplicar as vendas, e a gestora pode desfazer uma importação.
18. **Maleta inteligente:** escolha a revendedora e o valor e a quantidade de peças da maleta. O app sugere o mix pelo que ela mais vende, pelo giro da loja e pelas novidades, e explica o motivo de cada peça. Dá para trocar, remover, imprimir ou exportar o romaneio em CSV.

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

Depois disso, abra **http://localhost:3000**. Os dados ficam em `./dados/fiodeamor.db`. O app faz um backup por dia em `./dados/backups/`; mesmo assim, copie de vez em quando um backup para fora do computador (pen drive ou nuvem).

**Primeiro acesso:** em **Configurações → Usuários**, crie a conta da gestora. A partir daí, o app pede login e a gestora cria as contas das funcionárias.

As chaves das IAs podem ser coladas no próprio app, em **Configurações → Integrações**, ou em um arquivo `.env.local` (veja o modelo em `.env.example`):

| Para quê | Variável | Onde obter |
| --- | --- | --- |
| Análise das peças, nomes, legendas, parecer | `ANTHROPIC_API_KEY` | console.anthropic.com |
| Fotos com modelo (recomendado) | `GEMINI_API_KEY` | aistudio.google.com |
| Fotos com modelo (alternativa) | `OPENAI_API_KEY` | platform.openai.com |
| Senha de acesso ao app (se estiver na internet) | `APP_SENHA` | você escolhe |

Sem as chaves o app continua funcionando:
- a importação lê preço e quantidade sozinha;
- você classifica e dá nome às peças manualmente;
- as artes da marca são feitas no navegador.

## Como rodar na nuvem (acesso pelo celular)

O banco usa libSQL, então o mesmo código roda com um banco [Turso](https://turso.tech) (`DATABASE_URL` + `DATABASE_AUTH_TOKEN`). Publique na [Vercel](https://vercel.com) importando o repositório e definindo as variáveis acima. **Crie a conta da gestora logo no primeiro acesso.** O passo a passo, inclusive como levar o banco da loja para a nuvem e como restaurar um backup, está em [docs/nuvem.md](docs/nuvem.md).

## Fluxo de trabalho

1. **Importar pedido:** arraste o PDF ou as fotos. Confira a data da compra, a moeda e a cotação (vem sozinha) e clique em *Criar pedido*.
2. No **pedido**, revise:
   - o cenário de custo e os componentes (frete, taxa do agente, impostos);
   - os nomes (escolha entre as sugestões), o tipo e o banho;
   - os alertas da IA.

   Use **Parecer dos especialistas** para uma análise do pedido.
3. **Gerar referências** → **Aprovar**.
4. Em cada produto, abra o **Estúdio de fotos** para criar as artes e as fotos com modelo.
5. **UP Vendas:** baixe a planilha e cadastre no UP. O UP cria o código de barras de cada peça.
6. **Traga os códigos do UP:** exporte a lista de produtos do UP e envie em **UP Vendas → Códigos de barras do UP**, ou bipe no pedido em **Códigos do UP**.
7. **Etiquetas**, já com o código do UP.

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

O comando testa o cálculo de EAN-13, a referência, o custo e o preço (com frete e fator), a leitura das linhas do pedido, o feed da Meta e os cálculos de vendas, curva ABC, recompra e maleta.

Para testar a leitura de um PDF real (o arquivo não vai para o GitHub):

```bash
npx tsx scripts/testar-extracao.mts caminho/do/pedido.pdf
```

## Privacidade

A pasta `amostras/` (pedidos reais, custos dos fornecedores) e a pasta `dados/` (banco local e backups) **não são enviadas** ao GitHub.
