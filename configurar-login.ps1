$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaSegredos = Join-Path $raiz "segredos"
New-Item -ItemType Directory -Path $pastaSegredos -Force | Out-Null

function Testar-CpfFormato([string]$valor) {
    return $valor -match '^\d{11}$'
}

$usuarioWindows = [Environment]::UserName
$cpfSugerido = if (Testar-CpfFormato $usuarioWindows) { $usuarioWindows } else { "" }

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " Configuracao segura do acesso ao SMS Rio" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "A senha sera protegida pelo Windows e funcionara somente"
Write-Host "neste usuario e neste computador."
Write-Host ""

if ($cpfSugerido) {
    $cpf = Read-Host "CPF do SMS Rio [$cpfSugerido]"
    if ([string]::IsNullOrWhiteSpace($cpf)) { $cpf = $cpfSugerido }
} else {
    $cpf = Read-Host "Digite o CPF do SMS Rio (11 numeros)"
}

$cpf = ($cpf -replace '\D', '')
if (-not (Testar-CpfFormato $cpf)) {
    throw "CPF invalido. Informe exatamente 11 numeros."
}

$senha = Read-Host "Digite a senha do SMS Rio" -AsSecureString
$protegida = ConvertFrom-SecureString $senha

$utf8SemBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $pastaSegredos "smsrio-cpf.txt"), $cpf, $utf8SemBom)
[IO.File]::WriteAllText((Join-Path $pastaSegredos "smsrio-senha.dat"), $protegida, $utf8SemBom)

Write-Host ""
Write-Host "Login automatico configurado com sucesso." -ForegroundColor Green
if ($cpfSugerido -and $cpf -eq $cpfSugerido) {
    Write-Host "O CPF foi identificado automaticamente pelo usuario do Windows."
}
Write-Host "A credencial ficou protegida para o usuario Windows atual: $usuarioWindows"
