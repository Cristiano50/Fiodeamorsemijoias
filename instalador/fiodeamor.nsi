; Instalador do app Fio de Amor para o computador-servidor da loja (Windows 10/11, 64 bits).
; Gerado por instalador/empacotar.mjs:  makensis -DVERSAO=… -DORIGEM=… -DSAIDA=… -DICONE=… fiodeamor.nsi
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define NOME "Fio de Amor"
!define TAREFA "Fio de Amor - Servidor"
!define PORTA "3000"
!define CHAVE_DESINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\FioDeAmor"
!define POWERSHELL "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
; Pasta sugerida para a cópia externa do backup (fora do perfil do usuário: o servidor, LocalService, grava nela
; e o Google Drive do usuário pode sincronizá-la).
!define PASTA_BACKUP "C:\FioDeAmor-Backup"
; Contas pelo SID (funciona em qualquer idioma do Windows):
;   S-1-5-32-544 Administradores · S-1-5-18 SYSTEM · S-1-5-32-545 Usuários · S-1-5-19 LocalService (o servidor)
!define ADMINS "*S-1-5-32-544"
!define SISTEMA "*S-1-5-18"
!define USUARIOS "*S-1-5-32-545"
!define SERVICO "*S-1-5-19"

Name "${NOME}"
OutFile "${SAIDA}"
InstallDir "C:\FioDeAmor"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "Fio de Amor Semijoias"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ICON "${ICONE}"
!define MUI_UNICON "${ICONE}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o Fio de Amor"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o app de cadastro da Fio de Amor Semijoias (versão ${VERSAO}) neste computador, que passa a ser o SERVIDOR da loja.$\r$\n$\r$\n• O app inicia sozinho junto com o Windows.$\r$\n• Os outros computadores e os celulares do mesmo Wi-Fi abrem o endereço que aparece no app, no menu $\"Celular e outros PCs$\".$\r$\n• Os dados ficam em C:\FioDeAmor\dados e são mantidos nas atualizações.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_TITLE "Fio de Amor instalado"
!define MUI_FINISHPAGE_TEXT "O servidor já está rodando e vai iniciar sozinho com o Windows.$\r$\n$\r$\nNo primeiro acesso, crie a conta da gestora em Configurações → Usuários.$\r$\nPara usar no celular, abra o menu $\"Celular e outros PCs$\" no app.$\r$\nPara guardar o backup fora deste disco, escolha um pen drive ou a pasta ${PASTA_BACKUP} em Configurações → WhatsApp, catálogo Meta e backup."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Fio de Amor agora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirApp
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LEIA-ME.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Mostrar o LEIA-ME"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

VIProductVersion "${VERSAO}.0"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductName" "Fio de Amor"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileDescription" "Instalador do app Fio de Amor (cadastro de semijoias)"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "CompanyName" "Fio de Amor Semijoias"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "LegalCopyright" "Fio de Amor Semijoias"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "FileVersion" "${VERSAO}"
VIAddVersionKey /LANG=${LANG_PORTUGUESEBR} "ProductVersion" "${VERSAO}"

