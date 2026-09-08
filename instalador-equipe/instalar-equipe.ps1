$ErrorActionPreference = "Stop"
$repo = "https://github.com/rodolfopinheirosmsrio/macroindicadores_DQE.git"
$destino = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Macroindicadores SUBHUE"
$origemCredencial = Join-Path $PSScriptRoot "credentials.json"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Instalador da equipe - Macroindicadores SUBHUE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Usuario Windows: $([Environment]::UserName)"
Write-Host "Destino: $destino"
Write-Host ""

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git for Windows nao encontrado. Instale o Git antes de continuar."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js nao encontrado. Instale Node.js 20 ou superior antes de continuar."
}

if (Test-Path (Join-Path $destino ".git")) {
    Write-Host "O projeto ja existe. Atualizando pelo GitHub..."
    Set-Location $destino
    $status = @(& git status --porcelain)
    if ($status.Count -gt 0) { throw "A pasta existente possui alteracoes locais. Resolva-as antes de reinstalar." }
    & git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar o repositorio." }
} elseif (Test-Path $destino) {
    throw "A pasta de destino ja existe, mas nao e um clone Git: $destino"
} else {
    Write-Host "Clonando o repositorio privado..."
    Write-Host "O Git Credential Manager pode abrir o navegador para autenticar sua conta GitHub."
    & git clone $repo $destino
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel clonar. Confirme se sua conta GitHub foi adicionada como colaboradora do repositorio."
    }
}

Set-Location $destino
$nome = (& git config user.name 2>$null).Trim()
$email = (& git config user.email 2>$null).Trim()
if (-not $nome) {
    $nome = Read-Host "Nome que deve aparecer nas publicacoes do GitHub"
    if ($nome) { & git config --local user.name $nome }
}
if (-not $email) {
    $email = Read-Host "E-mail da sua conta/identidade Git"
    if ($email) { & git config --local user.email $email }
}

New-Item -ItemType Directory -Path (Join-Path $destino "segredos") -Force | Out-Null
if (Test-Path $origemCredencial) {
    Copy-Item $origemCredencial (Join-Path $destino "segredos\credentials.json") -Force
    Write-Host "Credencial OAuth da equipe copiada para a pasta segura local." -ForegroundColor Green
} else {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "ATENCAO: credentials.json nao estava ao lado do instalador." -ForegroundColor Yellow
    Write-Host "Copie-o por canal seguro para: $destino\segredos\credentials.json" -ForegroundColor Yellow
}

& cmd.exe /c "`"$destino\instalar.bat`""
if ($LASTEXITCODE -ne 0) { throw "A instalacao das dependencias nao foi concluida." }

Write-Host ""
$login = (Read-Host "Configurar agora seu CPF/senha do SMS Rio? [S/n]").Trim()
if (-not $login -or $login.ToUpperInvariant() -eq "S") {
    & cmd.exe /c "`"$destino\configurar-login.bat`""
}

if (Test-Path (Join-Path $destino "segredos\credentials.json")) {
    Write-Host ""
    $google = (Read-Host "Autorizar agora subhueindicadores@gmail.com? [S/n]").Trim()
    if (-not $google -or $google.ToUpperInvariant() -eq "S") {
        & cmd.exe /c "`"$destino\autorizar-google.bat`""
    }
}

Write-Host ""
Write-Host "Instalacao concluida." -ForegroundColor Green
Write-Host "Use o atalho 'Macroindicadores SUBHUE' criado na Area de Trabalho."
Write-Host "Antes da primeira atualizacao, execute uma conferencia de teste."
