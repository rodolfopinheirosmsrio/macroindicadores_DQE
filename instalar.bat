@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   Instalacao - Macroindicadores SUBHUE
echo ===============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  echo Instale o Node.js 20 ou superior e tente novamente.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Git nao foi encontrado.
  echo O robo podera executar, mas atualizar/publicar pelo GitHub nao funcionara.
  echo Instale o Git for Windows para uso completo pela equipe.
  echo.
)

call npm install
if errorlevel 1 goto :erro
call npx playwright install chromium
if errorlevel 1 goto :erro

if not exist "%~dp0segredos" mkdir "%~dp0segredos"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\criar-atalho.ps1"
if errorlevel 1 (
  echo [AVISO] Nao foi possivel criar o atalho automaticamente.
)

echo.
echo ===============================================
echo Instalacao tecnica concluida.
echo ===============================================
if not exist "%~dp0segredos\credentials.json" (
  echo [PENDENTE] Copiar segredos\credentials.json da equipe para este computador.
) else (
  echo [OK] Credencial OAuth Google encontrada.
)
if not exist "%~dp0segredos\smsrio-cpf.txt" (
  echo [PENDENTE] Execute configurar-login.bat para cadastrar o seu CPF e senha.
) else (
  echo [OK] Login SMS Rio configurado neste perfil.
)
if not exist "%~dp0segredos\token.json" (
  echo [PENDENTE] Execute autorizar-google.bat e escolha subhueindicadores@gmail.com.
) else (
  echo [OK] Google autorizado neste perfil.
)
echo.
echo Depois, use o atalho "Macroindicadores SUBHUE" na Area de Trabalho.
pause
exit /b 0

:erro
echo.
echo A instalacao falhou. Consulte a mensagem acima.
pause
exit /b 1
