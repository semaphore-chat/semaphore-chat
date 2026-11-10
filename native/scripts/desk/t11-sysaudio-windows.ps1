# T11 on a real Windows machine: WASAPI process loopback must capture other apps and never our
# own call audio. Nothing about Windows counts as tested until this has run.
#
#   powershell -ExecutionPolicy Bypass -File t11-sysaudio-windows.ps1 [-Exe .\rig-sysaudio.exe] [-Seconds 30]
#
# Get rig-sysaudio.exe (and this script) from the "rig-sysaudio-windows" artifact of the
# native-spike workflow's windows-link job. Needs Windows 10 2004 (build 19041) or later, and an
# output device. You will hear two quiet tones. Three runs, about 2 minutes in all:
#   1. exclusion: a "game" (523 Hz, a second rig process) and our "call" (743 Hz, played by the
#      capturing process itself). Pass: game in >= 95% of 1 s windows within 6 dB, call <= -80 dBFS.
#   2. negative control: the same, capturing only our own process. The call tone must be there
#      (proves the detector); the game must not.
#   3. exclusion again while you switch the default output device once (Settings > Sound, or the
#      taskbar speaker menu) around the middle of the run. Same bar as 1.
# Writes results\t11-windows-<time>\ next to the script: each run's JSON lines and summary.json.
param(
    [string]$Exe = (Join-Path $PSScriptRoot "rig-sysaudio.exe"),
    [int]$Seconds = 30
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Exe)) { throw "rig-sysaudio.exe not found at $Exe (pass -Exe)" }
$build = [Environment]::OSVersion.Version.Build
Write-Host "Windows build $build"
if ($build -lt 19041) { Write-Warning "process loopback needs build 19041 or later; expect activation to fail" }
$out = Join-Path $PSScriptRoot ("results\t11-windows-" + (Get-Date -Format "yyyyMMddTHHmmss"))
New-Item -ItemType Directory -Force -Path $out | Out-Null
$gameDb = 20 * [Math]::Log10(0.05)

function Invoke-Rig([hashtable]$envs, [string]$log) {
    $old = @{}
    foreach ($k in $envs.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envs[$k]) }
    try { & $Exe 2>&1 | ForEach-Object { "$_" } | Set-Content -Encoding utf8 $log }
    finally { foreach ($k in $envs.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) } }
}

function Judge([string]$log, [bool]$control) {
    $events = Get-Content $log | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ }
    $start = ($events | Where-Object { $_.ev -eq "capture_started" } | Select-Object -First 1).t
    $done = ($events | Where-Object { $_.ev -eq "done" } | Select-Object -First 1).t
    $slow = @($events | Where-Object { $_.ev -eq "win" -and $_.span -eq "slow" -and $start -and ($_.t - 1000) -ge ($start + 2000) -and (-not $done -or $_.t -le $done) })
    $a = @($slow | ForEach-Object { $_.db.a }); $b = @($slow | ForEach-Object { $_.db.b })
    $within = @($a | Where-Object { [Math]::Abs($_ - $gameDb) -le 6 }).Count
    $share = if ($a.Count) { $within / $a.Count } else { 0 }
    $bMax = if ($b.Count) { ($b | Measure-Object -Maximum).Maximum } else { $null }
    $aMax = if ($a.Count) { ($a | Measure-Object -Maximum).Maximum } else { $null }
    $bShare = if ($b.Count) { @($b | Where-Object { [Math]::Abs($_ - $gameDb) -le 6 }).Count / $b.Count } else { 0 }
    if ($control) {
        $pass = ($slow.Count -ge 10) -and ($bShare -ge 0.95) -and ($aMax -le -80)
    } else {
        $pass = ($slow.Count -ge 10) -and ($share -ge 0.95) -and ($bMax -ne $null) -and ($bMax -le -80)
    }
    $errors = @($events | Where-Object { $_.ev -eq "error" -or $_.level -eq "WARN" -or $_.ev -eq "text" } | ForEach-Object { if ($_.msg) { $_.msg } else { "$_" } } | Select-Object -First 5)
    [ordered]@{ pass = $pass; windows = $slow.Count; game_share_within_6db = [Math]::Round($share, 3); game_max_db = $aMax;
                call_max_db = $bMax; call_share_within_6db = [Math]::Round($bShare, 3); errors = $errors }
}

function Run-Case([string]$name, [bool]$control, [string]$prompt) {
    Write-Host ""
    Write-Host "== $name ($Seconds s)"
    if ($prompt) { Write-Host $prompt -ForegroundColor Yellow }
    $game = Start-Process -FilePath $Exe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "$name-game.jsonl") `
        -Environment @{ MODE = "game"; GAME_HZ = "523"; GAME_AMPLITUDE = "0.05"; DURATION_S = "$($Seconds + 10)" } 2>$null
    $log = Join-Path $out "$name.jsonl"
    try {
        Invoke-Rig @{ MODE = "local"; TONES = "a:523,b:743"; CALL_HZ = "743"; CALL_AMPLITUDE = "0.05"; DURATION_S = "$Seconds";
                      INCLUDE_OWN = $(if ($control) { "1" } else { "0" }) } $log
    } finally {
        if (-not $game.HasExited) { Stop-Process -Id $game.Id -Force }
    }
    $result = Judge $log $control
    $verdict = if ($result.pass) { "PASS" } else { "FAIL" }
    Write-Host ("{0}: {1}  windows {2}, game within 6 dB {3:P0}, game max {4} dBFS, call max {5} dBFS" -f `
        $name, $verdict, $result.windows, $result.game_share_within_6db, $result.game_max_db, $result.call_max_db)
    foreach ($e in $result.errors) { Write-Host "  $e" }
    $result
}

# Start-Process -Environment needs PowerShell 7.4+; older ones (Windows PowerShell 5.1) pass it through our own env.
if ($PSVersionTable.PSVersion -lt [version]"7.4") {
    function Start-Process {
        param($FilePath, [switch]$PassThru, $WindowStyle, $RedirectStandardOutput, [hashtable]$Environment)
        foreach ($k in $Environment.Keys) { [Environment]::SetEnvironmentVariable($k, $Environment[$k]) }
        $p = Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -PassThru -WindowStyle $WindowStyle -RedirectStandardOutput $RedirectStandardOutput
        foreach ($k in $Environment.Keys) { [Environment]::SetEnvironmentVariable($k, $null) }
        $p
    }
}

$summary = [ordered]@{
    test = "T11 Windows"; build = $build
    exclusion = Run-Case "exclusion" $false ""
    negative_control = Run-Case "control" $true ""
    device_switch = Run-Case "switch" $false "Switch the default output device once, about $([int]($Seconds / 2)) s from now."
}
$summary.pass = $summary.exclusion.pass -and $summary.negative_control.pass -and $summary.device_switch.pass
$summary | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $out "summary.json")
Write-Host ""
Write-Host ("T11 Windows: {0}. Results in {1}" -f $(if ($summary.pass) { "PASS" } else { "FAIL" }), $out)
Write-Host "Send the whole folder back; then play a game or a video while sharing in a real call and listen as a viewer."
