# Atalho "Fio de Amor": garante que o servidor esteja rodando e abre o app no navegador.
# O servidor roda como a conta de serviço LocalService pela tarefa "Fio de Amor - Servidor". Qualquer usuário
# pode pedir que a tarefa rode (o instalador dá essa permissão): o atalho NUNCA inicia o servidor como o
# usuário logado, senão o banco e os backups ficariam com o dono errado.
$ErrorActionPreference = "SilentlyContinue"
$url = "http://localhost:3000"
$tarefa = "Fio de Amor - Servidor"
$registro = Join-Path $PSScriptRoot "dados\logs\servidor.log"

function Ativo {
  try { (Invoke-WebRequest "$url/api/sessao?modo=1" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

function Mensagem([string]$texto) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($texto, "Fio de Amor") | Out-Null
}

if (-not (Ativo)) {
  # Aviso discreto perto do relógio enquanto o servidor sobe (pode levar até 1 minuto).
  $aviso = $null
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $aviso = New-Object System.Windows.Forms.NotifyIcon
    $aviso.Icon = New-Object System.Drawing.Icon (Join-Path $PSScriptRoot "fiodeamor.ico")
    $aviso.Visible = $true
    $aviso.ShowBalloonTip(8000, "Fio de Amor", "Iniciando o servidor... aguarde, pode levar até 1 minuto.", [System.Windows.Forms.ToolTipIcon]::Info)
  } catch { $aviso = $null }

  try {
    $saida = & schtasks.exe /Run /TN "$tarefa" 2>&1
    $codigo = $LASTEXITCODE
    if ($codigo -ne 0) {
      Mensagem ("Não consegui iniciar o servidor do Fio de Amor (tarefa `"$tarefa`").`r`n`r`n$saida`r`n`r`n" +
        "Reinicie o computador. Se continuar, rode o instalador do Fio de Amor de novo (ele recria a tarefa e as permissões).")
      exit 1
    }
    # Espera até ~60 s o servidor responder (se a tarefa já estava subindo, por exemplo logo depois de ligar o computador, só espera).
    $limite = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $limite -and -not (Ativo)) { Start-Sleep -Seconds 1 }
  } finally {
    if ($aviso) { $aviso.Dispose() }
  }
}

if (Ativo) {
  Start-Process $url
} else {
  Mensagem ("O servidor do Fio de Amor não respondeu depois de 1 minuto.`r`n`r`n" +
    "Reinicie o computador. Se continuar, veja o registro em $registro (ou peça ajuda a quem instalou o app).")
}