; Para o servidor (tarefa do Windows e qualquer node.exe desta pasta) antes de trocar ou remover arquivos.
!macro PararServidor
  DetailPrint "Parando o servidor do Fio de Amor (se estiver rodando)…"
  nsExec::Exec 'schtasks /End /TN "${TAREFA}"'
  Pop $0
  nsExec::Exec `"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
  Sleep 1500
!macroend

; icacls com aviso no registro da instalação se falhar.
!macro Permissao CAMINHO ARGUMENTOS
  nsExec::ExecToLog 'icacls "${CAMINHO}" ${ARGUMENTOS} /C /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Aviso: não foi possível ajustar as permissões de ${CAMINHO} (código $0)."
  ${EndIf}
!macroend

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O Fio de Amor precisa do Windows 10 ou 11 de 64 bits."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Fio de Amor" SecPrincipal
  SectionIn RO
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  !insertmacro PararServidor

  ; Troca o programa (nunca a pasta dados).
  DetailPrint "Copiando o programa…"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  File /r "${ORIGEM}\*.*"

  CreateDirectory "$INSTDIR\dados"
  CreateDirectory "$INSTDIR\dados\logs"
  CreateDirectory "$INSTDIR\dados\backups"
  CreateDirectory "$INSTDIR\app\.next\cache"
  CreateDirectory "${PASTA_BACKUP}"

  ; Permissões. O servidor roda como LocalService (sem poderes de administrador) e só grava onde precisa.
  DetailPrint "Ajustando as permissões das pastas…"
  ; C:\FioDeAmor: sem herdar do C:\ (lá "Usuários autenticados" podem modificar, e trocariam o programa que o servidor roda).
  ; Administradores e SYSTEM: controle total; Usuários e LocalService: só ler e executar.
  !insertmacro Permissao "$INSTDIR" "/inheritance:r /grant:r ${ADMINS}:(OI)(CI)F ${SISTEMA}:(OI)(CI)F ${USUARIOS}:(OI)(CI)RX ${SERVICO}:(OI)(CI)RX"
  ; dados (banco, fotos, backups, segredo da sessão, registro): só o servidor modifica; os usuários do Windows não leem
  ; o banco (lá ficam as chaves das integrações e o segredo do login). Zera antes as permissões antigas: a versão anterior
  ; dava "Modificar" para todos os usuários em cada arquivo.
  !insertmacro Permissao "$INSTDIR\dados" "/reset /T"
  !insertmacro Permissao "$INSTDIR\dados" "/inheritance:r /grant:r ${ADMINS}:(OI)(CI)F ${SISTEMA}:(OI)(CI)F ${SERVICO}:(OI)(CI)M"
  ; O registro do servidor pode ser lido por quem usa o computador (o atalho indica este arquivo quando o app não abre).
  !insertmacro Permissao "$INSTDIR\dados\logs" "/grant:r ${USUARIOS}:(OI)(CI)RX"
  ; Cache do Next (o servidor pode gravar em app\.next\cache).
  !insertmacro Permissao "$INSTDIR\app\.next\cache" "/grant:r ${SERVICO}:(OI)(CI)M"
  ; Pasta sugerida para o backup fora do app: herda do C:\ (o Google Drive do usuário lê) e o servidor grava.
  !insertmacro Permissao "${PASTA_BACKUP}" "/grant:r ${SERVICO}:(OI)(CI)M"

  ; Inicia com o Windows (mesmo antes do login), sem limite de tempo, também na bateria; reinicia se cair.
  DetailPrint "Configurando o início automático (conta de serviço LocalService)…"
  nsExec::ExecToLog 'schtasks /Create /TN "${TAREFA}" /XML "$INSTDIR\tarefa.xml" /F'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Aviso: não foi possível criar a tarefa de início automático (código $0)."
    MessageBox MB_ICONEXCLAMATION "Não foi possível criar a tarefa que inicia o servidor junto com o Windows (código $0).$\r$\nRode o instalador de novo. Se continuar, veja o passo a passo em docs/instalar-windows.md."
  ${Else}
    ; Qualquer usuário autenticado pode ver e executar a tarefa (o atalho religa o servidor sem pedir administrador).
    ; O tarefa.xml já traz essa permissão; aqui ela é conferida e acrescentada se o Windows não tiver aplicado.
    nsExec::ExecToLog `"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -Command "try { $$s = New-Object -ComObject Schedule.Service; $$s.Connect(); $$t = $$s.GetFolder('\').GetTask('${TAREFA}'); $$sd = $$t.GetSecurityDescriptor(7); if ($$sd -notmatch '\(A;;GRGX;;;AU\)') { $$t.SetSecurityDescriptor($$sd + '(A;;GRGX;;;AU)', 0) }; 'Permissao da tarefa: ' + $$t.GetSecurityDescriptor(7) } catch { 'Aviso: permissao da tarefa nao conferida: ' + $$_.Exception.Message; exit 1 }"`
    Pop $0
  ${EndIf}

  ; Libera o acesso dos outros aparelhos SÓ da rede da loja (sub-rede local), em rede privada.
  DetailPrint "Liberando o app no firewall (rede privada da loja)…"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${NOME}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${NOME}" dir=in action=allow protocol=TCP localport=${PORTA} profile=private remoteip=localsubnet'
  Pop $0

  ; Atalhos (área de trabalho e menu Iniciar de todos os usuários)
  CreateShortcut "$DESKTOP\Fio de Amor.lnk" "${POWERSHELL}" '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\abrir.ps1"' "$INSTDIR\fiodeamor.ico" 0 SW_SHOWMINIMIZED "" "Abrir o app Fio de Amor"
  CreateDirectory "$SMPROGRAMS\Fio de Amor"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Fio de Amor.lnk" "${POWERSHELL}" '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\abrir.ps1"' "$INSTDIR\fiodeamor.ico" 0 SW_SHOWMINIMIZED "" "Abrir o app Fio de Amor"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Dados e backups.lnk" "$INSTDIR\dados"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Cópias do backup.lnk" "${PASTA_BACKUP}"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\LEIA-ME.lnk" "$INSTDIR\LEIA-ME.txt"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Desinstalar.lnk" "$INSTDIR\desinstalar.exe"

  ; Programas e Recursos do Windows
  WriteUninstaller "$INSTDIR\desinstalar.exe"
  WriteRegStr HKLM "${CHAVE_DESINST}" "DisplayName" "Fio de Amor (cadastro de semijoias)"
  WriteRegStr HKLM "${CHAVE_DESINST}" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKLM "${CHAVE_DESINST}" "Publisher" "Fio de Amor Semijoias"
  WriteRegStr HKLM "${CHAVE_DESINST}" "DisplayIcon" "$INSTDIR\fiodeamor.ico"
  WriteRegStr HKLM "${CHAVE_DESINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${CHAVE_DESINST}" "UninstallString" '"$INSTDIR\desinstalar.exe"'
  WriteRegDWORD HKLM "${CHAVE_DESINST}" "NoModify" 1
  WriteRegDWORD HKLM "${CHAVE_DESINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKLM "${CHAVE_DESINST}" "EstimatedSize" "$0"

  ; Inicia o servidor agora.
  DetailPrint "Iniciando o servidor…"
  nsExec::ExecToLog 'schtasks /Run /TN "${TAREFA}"'
  Pop $0
SectionEnd

Function AbrirApp
  Exec '"${POWERSHELL}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\abrir.ps1"'
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  !insertmacro PararServidor
  nsExec::Exec 'schtasks /Delete /TN "${TAREFA}" /F'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${NOME}"'
  Pop $0
  Delete "$DESKTOP\Fio de Amor.lnk"
  RMDir /r "$SMPROGRAMS\Fio de Amor"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  Delete "$INSTDIR\servidor.cmd"
  Delete "$INSTDIR\abrir.ps1"
  Delete "$INSTDIR\tarefa.xml"
  Delete "$INSTDIR\fiodeamor.ico"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\desinstalar.exe"
  DeleteRegKey HKLM "${CHAVE_DESINST}"
  ; A pasta dados (produtos, pedidos, fotos, backups) e as cópias em ${PASTA_BACKUP} ficam.
  MessageBox MB_ICONINFORMATION "O Fio de Amor foi removido.$\r$\n$\r$\nOs dados (produtos, pedidos, fotos e backups) foram mantidos em $INSTDIR\dados, e as cópias do backup em ${PASTA_BACKUP}. Para apagar de vez, apague essas pastas."
SectionEnd
