# Fio de Amor na nuvem: acesso pelo celular

Este guia explica, passo a passo e sem termos técnicos, como deixar o app da Fio de Amor na internet para usar no celular, de qualquer lugar. São dois serviços:

- **Turso**: guarda o banco de dados (produtos, pedidos, fotos e configurações);
- **Vercel**: roda o app e entrega um endereço como `https://fiodeamorsemijoias.vercel.app`.

No fim, há uma alternativa sem nuvem: deixar o app no computador da loja e abrir pelo celular no Wi-Fi da loja.

> **Atenção aos nomes dos botões e aos preços.** Os sites mudam menus, planos e valores com frequência. Os nomes abaixo eram os usados quando este guia foi escrito; os valores marcados com "confirme" precisam ser conferidos no site de cada serviço.

## Qual caminho escolher

| | Nuvem (Turso + Vercel) | Computador da loja (rede local) |
| --- | --- | --- |
| Acesso pelo celular | De qualquer lugar | No Wi-Fi da loja; de fora, com o túnel do Cloudflare ou a Tailscale ([acesso-de-fora.md](acesso-de-fora.md)) |
| Catálogo no WhatsApp e no Instagram (feed agendado) | Funciona | Só com o endereço na internet do Cloudflare Tunnel ([acesso-de-fora.md](acesso-de-fora.md)) |
| Computador ligado | Não precisa | Precisa ficar ligado com o app aberto |
| Custo | Mensalidades pequenas (veja "Custos") | Só a energia |
| Backup | Histórico do Turso | Automático, 1 por dia, em `dados/backups` |

## Antes de começar

1. Separe cerca de **1 hora**.
2. Tenha uma conta no **GitHub** com acesso ao repositório `Cristiano50/fiodeamorsemijoias`.
3. Tenha em mãos as chaves das IAs: **Anthropic** (console.anthropic.com) e **Google Gemini** (aistudio.google.com).
4. Se o app já está sendo usado no computador da loja, **faça um backup**: em Configurações, na aba **WhatsApp, catálogo Meta e backup**, clique em **Baixar backup agora**.

## Parte 1: criar o banco no Turso

Você vai sair desta parte com dois valores: a **URL do banco** (começa com `libsql://`) e o **token** (uma senha longa).

### Opção A: pelo site (mais fácil)

1. Acesse **turso.tech** e crie a conta (dá para entrar com o GitHub).
2. No painel (app.turso.tech), clique em **Create Database** (criar banco).
3. Dê o nome `fiodeamor` e escolha a região **mais perto do Brasil** que aparecer na lista.
4. Abra o banco criado e copie a **URL**, parecida com `libsql://fiodeamor-seuusuario.turso.io`. Ela será a `DATABASE_URL`.
5. Clique em **Create Token** (ou *Generate Token*), escolha **leitura e escrita** (*read & write* ou *full access*) e **sem validade** (ou a maior validade possível). Copie o token: ele aparece **uma vez só**. Ele será o `DATABASE_AUTH_TOKEN`.

### Opção B: pelo terminal

Instale o programa do Turso. No Mac:

```bash
brew install tursodatabase/tap/turso
```

No Linux ou no Windows com WSL:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

Depois rode, um de cada vez:

```bash
turso auth signup
```

```bash
turso db create fiodeamor
```

```bash
turso db show fiodeamor --url
```

```bash
turso db tokens create fiodeamor
```

O terceiro comando mostra a `DATABASE_URL` e o quarto mostra o `DATABASE_AUTH_TOKEN`. Se você já tem conta, use `turso auth login` em vez de `turso auth signup`.

### Levar os dados que já estão no computador (opcional)

Um banco novo começa vazio, e o app cria as tabelas sozinho no primeiro acesso. Se você quiser levar os produtos, pedidos e fotos que já estão no computador da loja:

1. Baixe um backup no app (Configurações → aba **WhatsApp, catálogo Meta e backup**). Use o arquivo baixado, e não o `dados/fiodeamor.db` em uso: o backup é uma cópia íntegra.
2. Crie o banco na nuvem **a partir do arquivo** (no lugar do `turso db create fiodeamor` acima):

```bash
turso db create fiodeamor --from-file caminho/do/fiodeamor-AAAA-MM-DD-HHmm.db
```

> Confirme este comando na documentação do Turso (procure "Migrate from SQLite" ou "import"). Ele pode ter mudado, pode ter limite de tamanho e às vezes exige o arquivo em "modo WAL". As fotos ficam dentro do banco, então o arquivo pode ser grande.

