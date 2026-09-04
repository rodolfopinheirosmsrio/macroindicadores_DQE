@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   Robo Macroindicadores SMS Rio
echo ===============================================
set "SMSRIO_CPF="
set "SMSRIO_SENHA="
if exist "%~dp0segredos\smsrio-cpf.txt" set /p SMSRIO_CPF=<"%~dp0segredos\smsrio-cpf.txt"
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0ler-senha.ps1"`) do set "SMSRIO_SENHA=%%P"
set /p COMPETENCIA=Competencia (AAAA-MM, exemplo 2026-07): 
echo.
echo Modo de execucao:
echo   1 - conferir          = compara sem alterar o Google Sheets
echo   2 - atualizar pendencias = preenche vazios e zeros suspeitos; preserva os demais valores
echo   3 - atualizar completo   = sincroniza tambem correcoes dos valores ja preenchidos
echo   Somente a competencia informada pode ser alterada. Formulas sao preservadas.
set /p MODO=Modo [1/2/3] (padrao 1): 
if "%MODO%"=="" set "MODO=1"
echo.
echo Execucao do navegador:
echo   1 - visivel        = recomendado; permite login e CAPTCHA
echo   2 - segundo-plano  = se pedir login, abre e depois fica minimizado
set /p NAVEGADOR=Navegador [1/2] (padrao 1): 
if "%NAVEGADOR%"=="" set "NAVEGADOR=visivel"
echo.
echo Janela de conferencia historica:
echo   1     = somente a competencia informada
echo   12    = competencia + 11 meses anteriores
echo   24    = competencia + 23 meses anteriores
echo   36    = competencia + 35 meses anteriores
echo   todos = todo o historico desde a data configurada
echo   Voce tambem pode digitar outro numero, por exemplo 6 ou 18.
echo   Os 6 meses anteriores sempre serao lidos para analisar zeros; nunca serao alterados.
set /p JANELA=Quantas competencias deseja conferir? [padrao 1]: 
if "%JANELA%"=="" set "JANELA=1"
echo.
echo Categorias:
echo   1 - Geral
echo   2 - Pediatria
echo   3 - Maternidade
echo   4 - Todos
echo   Para combinar categorias, separe os numeros por virgula, exemplo: 1,3
set /p CATEGORIAS=Categorias [1/2/3/4] (padrao 4): 
if "%CATEGORIAS%"=="" set "CATEGORIAS=4"
set /p UNIDADES=Siglas opcionais, separadas por virgula [HMAS,HMMC,todos]: 
echo.
echo Iniciando: modo=%MODO% navegador=%NAVEGADOR% competencia=%COMPETENCIA% janela=%JANELA%
node src\cli.mjs --modo=%MODO% --navegador=%NAVEGADOR% --competencia=%COMPETENCIA% --janela=%JANELA% --categorias=%CATEGORIAS% --unidades=%UNIDADES%
set "CODIGO=%ERRORLEVEL%"
echo.
if not "%CODIGO%"=="0" (
  echo A execucao terminou com codigo %CODIGO%. Verifique as mensagens acima.
) else (
  echo Execucao finalizada. O arquivo do painel foi regenerado.
)
if not exist "%~dp0painel\painel-dashboard.html" goto FIM
set "ABRIRPAINEL="
set /p ABRIRPAINEL=Abrir o painel atualizado agora? [S/n]: 
if /I "%ABRIRPAINEL%"=="N" goto FIM
start "" "%~dp0painel\painel-dashboard.html"
:FIM
echo.
pause
