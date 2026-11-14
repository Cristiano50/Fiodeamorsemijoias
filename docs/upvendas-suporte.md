# Integração com o UP Vendas

## Situação atual

| Forma | Status |
| --- | --- |
| **Planilha** (XLSX/CSV com os campos da tela "Cadastro de Produtos Simplificado") | ✅ Funciona hoje. Menu **UP Vendas → Planilha XLSX**, ou o botão **Planilha UP** na tela do pedido. |
| **API direta** (o app cria o produto no UP sozinho) | ⏳ O conector está pronto, mas falta a documentação da API de produtos, que o UP Vendas não publica. |

O que já se sabe sobre a API do UP:
- servidor `https://ms.upvendas.app`;
- login com **domínio, usuário e senha**, que devolve um token (JWT) no cabeçalho `Authorization`, usado como `Bearer` nas demais chamadas.

Esses dados vêm de um repositório público do módulo financeiro do UP. As rotas de **produto** não constam ali.

Quando o UP enviar a documentação, a configuração é feita no próprio app, em **Configurações → UP Vendas**, sem mexer no código:
- caminho do login;
- caminho de cadastro de produto;
- método (POST/PUT);
- mapa de campos.

Use **Simular envio** para ver o JSON que seria enviado, antes de ativar.

## Mensagem para o suporte do UP Vendas

> Olá! Sou da **Fio de Amor Semijoias**, cliente do UP Vendas. Estamos integrando nosso sistema de cadastro de produtos (importação de pedidos de fornecedores, precificação, código de barras e fotos) ao UP Vendas e precisamos de:
>
> 1. **Documentação da API de produtos** (Swagger/OpenAPI ou PDF). Precisamos das rotas para:
>    - criar e atualizar produto, com referência, código externo, NCM, unidade, marca, categoria vitrine e custos (compra bruto, insumo, banhos, milésimos);
>    - cadastrar a tabela de preço (% lucro e valor), a grade/variações com código de barras e o saldo de estoque;
>    - enviar a foto do produto;
>    - consultar produto por referência ou por código de barras.
> 2. **Ambiente de homologação** (se houver) e a URL de produção.
> 3. **Usuário de integração** (domínio, usuário e senha, ou token) com permissão para cadastrar produtos.
> 4. Caso não haja API de produtos: o **modelo de planilha de importação** de produtos aceito pelo UP Vendas.
>
> Obrigada!

## Campos que o app envia (mesma ordem da tela do UP)

Nome do produto · Marca · Referência · Código Externo · NCM · Un. estoque · Categoria Vitrine · Custo Compra Bruto · Custo Insumo · Milésimos · Banho Ouro · Banho Prata · Banho Ródio · Banho Verniz · Custo Total · Tabela Preço 1 · % Lucro Tabela 1 · Valor Tabela 1 · Tabela Preço 2 · % Lucro Tabela 2 · Valor Tabela 2 · Descrição (grade) · Cód. Barras · Saldo Estoque · Ativo · Acabado · Compartilhar · Sincronizar com a Up vendas · foto (link).