As chaves de IA salvas em Configurações → Integrações vão junto com o banco.

## Parte 2: publicar o app na Vercel

1. Acesse **vercel.com** e crie a conta com **Continue with GitHub**.
2. Clique em **Add New… → Project**.
3. Em **Import Git Repository**, escolha `Cristiano50/fiodeamorsemijoias`. Se ele não aparecer, clique em **Adjust GitHub App Permissions** e libere o acesso ao repositório.
4. A Vercel reconhece sozinha que é um app **Next.js**. Não mude os comandos de build.
5. Abra **Environment Variables** (variáveis de ambiente) e cadastre as variáveis da tabela abaixo, **antes** de clicar em Deploy.
6. Clique em **Deploy** e espere de 2 a 5 minutos. No fim, a Vercel mostra o endereço do app, por exemplo `https://fiodeamorsemijoias.vercel.app`.

### Variáveis

| Nome | O que colocar | Obrigatória? |
| --- | --- | --- |
| `DATABASE_URL` | A URL do Turso (`libsql://...`) | Sim |
| `DATABASE_AUTH_TOKEN` | O token do Turso | Sim |
| `SESSAO_SEGREDO` | Um segredo **longo e aleatório**, com 64 letras e números (veja abaixo). O nome antigo `APP_SEGREDO` também vale | Recomendada |
| `ANTHROPIC_API_KEY` | Chave do Claude (análise das peças, nomes e legendas) | Sim, para usar a IA |
| `GEMINI_API_KEY` | Chave do Gemini (fotos com IA) | Sim, para as fotos com IA |
| `NEXT_PUBLIC_URL_PUBLICA` | O endereço do app, sem barra no fim. Ex.: `https://fiodeamorsemijoias.vercel.app` | Opcional |

Outras variáveis opcionais:

- `OPENAI_API_KEY`: alternativa ao Gemini para as fotos;
- `UPVENDAS_SENHA`: senha da integração com o UP Vendas;
- `APP_SENHA`: senha única da equipe (veja a Parte 3).

**Como gerar o `SESSAO_SEGREDO`:** use um gerador de senhas (por exemplo, o do seu gerenciador de senhas) com 64 caracteres, ou rode no terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O `SESSAO_SEGREDO` assina o login de cada pessoa. Sem ele, o app cria um segredo sozinho e o guarda no banco (nunca sai do servidor). Se você trocar o segredo, todo mundo precisa entrar de novo. Não compartilhe esse valor. O login vale 14 dias (Configurações → Usuários) e cai na hora quando a pessoa é desativada, troca de senha ou de papel, ou clica em **Sair**, que desconecta todos os aparelhos daquele login.

**Para que serve o `NEXT_PUBLIC_URL_PUBLICA`:** é o endereço usado nos links das fotos do catálogo da Meta e do UP Vendas. Sem ele, o app usa o endereço por onde foi aberto, o que normalmente funciona. Se você cadastrar ou mudar essa variável depois do primeiro deploy, faça um novo deploy (Deployments → ⋯ → **Redeploy**), porque ela só passa a valer na publicação seguinte.

**Dica de velocidade:** em Settings → Functions → **Function Region**, escolha a região da Vercel mais perto da região do banco no Turso (por exemplo, São Paulo, se o banco estiver no Brasil). Banco e app longe um do outro deixam as telas lentas.

## Parte 3: primeiro acesso

> **Importante:** logo depois do deploy, enquanto não existe nenhum usuário, o app fica **aberto**. Quem tiver o link entra. Faça os passos 1 e 2 assim que o deploy terminar.

1. Abra o endereço do app no navegador.
2. Vá em **Configurações → Usuários** e crie a conta da **gestora**, com login e senha forte. A partir daí, o app pede login.
3. Crie as contas dos funcionários com o papel **funcionário**. O backup, por exemplo, é só da gestora.
4. Se quiser proteção desde o primeiro minuto, cadastre também a variável `APP_SENHA` (uma senha da equipe) antes do deploy. Enquanto não houver usuários, o app pede essa senha. Depois de criar os usuários, valem os logins individuais.
5. No celular, abra o endereço no Chrome (Android) ou no Safari (iPhone) e use **Adicionar à tela inicial**. O app vira um ícone, como os outros aplicativos.
6. Em Configurações, na aba **WhatsApp, catálogo Meta e backup**, preencha o número do WhatsApp e copie a URL do feed para o Commerce Manager da Meta (o passo a passo está na própria tela).

