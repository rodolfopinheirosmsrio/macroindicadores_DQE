$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktop = [Environment]::GetFolderPath("Desktop")
$atalho = Join-Path $desktop "Macroindicadores SUBHUE.lnk"
$destino = Join-Path $raiz "Macroindicadores.bat"

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($atalho)
$lnk.TargetPath = $destino
$lnk.WorkingDirectory = $raiz
$lnk.Description = "Macroindicadores SUBHUE - DQE"
$lnk.Save()
Write-Host "Atalho criado: $atalho" -ForegroundColor Green
