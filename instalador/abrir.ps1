# Atalho "Fio de Amor": garante que o servidor esteja rodando e abre o app no navegador.
$ErrorActionPreference = "SilentlyContinue"
$url = "http://localhost:3000"
$tarefa = "Fio de Amor - Servidor"

function Ativo {
  try { (Invoke-WebRequest "$url/api/sessao?modo=1" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

if (-not (Ativo)) {
  # 1) a tarefa do Windows (roda mesmo sem ninguém logado)
  Start-Process -FilePath "schtasks.exe" -ArgumentList "/Run", "/TN", "`"$tarefa`"" -WindowStyle Hidden -Wait
  for ($i = 0; $i -lt 10 -and -not (Ativo); $i++) { Start-Sleep -Milliseconds 500 }
  # 2) sem a tarefa (ex.: sem permissão), inicia direto, escondido
  if (-not (Ativo)) { Start-Process -FilePath "$PSScriptRoot\servidor.cmd" -WindowStyle Hidden }
  for ($i = 0; $i -lt 60 -and -not (Ativo); $i++) { Start-Sleep -Milliseconds 500 }
}

if (Ativo) {
  Start-Process $url
} else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("O Fio de Amor não iniciou. Veja o registro em $PSScriptRoot\dados\logs\servidor.log ou reinicie o computador.", "Fio de Amor") | Out-Null
}
