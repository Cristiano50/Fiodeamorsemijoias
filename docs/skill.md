# Skill do Claude: cadastro de peças (`fiodeamor-cadastro`)

O cadastro das peças pode ser feito **direto no Claude**. Você envia o PDF ou as fotos do fornecedor, e a skill faz o
mesmo que a tela "Importar pedido" do app:

- recorta a foto de cada peça;
- lê código, especificação (G, MR, 金色, 16…), quantidade e preço, e confere o total com o documento;
- reconhece a **moeda** pelas marcas do documento (US$ > R$ > ¥/RMB/元); sem marca, pergunta;
- busca a **PTAX** do dia da compra no Banco Central (a cotação nunca vira 1: sem ela, o preço fica pendente);
- aplica o **frete** (frete ÷ mercadoria × valor da peça) e o **fator** (padrão ×10), com o preço na **escada de
  preços** (19,99; de 5 em 5 até 49,99; de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100
  em 100 acima; sempre ,99);
- classifica (tipo, material, banho, pedra, tamanho), traduz o chinês e sugere os nomes no padrão do UP;
- reconhece **recompras** (fornecedor + código + especificação) e gera as **referências** (BR_2611001…); quando há mais
  de um original possível, não decide: a peça vai como **recompra a confirmar** e a escolha é no app;
- entrega as **planilhas do UP Vendas** (produtos novos e recompras, como as do app), o **cadastro para o app** e um
  **resumo**.

O app continua sendo a central: recebe o cadastro (sozinho ou por arquivo) e cuida do resto:

- confere a recompra de novo;
- traz os códigos de barras criados pelo UP;
- cria as fotos com IA e as etiquetas;
- registra as vendas e monta a maleta.

## Instalar (uma vez)

1. No app, abra **Configurações → Skill do Claude** e clique em **Baixar a skill conectada ao app**.
   - A versão conectada já leva o endereço do app e a chave.
   - A versão "sem conexão" só gera arquivos.
2. No Claude (site ou app), abra **Configurações → Capacidades**:
   - ligue **Execução de código e criação de arquivos**;
   - em **Acesso à rede**, deixe os gerenciadores de pacotes e acrescente `www4.bcb.gov.br` (cotação). Se o app estiver na internet, acrescente também o domínio dele (ex.: `fiodeamor.vercel.app`).
3. Em **Skills**, clique em **Enviar skill**, escolha o ZIP e deixe a skill ligada.
4. Opcional e recomendado: crie um **Projeto** "Cadastro Fio de Amor" no Claude e use os chats dele para os pedidos.

Nos planos Team e Enterprise, a administradora pode disponibilizar a skill para toda a equipe. Nos outros planos, cada
pessoa instala a sua.

## Usar

Num chat, anexe o PDF do pedido e escreva, por exemplo:

> cadastra esse pedido; frete R$ 850

A skill pergunta só o que faltar (frete, fator diferente de ×10, data da compra). No fim, entrega:

| Arquivo | Para quê |
| --- | --- |
| `planilha-up-novos-<pedido>.xlsx` / `.csv` | **Produtos novos**: cadastrar no UP Vendas. Vai **sem código de barras**, porque o UP cria o dele. |
| `planilha-up-recompras-<pedido>.xlsx` / `.csv` | **Recompras**: entrada de estoque de produtos que já existem no UP (código de barras do UP + quantidade; o mesmo código soma). |
| `cadastro-<pedido>.json` | O cadastro completo, com fotos, para o app. |
| `resumo-<pedido>.md` | Conferência: totais, recompras e alertas. |

- **Skill conectada e app na internet:** o pedido aparece no app sozinho, e o Claude mostra o link.
- **App só no computador da loja:** importe o `cadastro-<pedido>.json` no app em **Importar pedido → Cadastro feito no Claude**.

Depois:
1. No **UP Vendas**, importe a planilha de **produtos novos** (ele cria os códigos de barras) e dê a entrada de estoque das **recompras** pela planilha de recompras. Nas duas, texto com cara de fórmula (= + - @) ganha apóstrofo.
2. No app, traga os códigos do UP: em **UP Vendas → Códigos de barras do UP**, ou bipando em **Códigos do UP**, no pedido.
3. No app, crie as fotos com IA, aprove na fila e imprima as etiquetas.

## Como fica tudo organizado

- **Um pedido por cadastro.** O app não importa o mesmo cadastro duas vezes; reenviar só devolve o pedido já criado.
- **Referências:**
  - conectada ao app, a skill continua a numeração de onde o app parou;
  - sem conexão, usa a lista de produtos do UP ou pergunta a última referência do mês;
  - se a mesma referência já existir no app, o app troca e avisa no pedido. Nesse caso, baixe a planilha do UP pelo app.
- **Recompra:** a skill já marca a peça como recompra quando há exatamente um original com a mesma chave (fornecedor + código + especificação), e o app confere de novo com tudo o que já foi cadastrado. A recompra herda a referência e o código de barras do UP.
- **Recompra a confirmar:** com mais de um original possível (ou sem o nome do fornecedor no pedido), a skill não decide: a peça vai com as candidatas, sem referência e fora das planilhas do UP da skill. No app, abra o pedido, escolha "É esta" ou "Não é recompra" e baixe a planilha do UP pelo app.
- **Preço:** o app recalcula com as regras atuais, que são as mesmas da skill. A recompra fica com o preço vigente da peça original (no UP é um preço só); se o custo novo der mais de 10% de diferença, a peça ganha o alerta "Custo mudou". Os custos padrão da loja (perdas e defeitos, embalagem) entram como no pedido novo do app.
- **Fator abaixo do mínimo:** só vale se a **gestora** importar o cadastro, logada, em **Importar pedido → Cadastro feito no Claude**. Enviado pela skill ou importado por uma funcionária, o app usa o fator mínimo (×10) e descarta o preço manual abaixo dele; a skill avisa no resumo.
- **Histórico:** tudo o que chega pela skill fica registrado como "Skill do Claude".
- **Regras novas:** se mudar fator, taxonomia ou padrão de nomes em Configurações, baixe a skill de novo e reenvie no Claude. A skill conectada já usa as regras atuais do app automaticamente.

## Segurança

- A chave só permite ler as regras e as peças cadastradas e **enviar cadastros novos**. Ela não apaga nem altera o que já existe.
- Se a chave vazar, use **Gerar chave nova** em Configurações → Skill do Claude e baixe a skill conectada de novo.
- Só a gestora vê a chave e baixa a skill.

## Para quem mantém o código

- A skill fica em `skill/fiodeamor-cadastro/`, com `SKILL.md`, `scripts/` em Python e `referencias/`.
- O app monta o ZIP na hora (`GET /api/skill/baixar`), trocando as cópias de `referencias/*.json` pelas regras atuais do banco.
- **Rotas:**
  - `GET /api/skill/contexto`;
  - `POST /api/skill/cadastro`, que aceita o pacote em partes de até 3 MB, por causa do limite de 4,5 MB da Vercel;
  - `GET|POST /api/skill/info`, só para a gestora.
- O formato do pacote está em `skill/fiodeamor-cadastro/referencias/formato-cadastro.md`.
- **Testes dos scripts** (os vetores comuns com o app ficam em `tests/vetores/*.json`: especificação, moeda e escada):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s skill/fiodeamor-cadastro/scripts/testes
```

- **No Claude Code:** copie a pasta `skill/fiodeamor-cadastro` para `~/.claude/skills/` ou para `.claude/skills/` de um projeto.
