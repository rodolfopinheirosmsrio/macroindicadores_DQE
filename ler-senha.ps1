$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$arquivo = Join-Path $raiz "segredos\smsrio-senha.dat"
if (-not (Test-Path -LiteralPath $arquivo)) { exit 0 }
$protegida = Get-Content -Raw -LiteralPath $arquivo
$segura = ConvertTo-SecureString $protegida
$ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try {
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
}
