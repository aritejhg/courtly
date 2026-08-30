param(
  [switch]$Uninstall,
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$taskName = 'Courtly SG Local Ingestion'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-local-ingestion.mjs'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task: $taskName"
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$runner`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Code-only Courtly Telegram ingestion. Codex Luna-low runs only for new parser ambiguities.' -Force | Out-Null

if ($RunNow) {
  Start-ScheduledTask -TaskName $taskName
}

Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State

