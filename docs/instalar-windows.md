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
   - cria a tarefa **"Fio de Amor - Servidor"**, que inicia o app junto com o Windows (mesmo antes do login) e o reinicia se ele cair;
   - libera a porta **3000** no firewall do Windows para **redes privadas**;
   - cria o atalho **Fio de Amor** na área de trabalho e no menu Iniciar.
4. Na última tela, deixe marcado **Abrir o Fio de Amor agora**.
5. No primeiro acesso, vá em **Configurações → Usuários** e crie a conta da gestora. A partir daí, o app pede login.
6. Em **Configurações → Integrações e IA**, cole a chave do Claude e clique em **Testar chave do Claude**.

> A rede do Windows precisa estar como **Privada**: Configurações → Rede e Internet → Wi-Fi (ou Ethernet) →
> Tipo de perfil de rede → Privada. Em rede "Pública", os outros aparelhos não conseguem abrir o app.

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

## 3. Dados, backups e atualização

| Pasta | O que tem |
| --- | --- |
| `C:\FioDeAmor\dados\fiodeamor.db` | o banco: produtos, pedidos, fotos e vendas |
| `C:\FioDeAmor\dados\backups` | um backup automático por dia (os 14 mais recentes) |
| `C:\FioDeAmor\dados\logs\servidor.log` | o registro do servidor, para quando algo não abrir |

- De vez em quando, copie um backup para **fora do computador** (pen drive ou nuvem). O botão **Baixar backup agora**
  fica em Configurações → WhatsApp, catálogo Meta e backup.
- **Para atualizar,** rode o instalador da versão nova por cima. O programa é trocado e os dados ficam.
- **Para desinstalar,** use Configurações do Windows → Aplicativos → **Fio de Amor**, ou o menu Iniciar → Fio de Amor →
  Desinstalar. A pasta `C:\FioDeAmor\dados` **é mantida**; apague-a só se quiser perder tudo.

## 4. Segurança

- Qualquer aparelho no Wi-Fi da loja consegue abrir a **tela de login**. Crie usuários com senha e deixe as clientes
  num **Wi-Fi de visitantes** separado.
- Fora da loja, ou com o celular nos dados móveis (4G/5G), o app não abre. Para isso, ele precisaria ser publicado
  na internet (veja [docs/nuvem.md](nuvem.md)).

## Para quem mantém o código

O instalador é gerado no Linux, com Node 22 e NSIS (`apt-get install nsis`):

```bash
node instalador/empacotar.mjs
```

- **Como funciona:**
  - compila o app em modo autônomo (`FDA_STANDALONE=1`);
  - copia só a lista fechada de arquivos necessários;
  - troca os módulos nativos (`libsql` e `sharp`) pelas versões `win32-x64`;
  - inclui o `node.exe` (pacote npm `node-win-x64`);
  - gera `dist/FioDeAmor-Instalador-<versão>.exe` com `instalador/fiodeamor.nsi`.
- **Conferência de segurança:** o script para se aparecer `amostras/`, `dados/`, `.env` ou `.db` no pacote.
- **Pasta dos dados:** a variável `FDA_DADOS` (definida em `instalador/servidor.cmd`) aponta para `C:\FioDeAmor\dados`.
- **Teste no Linux:** `node instalador/empacotar.mjs --sem-build --linux` monta a mesma estrutura. Depois rode
  `FDA_DADOS=/tmp/dados PORT=3100 node dist/linux/FioDeAmor/app/server.js`.
