# Registers Stack IA to start at logon, inside the user's desktop session.
param([string]$TaskName = 'StackIA')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$launch = "Set-Location '$root'; & '$node' src/server.js *>> stackia.log"
$action = New-ScheduledTaskAction -Execute powershell.exe -WorkingDirectory $root `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$launch`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Registered task $TaskName"
