$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git nao encontrado." }
if (-not (Test-Path (Join-Path $raiz ".git"))) { throw "Esta copia nao e um clone Git do projeto." }

$alteracoes = @(& git status --porcelain | Where-Object {
    $_ -notmatch '^\?\? painel/painel-dashboard\.html$'
})
if ($alteracoes.Count -gt 0) {
    Write-Host "Ha alteracoes locais que precisam ser resolvidas antes da atualizacao:" -ForegroundColor Yellow
    $alteracoes | ForEach-Object { Write-Host "  $_" }
    throw "Atualizacao cancelada para evitar perda de arquivos."
}

Write-Host "Buscando a versao mais recente do robo..."
& git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel atualizar o codigo pelo GitHub." }

if (Test-Path (Join-Path $raiz "package.json")) {
    Write-Host "Conferindo dependencias Node.js..."
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar dependencias npm." }
}
Write-Host "Robo atualizado com sucesso." -ForegroundColor Green
