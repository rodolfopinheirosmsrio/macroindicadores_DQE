$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git nao encontrado." }
if (-not (Test-Path (Join-Path $raiz ".git"))) { throw "Execute este arquivo dentro da copia original clonada do GitHub." }

Write-Host "Verificando o GitHub antes de publicar a versao do robo..."
& git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "Falha ao consultar o GitHub." }
$atras = [int]((& git rev-list --count "HEAD..origin/main").Trim())
if ($atras -gt 0) {
    throw "O repositorio local esta $atras commit(s) atras do GitHub. Atualize/integre antes de publicar esta versao."
}

$arquivos = @(
    ".gitignore",
    "README.md",
    "GUIA-PASSO-A-PASSO.md",
    "MANUAL-DE-UTILIZACAO-DO-ROBO.md",
    "GUIA-EQUIPE-MULTIUSUARIO.md",
    "ALTERACOES-ESTADO-COMPARTILHADO.txt",
    "Macroindicadores.bat",
    "atualizar-robo.bat",
    "publicar-painel.bat",
    "instalar.bat",
    "executar.bat",
    "configurar-login.ps1",
    "config/config.json",
    "package.json",
    "src/cli.mjs",
    "src/dashboard-ui.mjs",
    "src/dashboard.mjs",
    "src/google-login.mjs",
    "src/google.mjs",
    "src/estado-equipe.mjs",
    "src/sincronizar-painel-equipe.mjs",
    "src/verificar-google.mjs",
    "scripts/abrir-ultimo-relatorio.ps1",
    "scripts/atualizar-robo.ps1",
    "scripts/criar-atalho.ps1",
    "scripts/menu-equipe.ps1",
    "scripts/publicar-painel.ps1",
    "scripts/publicar-versao-robo.ps1",
    "scripts/status-ambiente.ps1",
    "instalador-equipe/INSTALAR-MACROINDICADORES-EQUIPE.bat",
    "instalador-equipe/instalar-equipe.ps1",
    "instalador-equipe/LEIA-ANTES.txt",
    "publicar-versao-robo.bat"
)

& git add -- $arquivos
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel preparar os arquivos da versao multiusuario." }

& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nenhuma alteracao da versao do robo esta pendente para publicar." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Arquivos preparados para a nova versao:" -ForegroundColor Cyan
& git diff --cached --name-status
Write-Host ""
Write-Host "A pasta segredos, tokens, senhas, logs e perfil do navegador nao fazem parte desta publicacao." -ForegroundColor Green
$confirma = (Read-Host "Publicar esta versao multiusuario no GitHub? [S/n]").Trim()
if ($confirma -and $confirma.ToUpperInvariant() -ne "S") {
    & git reset -- $arquivos | Out-Null
    Write-Host "Publicacao cancelada."
    exit 0
}

& git commit -m "Macroindicadores: estado compartilhado do painel"
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o commit." }
& git push origin main
if ($LASTEXITCODE -ne 0) { throw "Falha ao enviar a versao ao GitHub." }
Write-Host "Versao multiusuario publicada no GitHub com sucesso." -ForegroundColor Green
