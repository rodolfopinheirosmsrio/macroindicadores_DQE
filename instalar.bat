@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale o Node.js 20 ou superior e tente novamente.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto :erro
call npx playwright install chromium
if errorlevel 1 goto :erro
echo.
echo Instalacao concluida.
pause
exit /b 0
:erro
echo.
echo A instalacao falhou. Consulte a mensagem acima.
pause
exit /b 1
