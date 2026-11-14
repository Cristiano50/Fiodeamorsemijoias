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
!define MUI_FINISHPAGE_TEXT "O servidor já está rodando e vai iniciar sozinho com o Windows.$\r$\n$\r$\nNo primeiro acesso, crie a conta da gestora em Configurações → Usuários.$\r$\nPara usar no celular, abra o menu $\"Celular e outros PCs$\" no app."
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
  ; Os usuários do Windows podem gravar os dados (o atalho pode iniciar o servidor sem ser administrador).
  nsExec::ExecToLog 'icacls "$INSTDIR\dados" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  Pop $0

  ; Inicia com o Windows (mesmo antes do login), sem limite de tempo, também na bateria; reinicia se cair.
  DetailPrint "Configurando o início automático…"
  nsExec::ExecToLog 'schtasks /Create /TN "${TAREFA}" /XML "$INSTDIR\tarefa.xml" /F'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Aviso: não foi possível criar a tarefa de início automático (código $0). Use o atalho para iniciar."
  ${EndIf}

  ; Libera o acesso dos outros aparelhos na rede privada da loja.
  DetailPrint "Liberando o app no firewall (redes privadas)…"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${NOME}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${NOME}" dir=in action=allow protocol=TCP localport=${PORTA} profile=private,domain'
  Pop $0

  ; Atalhos (área de trabalho e menu Iniciar de todos os usuários)
  CreateShortcut "$DESKTOP\Fio de Amor.lnk" "${POWERSHELL}" '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\abrir.ps1"' "$INSTDIR\fiodeamor.ico" 0 SW_SHOWMINIMIZED "" "Abrir o app Fio de Amor"
  CreateDirectory "$SMPROGRAMS\Fio de Amor"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Fio de Amor.lnk" "${POWERSHELL}" '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\abrir.ps1"' "$INSTDIR\fiodeamor.ico" 0 SW_SHOWMINIMIZED "" "Abrir o app Fio de Amor"
  CreateShortcut "$SMPROGRAMS\Fio de Amor\Dados e backups.lnk" "$INSTDIR\dados"
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
  ; A pasta dados (produtos, pedidos, fotos, backups) fica.
  MessageBox MB_ICONINFORMATION "O Fio de Amor foi removido.$\r$\n$\r$\nOs dados (produtos, pedidos, fotos e backups) foram mantidos em $INSTDIR\dados. Para apagar de vez, apague essa pasta."
SectionEnd
