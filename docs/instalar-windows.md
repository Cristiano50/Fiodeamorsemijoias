# Instalar no computador da loja (Windows) e usar no celular

O app fica instalado em **um computador Windows da loja**, que vira o **servidor**. Os outros computadores e os
celulares (Android e iPhone) do **mesmo Wi-Fi** abrem o app pelo navegador. Ninguém mais precisa instalar nada, e
todos veem os mesmos produtos e pedidos.

## 1. Instalar no computador-servidor

Requisitos: **Windows 10 ou 11 de 64 bits**. O computador deve ficar ligado no horário da loja.

1. Copie `FioDeAmor-Instalador-<versão>.exe` para o computador e abra.
2. O Windows pode mostrar **"O Windows protegeu o computador"**, porque o instalador não tem assinatura digital paga.
   Clique em **Mais informações → Executar assim mesmo**.
3. Aceite a pergunta de administrador. O instalador:
   - copia o programa para `C:\FioDeAmor`, com o Node.js já incluído, sem precisar instalar mais nada;
   - cria a tarefa **"Fio de Amor - Servidor"**, que inicia o app junto com o Windows (mesmo antes do login) e o
     reinicia se ele cair. O servidor roda como a conta de serviço **LocalService**, sem poderes de administrador;
   - libera a porta **3000** no firewall do Windows **só para os aparelhos da rede da loja** (rede privada);
   - cria a pasta **`C:\FioDeAmor-Backup`**, sugerida para a cópia do backup fora do app (veja a seção 3);
   - cria o atalho **Fio de Amor** na área de trabalho e no menu Iniciar.
4. Na última tela, deixe marcado **Abrir o Fio de Amor agora**.
5. No primeiro acesso, vá em **Configurações → Usuários** e crie a conta da gestora. A partir daí, o app pede login.
6. Em **Configurações → Integrações e IA**, cole a chave do Claude e clique em **Testar chave do Claude**.
7. Em **Configurações → WhatsApp, catálogo Meta e backup**, escolha a pasta da **cópia fora do computador** e clique
   em **Testar pasta** e **Salvar** (seção 3).

> A rede do Windows precisa estar como **Privada**: Configurações → Rede e Internet → Wi-Fi (ou Ethernet) →
> Tipo de perfil de rede → Privada. Em rede "Pública", os outros aparelhos não conseguem abrir o app.

**Se o servidor parar** (o app não abre em nenhum aparelho), abra o atalho **Fio de Amor** no computador-servidor:
ele pede ao Windows para ligar a tarefa de novo e espera até 1 minuto. Não precisa ser administrador.

## 2. Abrir nos outros computadores e nos celulares

No computador-servidor, abra o app e vá ao menu **Celular e outros PCs**. A tela mostra o endereço (por exemplo,
`http://192.168.0.10:3000`) e um **QR code**.

- **Android:** conecte ao Wi-Fi da loja, leia o QR code com a câmera ou abra o endereço no Chrome. Depois toque em
  **⋮ → Adicionar à tela inicial**.
- **iPhone:** conecte ao Wi-Fi da loja, leia o QR code ou abra no Safari. Depois toque em
  **Compartilhar → Adicionar à Tela de Início**. O app abre em tela cheia, com o ícone da Fio de Amor.
- **Outros computadores:** abra o endereço no Chrome ou no Edge e salve nos favoritos, ou instale como app pelo menu do Chrome.

Se o roteador trocar o endereço do servidor, a tela **Celular e outros PCs** mostra o novo. Para o endereço ficar fixo,
peça a quem cuida da internet para **reservar o IP** do computador-servidor no roteador.

**De fora da loja (outra internet):** em casa, em outra loja ou no 4G. Há dois jeitos, ambos sem abrir portas no
roteador: um **endereço próprio na internet** (Cloudflare Tunnel, instalado só no computador-servidor) ou uma **rede
particular** (Tailscale, instalado em cada aparelho). O passo a passo está em [acesso-de-fora.md](acesso-de-fora.md).
De fora da loja, o app só abre com usuário e senha.

## 3. Dados, backups e atualização

| Pasta | O que tem |
| --- | --- |
| `C:\FioDeAmor\dados\fiodeamor.db` | o banco: produtos, pedidos, fotos e vendas |
| `C:\FioDeAmor\dados\backups` | backups: 1 automático por dia (14), os manuais do botão (20) e uma cópia antes de cada atualização do banco (3) |
| `C:\FioDeAmor\dados\logs\servidor.log` | o registro do servidor, para quando algo não abrir |
| `C:\FioDeAmor-Backup` | sugestão de pasta para a cópia fora do app (sincronize com o Google Drive) |

- **Cópia fora do computador:** em Configurações → WhatsApp, catálogo Meta e backup, informe um **pen drive** (ex.:
  `E:\Backup Fio de Amor`) ou `C:\FioDeAmor-Backup` e clique em **Testar pasta**. Depois do backup automático, o app
  copia o arquivo para lá e guarda as 14 cópias mais recentes. Para a nuvem, no **Google Drive para computador**:
  Preferências → Meu computador → Adicionar pasta → `C:\FioDeAmor-Backup`.
- **Atenção:** o servidor roda como **LocalService** e **não grava na pasta do seu usuário** (ex.:
  `C:\Users\Maria\Google Drive` ou `...\OneDrive`) nem enxerga a unidade `G:` do Google Drive ou unidades de rede. O
  **Testar pasta** avisa quando é o caso. Detalhes (e como liberar uma pasta do OneDrive) em [backup.md](backup.md).
- O botão **Baixar backup agora** fica na mesma tela. Para **restaurar**, siga [backup.md](backup.md).
- **Para atualizar,** rode o instalador da versão nova por cima. O programa é trocado e os dados ficam. Se a versão
  nova mudar o banco, o app faz antes uma cópia `antes-da-migracao-…` em `dados\backups`.