## Limites da nuvem

- **Tempo de cada operação.** A foto com IA pode levar até 2 minutos, e a análise de um pedido grande, alguns minutos. O app pede até 300 segundos (5 minutos) por operação. No plano grátis da Vercel (Hobby), esse limite só vale com o **Fluid Compute** ligado. Ele vem ligado nos projetos novos; confira em Settings → Functions. Sem ele, o limite cai para cerca de 60 segundos, e essas operações param no meio (erro 504). Confirme os limites atuais em vercel.com/docs.
- **Uso comercial.** Pelas regras da Vercel, o plano grátis (Hobby) é para uso pessoal e não comercial. Para uma loja, o indicado é o plano **Pro**. Confirme em vercel.com/pricing.
- **Tamanho dos envios.** A Vercel aceita no máximo cerca de **4,5 MB por envio**. O app já manda as fotos das peças em lotes pequenos (8 por vez), uma página por vez, e só guarda o PDF original se ele tiver menos de 3,5 MB. Se aparecer erro de arquivo grande (413), mande menos fotos de uma vez ou fotos menores.
- **As fotos ficam dentro do banco.** Cada foto ocupa espaço no Turso (algo entre 0,2 e 1 MB). Cada foto aberta também conta como uso na Vercel. Mil peças com 2 ou 3 fotos cada dão cerca de 1 a 2 GB. Acompanhe o espaço usado no painel do Turso.
- **Primeiro acesso do dia.** Depois de um tempo parado, a primeira tela pode levar alguns segundos para abrir.
- **Backup automático em arquivo** (a pasta `dados/backups`) só existe no computador da loja. Na nuvem, quem guarda o histórico é o Turso (veja "Backup e restauração").

## Custos aproximados

> Valores de referência em dólar, que **precisam ser confirmados** nos sites. Os planos mudam e o câmbio varia.

| Serviço | O que é cobrado | Custo aproximado |
| --- | --- | --- |
| Turso | Banco de dados | Plano grátis com alguns GB de espaço e um histórico curto para restauração. Planos pagos a partir de cerca de US$ 5 por mês, com mais espaço e mais dias de histórico. Confirme em turso.tech/pricing. |
| Vercel | Hospedagem do app | Hobby: grátis, só para uso não comercial. Pro: cerca de US$ 20 por mês por pessoa com acesso ao painel da Vercel (quem usa o app não paga). Confirme em vercel.com/pricing. |
| Anthropic (Claude) | Por uso | Centavos de dólar por peça analisada. Um pedido inteiro costuma custar poucos dólares. Confirme em anthropic.com/pricing. |
| Google Gemini (fotos) | Por foto gerada | Cerca de US$ 0,13 por foto no modelo Pro e US$ 0,07 no Flash. Com até 3 tentativas por peça, o custo pode triplicar. Confirme em ai.google.dev/pricing. |
| Domínio próprio (opcional) | Endereço como `app.fiodeamor.com.br` | Cerca de R$ 40 por ano no registro.br. |

A tela **Gastos com IA** do app mostra quanto foi gasto e permite definir um limite mensal.

## Backup e restauração

### No computador da loja (banco em arquivo)

- O app faz **um backup automático por dia** em `dados/backups`, com nomes como `fiodeamor-2026-11-14-0930.db`, e guarda os **14 mais recentes**.
- Em Configurações, na aba **WhatsApp, catálogo Meta e backup**, a gestora vê a lista, baixa qualquer um deles ou faz um backup na hora (**Baixar backup agora**).
- Os automáticos ficam no mesmo disco do app. Se o computador quebrar, eles se perdem junto. Por isso, informe uma **pasta fora do computador** na mesma aba (pen drive, ou uma pasta sincronizada com o Google Drive/OneDrive fora da pasta do usuário, como `C:\FioDeAmor-Backup`) e clique em **Testar pasta**: o app copia para lá cada backup diário e guarda as 14 cópias mais recentes. O Painel fica vermelho quando a última cópia de fora tem mais de 7 dias. Detalhes em [backup.md](backup.md).

**Como restaurar um backup local:**

