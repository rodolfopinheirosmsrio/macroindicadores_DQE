$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pasta = Join-Path $raiz "relatorios"
if (-not (Test-Path $pasta)) {
    Write-Host "Nenhum relatorio foi gerado neste computador." -ForegroundColor Yellow
    exit 0
}
$arquivo = Get-ChildItem $pasta -Filter "relatorio-*.html" -File -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $arquivo) {
    Write-Host "Nenhum relatorio HTML foi encontrado." -ForegroundColor Yellow
    exit 0
}
Write-Host "Abrindo: $($arquivo.FullName)"
Start-Process $arquivo.FullName
