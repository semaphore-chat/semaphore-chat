# T11 on a real Windows machine: WASAPI process loopback must capture other apps and never our
# own call audio. Nothing about Windows counts as tested until this has run.
#
#   powershell -ExecutionPolicy Bypass -File t11-sysaudio-windows.ps1 [-Exe .\rig-sysaudio.exe] [-Seconds 30]
#   powershell -ExecutionPolicy Bypass -File t11-sysaudio-windows.ps1 -Rejudge results\t11-windows-<time>
#
# Get rig-sysaudio.exe (and this script) from the "rig-sysaudio-windows" artifact of the
# native-spike workflow's windows-link job. Needs Windows 10 2004 (build 19041) or later, and an
# output device. You will hear two quiet tones. Three runs, about 2 minutes in all:
#   1. exclusion: a "game" (523 Hz, a second rig process) and our "call" (743 Hz, played by the
#      capturing process itself). Pass: game in >= 95% of 1 s windows within 6 dB, and the call
#      never leaks (below).
#   2. negative control: the same, capturing only our own process. The call tone must be there and
#      be judged a leak in >= 95% of windows (proves the detector); the game must not leak.
#   3. exclusion again while you switch the default output device once (Settings > Sound, or the
#      taskbar speaker menu) around the middle of the run. Same bar as 1. With one output device
#      there is nothing to switch to: reported as SKIPPED, not run.
# Absent, per 1 s window (the same rule as native/rigs/sysaudio/t11_judge.py; keep them identical):
# a LEAK is above -80 dBFS and at least 20 dB above the 330 Hz reference bin, which nobody plays;
# above -80 but not 20 dB above it is a GLITCH (a dropout or click spreads over every frequency).
# Any leak fails; glitches are counted and don't, but more than 5% of them is "too noisy to judge".
# Writes results\t11-windows-<time>\ next to the script: each run's JSON lines and summary.json.
# -Rejudge <folder> judges such a folder again without running anything (into summary-rejudged.json).
param(
    [string]$Exe = (Join-Path $PSScriptRoot "rig-sysaudio.exe"),
    [int]$Seconds = 30,
    [string]$Rejudge = ""
)
$ErrorActionPreference = "Stop"
$gameDb = 20 * [Math]::Log10(0.05)
$floorDb = -80.0; $leakAboveRefDb = 20.0; $maxGlitchShare = 0.05; $controlLeakShare = 0.95; $refHz = 330
$tones = "a:523,b:743,ref:$refHz"

# One window: "clean", "leak" or "glitch". No reference level (an old run) means the old rule: a leak.
function Classify($level, $ref) {
    if ($level -le $floorDb) { return "clean" }
    if ($null -eq $ref -or ($level - $ref) -ge $leakAboveRefDb) { return "leak" }
    return "glitch"
}

function Judge-Absent($slow, [string]$tone) {
    $leaks = 0; $glitches = 0
    foreach ($w in $slow) {
        $kind = Classify $w.db.$tone $w.db.ref
        if ($kind -eq "leak") { $leaks++ } elseif ($kind -eq "glitch") { $glitches++ }
    }
    $n = $slow.Count
    $glitchShare = if ($n) { $glitches / $n } else { 0 }
    $tooNoisy = $glitchShare -gt $maxGlitchShare
    [ordered]@{ no_leak = ($n -gt 0) -and ($leaks -eq 0); judgeable = ($n -gt 0) -and (-not $tooNoisy)
                leaks = $leaks; glitches = $glitches; glitch_share = [Math]::Round($glitchShare, 3); too_noisy = $tooNoisy }
}

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
    $call = Judge-Absent $slow "b"; $game = Judge-Absent $slow "a"
    $callLeakShare = if ($slow.Count) { $call.leaks / $slow.Count } else { 0 }
    $within = @($a | Where-Object { [Math]::Abs($_ - $gameDb) -le 6 }).Count
    $share = if ($a.Count) { $within / $a.Count } else { 0 }
    $bMax = if ($b.Count) { ($b | Measure-Object -Maximum).Maximum } else { $null }
    $aMax = if ($a.Count) { ($a | Measure-Object -Maximum).Maximum } else { $null }
    $bShare = if ($b.Count) { @($b | Where-Object { [Math]::Abs($_ - $gameDb) -le 6 }).Count / $b.Count } else { 0 }
    if ($control) {
        $absent = $game
        $pass = ($slow.Count -ge 10) -and ($bShare -ge 0.95) -and ($callLeakShare -ge $controlLeakShare) -and $game.no_leak -and $game.judgeable
    } else {
        $absent = $call
        $pass = ($slow.Count -ge 10) -and ($share -ge 0.95) -and $call.no_leak -and $call.judgeable
    }
    $why = if ($pass) { "" } elseif ($slow.Count -lt 10) { "too few windows" } elseif ($absent.leaks) { "leak" } `
        elseif ($control -and $callLeakShare -lt $controlLeakShare) { "control not detected" } `
        elseif ($absent.too_noisy) { "too noisy to judge" } else { "bar" }
    $errors = @($events | Where-Object { $_.ev -eq "error" -or $_.level -eq "WARN" -or $_.ev -eq "text" } | ForEach-Object { if ($_.msg) { $_.msg } else { "$_" } } | Select-Object -First 5)
    [ordered]@{ pass = $pass; why = $why; windows = $slow.Count; game_share_within_6db = [Math]::Round($share, 3); game_max_db = $aMax;
                call_max_db = $bMax; call_share_within_6db = [Math]::Round($bShare, 3); call_leak_share = [Math]::Round($callLeakShare, 3)
                absent_tone = $(if ($control) { "a" } else { "b" }); leaks = $absent.leaks; glitches = $absent.glitches
                glitch_share = $absent.glitch_share; too_noisy = $absent.too_noisy; errors = $errors }
}

