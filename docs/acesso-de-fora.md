# Usar o app de fora da loja (com outra internet)

O app roda no **computador-servidor da loja**. Na loja, os celulares e os outros computadores do mesmo Wi-Fi abrem o endereço que aparece em **Celular e outros PCs**. Este guia é para quem precisa usar o app **em outro lugar**: em casa, em outra loja ou no 4G do celular.

Os dados continuam **só no computador da loja**. O que muda é o caminho até ele.

> **Antes de tudo:** de fora da loja, o app só abre com **usuário e senha**. Se ainda estiver sem senha, crie a conta da gestora e as das funcionárias em **Configurações → Usuários**. Sem senha, o app só abre no próprio computador-servidor, de propósito, para ninguém da internet entrar.

## Qual jeito escolher

| | **1. Endereço próprio na internet** (Cloudflare) | **2. Rede particular** (Tailscale) |
| --- | --- | --- |
| Nos outros computadores e celulares | **Nada para instalar**: abre no navegador | Instalar o aplicativo Tailscale e entrar na conta da loja |
| Endereço | `https://app.sualoja.com.br` | `http://nome-do-servidor:3000` |
| Precisa de | Um **domínio** (ex.: `sualoja.com.br`) e uma conta grátis no Cloudflare | Uma conta no Tailscale |
| Custo | O túnel do Cloudflare é grátis; o domínio custa por ano, cerca de R$ 40 no registro.br para `.com.br` (confira o preço atual) | Tem plano gratuito para poucas pessoas; confira em [tailscale.com/pricing](https://tailscale.com/pricing) se o uso da loja cabe nele |
| Quem consegue abrir a tela de login | Qualquer pessoa na internet que souber o endereço (o login protege o app) | Só os aparelhos ligados à conta da loja no Tailscale |
| Catálogo da Meta e skill do Claude conectada | **Passam a funcionar**, porque precisam de um endereço na internet | Não mudam: continuam precisando do envio manual |

**Recomendação:** o **jeito 1** se mais de uma ou duas pessoas vão usar de fora, se vão usar pelo celular ou se você quer o catálogo da Meta automático. O **jeito 2** se são poucos computadores e você prefere não ter o app na internet aberta. Os dois podem ser usados juntos.

### Servidor na sede e equipe do estoque em outro endereço

Para esse caso, use o **jeito 1** e, se puder, o **login do Cloudflare** só com os e-mails da equipe (veja "Mais segurança"). No dia a dia:

- **No estoque**, cada pessoa abre `https://app.sualoja.com.br` no celular ou no computador e entra com o **próprio usuário** (papel **funcionário**). Crie um usuário por pessoa em Configurações → Usuários; não compartilhe logins.
- A **conferência pelo celular** (Pedido → Chegada e conferência), com foto dos defeitos, funciona igual à da loja. O leitor de código de barras (USB ou Bluetooth) do estoque funciona como na loja, porque ele "digita" o código.
- As **etiquetas** saem na impressora ligada ao computador do estoque: o navegador imprime ali mesmo.
- O **computador-servidor da sede** precisa ficar **ligado e com internet**. Se a internet da sede cair, o estoque espera ela voltar. Vale ligar o servidor e o roteador num **nobreak** e, de preferência, deixar o servidor no **cabo de rede**.
- A velocidade de **envio (upload)** da internet da sede é a que conta para as fotos abrirem rápido no estoque. As fotos carregam aos poucos, conforme a tela rola.

---

## Jeito 1: endereço próprio na internet (Cloudflare Tunnel)

O Cloudflare Tunnel é um programa grátis do Cloudflare que fica no computador-servidor e liga o app a um endereço seu na internet. Ele **não abre nenhuma porta** no roteador da loja: a conexão sai do computador para o Cloudflare. O Cloudflare cuida do cadeado (https).

> Os nomes dos menus do Cloudflare mudam de vez em quando. Se não achar um item, procure pelas palavras em destaque.

### Passo 1: o domínio

1. Se a loja ainda não tem um domínio, registre um: `.com.br` no [registro.br](https://registro.br), ou `.com` direto no Cloudflare (**Domain Registration**).
2. Crie uma conta grátis em [dash.cloudflare.com](https://dash.cloudflare.com) com o e-mail da loja.
3. Clique em **Add a domain** (Adicionar domínio), digite o domínio e escolha o plano **Free**.
4. O Cloudflare mostra **dois servidores DNS** (nameservers). No registro.br, abra o domínio → **DNS** → **Alterar servidores DNS** e troque pelos dois do Cloudflare.
5. Espere o Cloudflare mostrar o domínio como **Active** (Ativo). Pode levar de minutos a algumas horas.

### Passo 2: o túnel, no computador-servidor da loja

Faça estes passos **no computador-servidor**, com um usuário administrador do Windows.

1. No painel do Cloudflare, abra **Zero Trust** → **Networks** → **Tunnels**. Em contas novas, o caminho pode ser direto **Networks → Tunnels**. Se pedir, escolha o plano **Free** do Zero Trust.
2. Clique em **Create a tunnel** → **Cloudflared** → dê o nome `fiodeamor-loja` → **Save tunnel**.
3. Em **Choose your environment**, escolha **Windows** (64-bit). O Cloudflare mostra:
   - o link para **baixar o cloudflared**: baixe e instale;
   - um **comando** que começa com `cloudflared.exe service install` seguido de um código longo.
4. Abra o **PowerShell como administrador** (menu Iniciar → digite PowerShell → botão direito → Executar como administrador), cole o comando e tecle Enter. O túnel passa a iniciar sozinho com o Windows.
5. De volta ao Cloudflare, espere o túnel aparecer como **Healthy** (ou Connected) e clique em **Next**.
6. Em **Public hostname** (ou Published application routes):
   - **Subdomain**: `app`;
   - **Domain**: o domínio da loja;
   - **Service**: Type **HTTP**, URL `localhost:3000`.
7. Clique em **Save**.
8. Em **SSL/TLS → Edge Certificates**, ligue **Always Use HTTPS**, para o endereço nunca abrir sem o cadeado.

### Passo 3: avisar o app

1. No computador-servidor, abra o app e vá em **Celular e outros PCs**.
2. Em **Fora da loja**, escreva `https://app.sualoja.com.br`, clique em **Testar** e depois em **Salvar**.
3. Pronto. Em qualquer computador ou celular com internet, abra `https://app.sualoja.com.br` e entre com o seu usuário. No celular, dá para **adicionar à tela inicial**, igual na loja.

Com o endereço salvo, os links das fotos do **catálogo da Meta**, a **skill do Claude conectada** e as **planilhas com foto** (recompra, UP Vendas) passam a usar o endereço da internet. Para o catálogo, copie de novo a URL do feed em Configurações → **WhatsApp, catálogo Meta e backup** e cadastre no Commerce Manager.

### Mais segurança (opcional): login do Cloudflare antes do app

Dá para exigir, antes da tela do app, um código enviado ao e-mail de cada pessoa (Cloudflare Access, grátis para poucos usuários):

1. Em **Zero Trust → Access → Applications**, crie uma aplicação **Self-hosted** para `app.sualoja.com.br` com uma política que **permite** os e-mails da equipe.
2. Crie uma segunda aplicação, com política **Bypass** para todos, só para os caminhos que precisam abrir sem esse código:
   - `/api/feed/` (catálogo da Meta);
   - `/api/imagens/` (fotos do catálogo e do UP);
   - `/api/skill/contexto` e `/api/skill/cadastro` (skill do Claude);
   - `/api/sessao` (botão **Testar** do app).

O app continua pedindo o seu usuário e senha depois disso.

### Se não funcionar

- **Testar diz que "o túnel não está ligado":** no computador-servidor, abra **Serviços** (tecla Windows → `services.msc`) e confira se **Cloudflared** está **Em execução**. Se não estiver, clique com o botão direito → **Iniciar**.
- **"Este aparelho ainda não pode abrir o app":** o app está sem senha. Crie os usuários em Configurações → Usuários.
- **Erro 524 numa operação demorada:** o Cloudflare espera até cerca de 100 segundos por resposta. O app já faz as tarefas longas (análise por IA, fotos) em partes; tente de novo.
- **Muitas tentativas de login:** depois de várias senhas erradas, aquele login e aquele aparelho ficam bloqueados por alguns minutos.

---

## Jeito 2: rede particular (Tailscale)

O Tailscale liga os aparelhos da loja numa rede particular pela internet, como se estivessem no mesmo Wi-Fi. O app **não fica na internet aberta**: só os aparelhos conectados à conta da loja enxergam o servidor.

### No computador-servidor da loja

1. Crie uma conta em [tailscale.com](https://tailscale.com) entrando com o e-mail da loja (Google ou Microsoft).
2. Baixe e instale o **Tailscale para Windows** e entre com essa conta.
3. No ícone do Tailscale (perto do relógio) → **Settings** (Configurações), ligue **Run unattended**. Assim ele fica conectado mesmo sem ninguém logado no Windows.
4. No painel do Tailscale ([login.tailscale.com/admin](https://login.tailscale.com/admin)) → **Machines** → no computador-servidor → **⋯** → **Disable key expiry**. Assim ele não pede para entrar de novo a cada alguns meses.
5. Abra o app em **Celular e outros PCs**. Em **Fora da loja**, aparece o endereço pela Tailscale, por exemplo `http://desktop-loja:3000`.

### Em cada computador ou celular de fora

1. Instale o **Tailscale**: Windows, Mac, Android ou iPhone (App Store / Google Play).
2. Entre com a **mesma conta da loja**, ou com a conta da pessoa convidada no painel (**Users → Invite**).
3. Com o Tailscale ligado, abra o endereço que aparece em **Fora da loja** no navegador e entre com o seu usuário do app.

O Tailscale já libera o próprio tráfego no firewall do Windows; não precisa mexer em mais nada. Se o Tailscale estiver desligado no aparelho, o app não abre de fora.

---

## Jeito 3: tudo na nuvem

Se preferir não depender do computador da loja ligado, o app também roda na nuvem (Vercel + Turso), com os dados lá. Fica mais caro e muda a rotina de backup. O passo a passo está em [nuvem.md](nuvem.md).

## Como o app se protege quando está acessível de fora

- **Sem senha, só no próprio computador-servidor.** Quem vem pela internet ou pela Tailscale nunca é tratado como "este computador".
- **Login com limite de tentativas** por aparelho e por usuário. As tentativas erradas ficam no Histórico.
- **Sessão com validade** (14 dias, ajustável em Configurações → Usuários). **Sair** desconecta aquele login em todos os aparelhos. Desativar um usuário derruba o login dele na hora.
- **Cadeado (https)** no endereço do Cloudflare. O cookie do login só viaja com o cadeado.
- **Pedidos de outros sites são recusados.** Uma página maliciosa aberta no mesmo navegador não consegue mexer no app.
- **Fotos privadas** (páginas do pedido, peças com defeito, referências) só abrem com login.
