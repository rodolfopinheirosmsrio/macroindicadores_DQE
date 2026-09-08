$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

function Executar-Git([string[]]$Argumentos, [switch]$PermitirFalha) {
    & git @Argumentos
    $codigo = $LASTEXITCODE
    if ($codigo -ne 0 -and -not $PermitirFalha) {
        throw "Falha ao executar: git $($Argumentos -join ' ')"
    }
    return $codigo
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git nao encontrado. Execute instalar.bat depois de instalar o Git for Windows."
}
if (-not (Test-Path (Join-Path $raiz ".git"))) {
    throw "Esta copia nao e um clone Git. Instale a equipe pelo instalador ou use a pasta clonada do GitHub."
}

$gerado = Join-Path $raiz "painel\painel-dashboard.html"
$publico = Join-Path $raiz "painel\index.html"
if (-not (Test-Path $gerado)) {
    throw "O painel atualizado ainda nao foi gerado neste computador. Execute o robo antes de publicar."
}

Write-Host "Verificando se existe uma versao mais nova no GitHub..."
Executar-Git @("fetch", "origin", "main") | Out-Null
$atras = (& git rev-list --count "HEAD..origin/main").Trim()
if ([int]$atras -gt 0) {
    throw "Este computador esta $atras commit(s) atras do GitHub. Use a opcao 'Atualizar o robo' antes de publicar e execute novamente a conferencia."
}

Copy-Item $gerado $publico -Force
Executar-Git @("add", "--", "painel/index.html", "painel/assets/sidebar-ai-bg.webp") | Out-Null

& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "O painel publicado ja esta igual ao painel gerado. Nenhuma publicacao necessaria." -ForegroundColor Green
    exit 0
}

$nome = (& git config user.name).Trim()
$email = (& git config user.email).Trim()
if (-not $nome -or -not $email) {
    throw "Identidade do Git nao configurada neste usuario. Configure nome/e-mail do Git antes da primeira publicacao."
}

Write-Host ""
Write-Host "Publicacao preparada:" -ForegroundColor Cyan
Write-Host "  Usuario Git: $nome <$email>"
Write-Host "  Arquivo: painel/index.html"
Write-Host "  Segredos, logs e perfil do navegador NAO serao enviados."
Write-Host ""
$confirma = (Read-Host "Confirmar publicacao no GitHub? [S/n]").Trim()
if ($confirma -and $confirma.ToUpperInvariant() -ne "S") {
    Executar-Git @("reset", "--", "painel/index.html", "painel/assets/sidebar-ai-bg.webp") | Out-Null
    Write-Host "Publicacao cancelada."
    exit 0
}

$carimbo = Get-Date -Format "yyyy-MM-dd HH:mm"
Executar-Git @("commit", "-m", "Painel Macroindicadores - $carimbo") | Out-Null
Executar-Git @("push", "origin", "main") | Out-Null
Write-Host ""
Write-Host "Painel enviado ao GitHub com sucesso." -ForegroundColor Green
Write-Host "O GitHub Pages sera acionado automaticamente pelo workflow do repositorio."
