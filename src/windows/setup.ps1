# Installs Vocal Trainer for this Windows user: copies the app to
# %LOCALAPPDATA%\VocalTrainer and adds Desktop and Start menu shortcuts that
# open it in its own Microsoft Edge window. Run it again to update.
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'VocalTrainer'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $src 'vocal-trainer.html') $dest
Copy-Item -Force (Join-Path $src 'vocal-trainer.ico') $dest

$edge = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found on this PC.' }

$url = ([System.Uri](Join-Path $dest 'vocal-trainer.html')).AbsoluteUri
$icon = Join-Path $dest 'vocal-trainer.ico'
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Vocal Trainer.lnk'))
  $lnk.TargetPath = $edge
  $lnk.Arguments = "--app=`"$url`""
  $lnk.IconLocation = $icon
  $lnk.Description = 'Vocal Trainer singing practice'
  $lnk.Save()
}

Write-Host ''
Write-Host 'Vocal Trainer is installed.' -ForegroundColor Green
Write-Host 'Open it from the Desktop icon, or search "Vocal Trainer" in the Start menu.'
Write-Host 'Opening it now...'
Start-Process -FilePath $edge -ArgumentList "--app=`"$url`""
