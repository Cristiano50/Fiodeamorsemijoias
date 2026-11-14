@echo off
rem Servidor do app Fio de Amor. Iniciado pelo Agendador de Tarefas junto com o Windows
rem (tarefa "Fio de Amor - Servidor") ou pelo atalho, se ainda nao estiver rodando.
setlocal
set "BASE=%~dp0"
set "NODE_ENV=production"
set "NEXT_TELEMETRY_DISABLED=1"
set "PORT=3000"
set "HOSTNAME=0.0.0.0"
set "FDA_DADOS=%BASE%dados"
set "LOG=%FDA_DADOS%\logs\servidor.log"
if not exist "%FDA_DADOS%\logs" mkdir "%FDA_DADOS%\logs"
rem Guarda so os ultimos ~5 MB de registro.
if exist "%LOG%" for %%A in ("%LOG%") do if %%~zA GTR 5000000 move /y "%LOG%" "%LOG%.anterior" >nul
echo [%date% %time%] Iniciando o Fio de Amor na porta %PORT% >> "%LOG%"
cd /d "%BASE%app"
"%BASE%node\node.exe" server.js >> "%LOG%" 2>&1
echo [%date% %time%] Servidor parou (codigo %errorlevel%) >> "%LOG%"
exit /b %errorlevel%
