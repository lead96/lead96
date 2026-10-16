# Registers a Windows scheduled task that runs the Lead96 data export every day
# (npm run db:export -- --files --keep 14), until Supabase Pro backups exist.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
#
# - Runs daily at 13:00 as the current user (only while logged in; no password stored).
# - If the PC was off at 13:00, it runs as soon as possible afterwards.
# - Keeps the newest 14 copies in backups\ (git-ignored); output goes to backups\export.log.
# - Needs SUPABASE_ACCESS_TOKEN in .env.local (same as `npm run db:export`).
#
# Run it now:   Start-ScheduledTask -TaskName "Lead96 data export"
# Remove it:    Unregister-ScheduledTask -TaskName "Lead96 data export" -Confirm:$false

$repo = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Force (Join-Path $repo "backups") | Out-Null

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$repo`" && `"$npm`" run db:export -- --files --keep 14 >> backups\export.log 2>&1"
$trigger = New-ScheduledTaskTrigger -Daily -At 13:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName "Lead96 data export" `
  -Description "Daily safety copy of the Lead96 database (npm run db:export) until Supabase Pro backups exist. Keeps 14 copies in $repo\backups." `
  -Action $action -Trigger $trigger -Settings $settings -Force | Select-Object TaskName, State

Write-Host "Registered. Test it now with: Start-ScheduledTask -TaskName 'Lead96 data export'  (then check backups\export.log)"