function Show-Result([string]$name, $result) {
    $verdict = if ($result.pass) { "PASS" } else { "FAIL ($($result.why))" }
    Write-Host ("{0}: {1}  windows {2}, game within 6 dB {3:P0}, game max {4} dBFS, call max {5} dBFS" -f `
        $name, $verdict, $result.windows, $result.game_share_within_6db, $result.game_max_db, $result.call_max_db)
    Write-Host ("  tone {0}: {1} leak, {2} glitch windows ({3:P0}; bar {4:P0})" -f `
        $result.absent_tone, $result.leaks, $result.glitches, $result.glitch_share, $maxGlitchShare)
    foreach ($e in $result.errors) { Write-Host "  $e" }
}

# Output devices the rig listed in its "devices" line (a Rust Debug string), or -1 if unknown.
function Output-Count([string]$log) {
    if (-not (Test-Path $log)) { return -1 }
    $line = Get-Content $log | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
        Where-Object { $_ -and $_.ev -eq "devices" } | Select-Object -First 1
    if (-not $line -or "$($line.devices)" -notmatch "outputs: \[(.*)\]") { return -1 }
    return ([regex]::Matches($Matches[1], "AudioDevice \{")).Count
}

function Finish($summary, [string]$out, [string]$file = "summary.json") {
    $switchOk = ($summary.device_switch -is [string]) -or $summary.device_switch.pass
    $summary.pass = $summary.exclusion.pass -and $summary.negative_control.pass -and $switchOk
    $summary | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $out $file)
    Write-Host ""
    Write-Host ("T11 Windows: {0}. Results in {1}" -f $(if ($summary.pass) { "PASS" } else { "FAIL" }), $out)
}

if ($Rejudge) {
    $summary = [ordered]@{ test = "T11 Windows (re-judged)" }
    foreach ($case in @(@("exclusion", "exclusion", $false), @("negative_control", "control", $true), @("device_switch", "switch", $false))) {
        $log = Join-Path $Rejudge "$($case[1]).jsonl"
        if ($case[1] -ne "switch" -or (Test-Path $log)) {
            $summary[$case[0]] = Judge $log $case[2]
            Show-Result $case[1] $summary[$case[0]]
        } else {
            $summary[$case[0]] = "SKIPPED (one output device)"
            Write-Host "$($case[1]): $($summary[$case[0]])"
        }
    }
    Finish $summary $Rejudge "summary-rejudged.json"
    exit $(if ($summary.pass) { 0 } else { 1 })
}

if (-not (Test-Path $Exe)) { throw "rig-sysaudio.exe not found at $Exe (pass -Exe)" }
$build = [Environment]::OSVersion.Version.Build
Write-Host "Windows build $build"
if ($build -lt 19041) { Write-Warning "process loopback needs build 19041 or later; expect activation to fail" }
$out = Join-Path $PSScriptRoot ("results\t11-windows-" + (Get-Date -Format "yyyyMMddTHHmmss"))
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Run-Case([string]$name, [bool]$control, [string]$prompt) {
    Write-Host ""
    Write-Host "== $name ($Seconds s)"
    if ($prompt) { Write-Host $prompt -ForegroundColor Yellow }
    $game = Start-Process -FilePath $Exe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "$name-game.jsonl") `
        -Environment @{ MODE = "game"; GAME_HZ = "523"; GAME_AMPLITUDE = "0.05"; DURATION_S = "$($Seconds + 10)" } 2>$null
    $log = Join-Path $out "$name.jsonl"
    try {
        Invoke-Rig @{ MODE = "local"; TONES = $tones; CALL_HZ = "743"; CALL_AMPLITUDE = "0.05"; DURATION_S = "$Seconds";
                      INCLUDE_OWN = $(if ($control) { "1" } else { "0" }) } $log
    } finally {
        if (-not $game.HasExited) { Stop-Process -Id $game.Id -Force }
    }
    $result = Judge $log $control
    Show-Result $name $result
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
}
$outputs = Output-Count (Join-Path $out "exclusion.jsonl")
if ($outputs -eq 1) {
    # Switching needs a second device; running it anyway would only repeat the exclusion run.
    $summary.device_switch = "SKIPPED (one output device)"
    Write-Host ""
    Write-Host "switch: $($summary.device_switch)"
} else {
    $summary.device_switch = Run-Case "switch" $false "Switch the default output device once, about $([int]($Seconds / 2)) s from now."
}
Finish $summary $out
Write-Host "Send the whole folder back; then play a game or a video while sharing in a real call and listen as a viewer."