- **Para desinstalar,** use Configurações do Windows → Aplicativos → **Fio de Amor**, ou o menu Iniciar → Fio de Amor →
  Desinstalar. As pastas `C:\FioDeAmor\dados` e `C:\FioDeAmor-Backup` **são mantidas**; apague-as só se quiser perder tudo.

## 4. Segurança

- Qualquer aparelho no Wi-Fi da loja consegue abrir a **tela de login**. Crie usuários com senha e deixe as clientes
  num **Wi-Fi de visitantes** separado. Aparelhos de fora da rede da loja são barrados pelo firewall do Windows.
- Fora da loja, ou com o celular nos dados móveis (4G/5G), o app não abre. Para isso, ele precisaria ser publicado
  na internet (veja [docs/nuvem.md](nuvem.md)).
- O servidor roda como **LocalService** (S-1-5-19), não como SYSTEM: se alguém explorar uma falha do app, não ganha
  o controle do computador.
- **Permissões das pastas** (definidas pelo instalador com os SIDs, então valem em qualquer idioma do Windows):

  | Pasta | Administradores e SYSTEM | Usuários do Windows | LocalService (o servidor) |
  | --- | --- | --- | --- |
  | `C:\FioDeAmor` (programa; sem herdar do `C:\`) | controle total | ler e executar | ler e executar |
  | `C:\FioDeAmor\dados` (banco, fotos, backups, segredo do login) | controle total | — | modificar |
  | `C:\FioDeAmor\dados\logs` | controle total | ler | modificar |
  | `C:\FioDeAmor\app\.next\cache` | controle total | ler e executar | modificar |
  | `C:\FioDeAmor-Backup` (herda do `C:\`) | controle total | o padrão do Windows | modificar |

  Os usuários comuns do Windows não abrem `C:\FioDeAmor\dados`: lá ficam as chaves das integrações (Claude, UP Vendas)
  e o segredo que assina o login. Um administrador abre normalmente (o Windows pede a confirmação).
- A tarefa **"Fio de Amor - Servidor"** pode ser vista e executada por qualquer usuário autenticado (é o que o atalho
  usa para religar o servidor); só administradores alteram ou apagam a tarefa.
- O servidor sobe pelo invólucro `app\servidor-seguro.cjs`: antes de o Next ver cada requisição, ele apaga os
  cabeçalhos `X-Forwarded-For`, `X-Real-IP`, `Forwarded` (e parecidos) que o aparelho mandou e grava o IP real da
  conexão. Por isso o app pode confiar no IP (`FDA_IP_CONFIAVEL=1`) para limitar tentativas de login e para liberar o
  acesso sem senha só no próprio computador-servidor.

## Para quem mantém o código

O instalador é gerado no Linux, com Node 22 e NSIS (`apt-get install nsis`):

```bash
node instalador/empacotar.mjs
```

- **Como funciona:**
  - compila o app em modo autônomo (`FDA_STANDALONE=1`);
  - copia só a lista fechada de arquivos necessários, **trocando os links simbólicos pelo conteúdo de verdade** (o
    Next cria links absolutos em `.next/standalone/.next/node_modules`, que não existiriam no computador da loja);
  - troca os módulos nativos (`libsql` e `sharp`) pelas versões `win32-x64` e apaga os de outros sistemas;
  - inclui o `node.exe` (pacote npm `node-win-x64`) e o invólucro `servidor-seguro.cjs` em `app\`;
  - confere o pacote e gera `dist/FioDeAmor-Instalador-<versão>.exe` com `instalador/fiodeamor.nsi`.
- **Conferências antes do `.exe`** (o script para com a explicação se algo falhar):
  - nada de `amostras/`, `dados/`, `.env` ou `.db` no pacote;
  - nenhum link simbólico em `dist/<windows|linux>/FioDeAmor`;
  - estrutura: `server.js`, `servidor-seguro.cjs`, `.next/static`, `public`, `node.exe`, módulos nativos win32 de
    `@libsql` e `sharp`, `tarefa.xml` em UTF-16 rodando como LocalService;
  - teste de fumaça: sobe o servidor (o `.next/standalone` do Linux, pelo mesmo invólucro) numa porta livre, com uma
    pasta de dados vazia e sem `DATABASE_URL`, e confere que `/entrar` e `/api/sessao?modo=1` respondem 200.
    `--sem-teste` pula só essa parte.
- As funções novas do empacotador ficam em `instalador/empacotar-funcoes.mjs` (testes em `tests/infra-empacotar.test.ts`);
  o invólucro tem teste em `tests/infra-servidor-seguro.test.ts`.
- **Pasta dos dados:** a variável `FDA_DADOS` (definida em `instalador/servidor.cmd`) aponta para `C:\FioDeAmor\dados`.
- **Teste no Linux:** `node instalador/empacotar.mjs --sem-build --linux` monta a mesma estrutura. Depois rode
  `FDA_DADOS=/tmp/dados PORT=3100 node dist/linux/FioDeAmor/app/servidor-seguro.cjs`.
- **Conferir no Windows depois de instalar** (PowerShell como administrador):
  - `schtasks /Query /TN "Fio de Amor - Servidor" /V /FO LIST` → "Executar como usuário: LOCAL SERVICE";
  - `icacls C:\FioDeAmor` e `icacls C:\FioDeAmor\dados` → as permissões da tabela acima;
  - `netsh advfirewall firewall show rule name="Fio de Amor"` → perfil Privado, IP remoto "LocalSubnet";
  - com um usuário comum do Windows: o atalho **Fio de Amor** liga o servidor parado (`schtasks /End` antes, como
    administrador) e o app abre.
