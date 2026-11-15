# Backup do banco

Todo o app (produtos, pedidos, fotos, vendas, usuários e configurações) fica num arquivo só:
`dados/fiodeamor.db` (no computador da loja, `C:\FioDeAmor\dados\fiodeamor.db`). Os backups ficam em
`dados/backups`. Com o banco na nuvem (Turso), quem guarda o histórico é o próprio Turso: veja [nuvem.md](nuvem.md).

## Os três tipos de backup

| Tipo | Quando é feito | Nome do arquivo | Quantos ficam |
| --- | --- | --- | --- |
| Automático | 1 por dia, alguns segundos depois do primeiro uso do dia | `fiodeamor-2026-11-15-0930.db` | 14 |
| Manual | botão **Baixar backup agora** (Configurações → WhatsApp, catálogo Meta e backup) | `fiodeamor-manual-2026-11-15-0930.db` | 20 |
| Antes da atualização | quando um app novo muda a estrutura do banco, antes de mudar | `antes-da-migracao-0007-2026-11-15-0930.db` | 3 |

Cada tipo tem a sua rotação: apagar os automáticos antigos nunca apaga um manual, e vice-versa.

- A cópia é feita com `VACUUM INTO` numa thread separada: sai consistente mesmo com o app em uso e inclui o que
  ainda está no arquivo `fiodeamor.db-wal` (o banco roda em modo WAL). **Não** copie o `fiodeamor.db` sozinho
  com o app aberto: sem o `-wal`, a cópia pode ficar sem as últimas alterações.
- Antes de cada backup o app confere o espaço livre: precisa de **2 vezes o tamanho do banco + 50 MB**. Se não
  tiver, o backup não é feito e o aviso aparece na tela de backup (e no registro do servidor). O automático tenta
  de novo a cada hora.
- Se a cópia antes da atualização não puder ser feita (por exemplo, disco cheio), o banco **não** é atualizado e
  o app mostra o motivo. Libere espaço e abra o app de novo.

## Cópia fora do computador (pen drive ou nuvem)

Os backups em `dados/backups` estão no mesmo disco do app: se o computador estragar ou for roubado, vão junto.
Por isso, em **Configurações → WhatsApp, catálogo Meta e backup → Cópia fora deste computador**, informe uma pasta:

- um **pen drive** que fique sempre conectado (ex.: `E:\Backup Fio de Amor`); ou
- a pasta **`C:\FioDeAmor-Backup`** (o instalador já criou), sincronizada pelo **Google Drive para computador**:
  Preferências → Meu computador → Adicionar pasta → escolha `C:\FioDeAmor-Backup`.

Clique em **Testar pasta** (o app grava e apaga um arquivo de teste e mostra o espaço livre) e depois em **Salvar**.
Depois do backup automático, o app copia o arquivo para a pasta (o app confere a cada 10 minutos de uso) e
guarda lá as **14 cópias mais recentes** (apaga só os arquivos de backup dele, nunca outros arquivos da pasta).
A tela mostra a data da última cópia ou o erro da última tentativa; com pen drive desconectado, tenta de novo a
cada hora. O registro fica em `dados/backups/.copia-externa.json`.

### Por que não a pasta do Google Drive ou do OneDrive do usuário

No computador da loja, o servidor roda como a conta de serviço do Windows **LocalService** (sem poderes de
administrador, por segurança). Essa conta:

- **não grava** nas pastas dos usuários, como `C:\Users\Maria\Google Drive` ou `C:\Users\Maria\OneDrive`;
- **não enxerga** a unidade `G:` do Google Drive nem unidades de rede (`Z:`), que só existem na sessão do usuário.

O **Testar pasta** explica isso quando a pasta escolhida está no perfil do usuário. O OneDrive só sincroniza a pasta
dele (dentro do perfil); quem tem senha de administrador pode liberar uma subpasta para o servidor:

```powershell
# PowerShell como administrador (troque o caminho)
New-Item -ItemType Directory -Force "C:\Users\Maria\OneDrive\Backup Fio de Amor"
icacls "C:\Users\Maria\OneDrive\Backup Fio de Amor" /grant "*S-1-5-19:(OI)(CI)M"
```

## Restaurar um backup

1. **Pare o servidor.**
   - Computador da loja: abra o **PowerShell como administrador** e rode
     ```powershell
     schtasks /End /TN "Fio de Amor - Servidor"
     Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\FioDeAmor\*' } | Stop-Process -Force
     ```
   - Desenvolvimento: Ctrl+C no terminal do `npm run dev`/`npm start`.
2. Na pasta `dados` (`C:\FioDeAmor\dados`; o Windows pede a confirmação de administrador para abrir), renomeie
   `fiodeamor.db` para `fiodeamor-antigo.db`. **Renomeie também** `fiodeamor.db-wal` e `fiodeamor.db-shm`, se
   existirem: se ficarem, o banco antigo se mistura com o backup.
3. Copie o backup escolhido (de `dados\backups`, do pen drive ou da pasta sincronizada) para `dados` e renomeie
   para `fiodeamor.db`.
4. Ligue o servidor de novo: atalho **Fio de Amor** (ou `schtasks /Run /TN "Fio de Amor - Servidor"`), ou reinicie
   o Windows. No desenvolvimento, `npm run dev`.

Tudo volta a ficar como estava no dia e na hora do backup. Um backup de uma versão mais antiga do app é atualizado
sozinho na primeira abertura (e ganha uma cópia "antes da atualização").
