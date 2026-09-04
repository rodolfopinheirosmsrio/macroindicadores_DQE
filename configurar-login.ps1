$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaSegredos = Join-Path $raiz "segredos"
New-Item -ItemType Directory -Path $pastaSegredos -Force | Out-Null

Write-Host "Configuracao segura do acesso ao SMS Rio"
Write-Host "A senha sera protegida pelo Windows e funcionara somente neste usuario e computador."
$senha = Read-Host "Digite a senha do SMS Rio" -AsSecureString
$protegida = ConvertFrom-SecureString $senha

[IO.File]::WriteAllText((Join-Path $pastaSegredos "smsrio-cpf.txt"), "15407850761", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $pastaSegredos "smsrio-senha.dat"), $protegida, (New-Object Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "Login automatico configurado com sucesso."
