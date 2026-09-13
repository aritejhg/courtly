param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'Courtly SG Local Ingestion'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task: $taskName"
  exit 0
}

Write-Output 'Local scheduled ingestion is retired. Production ingestion runs only on the ingestion host. Use -Uninstall to remove a stale task.'
exit 2
