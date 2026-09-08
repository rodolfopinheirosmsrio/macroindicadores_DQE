$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

function Status([bool]$ok, [string]$texto) {
    if ($ok) { Write-Host "[OK]   $texto" -ForegroundColor Green }
    else { Write-Host "[FALTA] $texto" -ForegroundColor Yellow }
}

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " Diagnostico do Macroindicadores" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Usuario Windows: $([Environment]::UserName)"
Write-Host "Pasta do robo: $raiz"
Write-Host ""

Status ([bool](Get-Command node -ErrorAction SilentlyContinue)) "Node.js"
if (Get-Command node -ErrorAction SilentlyContinue) { Write-Host "       $(node --version)" }
Status ([bool](Get-Command git -ErrorAction SilentlyContinue)) "Git"
Status (Test-Path (Join-Path $raiz "node_modules")) "Dependencias npm instaladas"
Status (Test-Path (Join-Path $raiz "segredos\credentials.json")) "Credencial OAuth Google (credentials.json)"
$temToken = Test-Path (Join-Path $raiz "segredos\token.json")
Status $temToken "Autorizacao Google deste usuario/computador"
if ($temToken -and (Test-Path (Join-Path $raiz "node_modules")) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $saidaGoogle = & node "$raiz\src\verificar-google.mjs" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "       $saidaGoogle" -ForegroundColor Green
    } else {
        Write-Host "       Google: $saidaGoogle" -ForegroundColor Yellow
    }
}
Status (Test-Path (Join-Path $raiz "segredos\smsrio-cpf.txt")) "CPF SMS Rio configurado"
Status (Test-Path (Join-Path $raiz "segredos\smsrio-senha.dat")) "Senha SMS Rio protegida pelo Windows"
Status (Test-Path (Join-Path $raiz ".git")) "Clone Git do repositorio"

if (Test-Path (Join-Path $raiz ".git")) {
    $remote = (& git remote get-url origin 2>$null)
    Write-Host "       Repositorio: $remote"
    $gitNome = (& git config user.name 2>$null)
    $gitEmail = (& git config user.email 2>$null)
    Write-Host "       Git: $gitNome <$gitEmail>"
    & git ls-remote origin HEAD *> $null
    Status ($LASTEXITCODE -eq 0) "Acesso ao repositorio remoto"
}

$backup = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Backup do macro indicadores"
Write-Host "       Backup local: $backup"
Write-Host "       Google esperado: subhueindicadores@gmail.com"
