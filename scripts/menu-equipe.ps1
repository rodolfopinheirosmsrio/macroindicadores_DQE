$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

function Titulo {
    Clear-Host
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "              MACROINDICADORES SUBHUE - DQE" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "Usuario Windows: $([Environment]::UserName)"
    Write-Host "Google esperado: subhueindicadores@gmail.com"
    Write-Host ""
}

function Pausa { Write-Host ""; Read-Host "Pressione ENTER para voltar ao menu" | Out-Null }

while ($true) {
    Titulo
    Write-Host "1 - Executar / conferir / atualizar Macroindicadores"
    Write-Host "2 - Publicar o painel atualizado no GitHub"
    Write-Host "3 - Abrir o painel local"
    Write-Host "4 - Abrir o ultimo relatorio de execucao"
    Write-Host "5 - Abrir a pasta de backups do computador"
    Write-Host "6 - Abrir a pasta de backups no Google Drive"
    Write-Host "7 - Configurar meu login do SMS Rio"
    Write-Host "8 - Autorizar a conta Google da equipe"
    Write-Host "9 - Atualizar o robo pelo GitHub"
    Write-Host "S - Verificar ambiente e acessos"
    Write-Host "0 - Sair"
    Write-Host ""
    $opcao = (Read-Host "Escolha uma opcao").Trim().ToUpperInvariant()

    switch ($opcao) {
        "1" {
            & cmd.exe /c "`"$raiz\executar.bat`""
        }
        "2" {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\scripts\publicar-painel.ps1"
            Pausa
        }
        "3" {
            $painel = Join-Path $raiz "painel\painel-dashboard.html"
            if (Get-Command node -ErrorAction SilentlyContinue) {
                Write-Host "Sincronizando o painel compartilhado da equipe..." -ForegroundColor Cyan
                & node (Join-Path $raiz "src\sincronizar-painel-equipe.mjs") "--somente-leitura=true"
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Nao foi possivel sincronizar agora. Sera aberta a ultima copia local, se existir." -ForegroundColor Yellow
                }
            }
            if (Test-Path $painel) {
                Start-Process $painel
            } else {
                Write-Host "Painel local ainda nao existe e a sincronizacao nao foi concluida." -ForegroundColor Yellow
                Write-Host "Use a opcao 8 para autorizar o Google da equipe e tente novamente."
                Pausa
            }
        }
        "4" {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\scripts\abrir-ultimo-relatorio.ps1"
            Pausa
        }
        "5" {
            $backup = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Backup do macro indicadores"
            New-Item -ItemType Directory -Path $backup -Force | Out-Null
            Start-Process explorer.exe $backup
        }
        "6" {
            Start-Process "https://drive.google.com/drive/folders/1vlZzgJYNg_PC1yvVuCU1Df97xJjksTS0"
        }
        "7" {
            & cmd.exe /c "`"$raiz\configurar-login.bat`""
        }
        "8" {
            & cmd.exe /c "`"$raiz\autorizar-google.bat`""
        }
        "9" {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\scripts\atualizar-robo.ps1"
            Pausa
        }
        "S" {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\scripts\status-ambiente.ps1"
            Pausa
        }
        "0" { break }
        default { Write-Host "Opcao invalida." -ForegroundColor Yellow; Start-Sleep -Seconds 1 }
    }
    if ($opcao -eq "0") { break }
}
