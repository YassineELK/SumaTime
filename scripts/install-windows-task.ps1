# Run as an administrator on the target Windows Server, after compilation.
param([string]$TaskName = 'Sumatoni Time')
$ErrorActionPreference = 'Stop'
$applicationRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $applicationRoot '.next/BUILD_ID'))) { throw "Compilez avec npm run build avant de continuer." }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Cette tâche existe déjà. Vérifiez-la avant de la modifier.' }
$dataDirectory = Join-Path $applicationRoot 'data'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
# The built-in Local Service identity needs read access to the application and
# write access only to its data. SIDs keep this independent of Windows language.
& icacls.exe $applicationRoot /grant '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossible de régler les droits de lecture.' }
& icacls.exe $dataDirectory /inheritance:r /grant:r '*S-1-5-19:(OI)(CI)M' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossible de régler les droits des données.' }
$taskArguments = '--env-file-if-exists=.env.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 5173'
$action = New-ScheduledTaskAction -Execute $nodePath -Argument $taskArguments -WorkingDirectory $applicationRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Application Sumatoni Time, comptes locaux et AD/LDAP.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output 'Tâche installée. Vérifiez http://127.0.0.1:5173 sur le serveur, puis le reverse proxy HTTPS.'