1. Feche o app (a janela do servidor, ou **Ctrl+C** no terminal onde ele roda).
2. Na pasta do app, abra a pasta `dados` e renomeie `fiodeamor.db` para `fiodeamor-antigo.db`. Se houver arquivos `fiodeamor.db-wal` e `fiodeamor.db-shm`, renomeie-os também (por exemplo, `fiodeamor-antigo.db-wal`).
3. Copie o backup escolhido (da pasta `dados/backups` ou o arquivo baixado) para a pasta `dados` e renomeie para `fiodeamor.db`.
4. Abra o app de novo (`npm start`). Tudo volta a ficar como estava no dia e na hora do backup.
5. Quando tiver certeza de que está tudo certo, apague o `fiodeamor-antigo.db`.

### Na nuvem (Turso)

O Turso guarda o histórico do banco e permite **criar uma cópia do banco como ele estava em uma data e hora** (*point-in-time restore*). Quantos dias ficam guardados depende do plano. Para restaurar:

1. Crie o banco restaurado, informando a data e a hora para onde quer voltar:

   ```bash
   turso db create fiodeamor-restaurado --from-db fiodeamor --timestamp 2026-11-14T09:00:00-03:00
   ```

   Também dá para fazer pelo painel app.turso.tech, se a opção aparecer no seu plano.
2. Pegue a URL e crie um token do banco novo (`turso db show fiodeamor-restaurado --url` e `turso db tokens create fiodeamor-restaurado`).
3. Na Vercel, em Settings → Environment Variables, troque `DATABASE_URL` e `DATABASE_AUTH_TOKEN` pelos valores do banco restaurado.
4. Faça um novo deploy (Deployments → ⋯ → **Redeploy**).

**Levar um backup do computador para a nuvem:** crie um banco a partir do arquivo, com `turso db create fiodeamor-restaurado --from-file caminho/do/backup.db`, e siga os passos 2 a 4. Confirme o comando na documentação do Turso.

**Ter uma cópia em arquivo do banco da nuvem:** o Turso tem um comando de exportação (`turso db export fiodeamor`; veja as opções com `turso db export --help`). Guarde o arquivo gerado fora do computador, como os backups locais.

## Alternativa: deixar o app no computador da loja e acessar no Wi-Fi

Assim, não há mensalidade de hospedagem. Em troca, o app só abre dentro da loja.

1. Instale e rode o app como no `README.md`:

   ```bash
   npm install
   ```

   ```bash
   npm run build
   ```

   ```bash
   npm start
   ```

   O `npm start` já aceita conexões de outros aparelhos da rede, na porta 3000.
2. Descubra o endereço do computador na rede:
   - no **Windows**: abra o Prompt de Comando, digite `ipconfig` e anote o **Endereço IPv4** (ex.: `192.168.0.15`);
   - no **Mac**: Ajustes do Sistema → Wi-Fi → **Detalhes** da rede → Endereço IP.
3. No celular, **conectado ao mesmo Wi-Fi**, abra `http://192.168.0.15:3000` (com o número que você anotou) e use **Adicionar à tela inicial**.
4. Se o Windows perguntar se o Node.js pode usar a rede, clique em **Permitir** (redes privadas).
5. Para o endereço não mudar, peça a quem cuida da internet para **reservar o IP** do computador no roteador.
6. **Segurança:** qualquer pessoa no Wi-Fi da loja consegue abrir o app. Crie os usuários (Configurações → Usuários) e deixe as clientes numa rede de **visitantes** separada.
7. O computador precisa ficar ligado, com o app aberto, para o celular funcionar.

Limitações deste caminho:

- O **feed agendado** do catálogo da Meta não funciona sem um endereço na internet, porque a Meta precisa abrir o link pela internet. Com o **Cloudflare Tunnel** ([acesso-de-fora.md](acesso-de-fora.md)), o computador da loja ganha esse endereço e o feed funciona. Use **Baixar CSV agora** (Configurações → aba **WhatsApp, catálogo Meta e backup**) e envie o arquivo à mão no Commerce Manager. Mesmo assim, as fotos do arquivo apontam para o computador da loja e a Meta não consegue baixá-las. Para o catálogo ficar completo, publique o app na nuvem.
- Fora da loja, o app não abre. Uma saída é uma VPN simples, como o **Tailscale** (gratuito para uso pessoal; confirme), instalada no computador e no celular. Ela não resolve o catálogo da Meta.
- Os backups automáticos continuam sendo feitos todo dia em `dados/backups` e copiados para a pasta de fora, se você indicou uma.
