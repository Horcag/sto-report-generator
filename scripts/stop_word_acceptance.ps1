param(
    [Parameter(Mandatory = $true)][string]$RequestJson
)

$ErrorActionPreference = "Stop"

function Ensure-WindowInspectionMethods {
    if (-not ("WordAcceptanceCleanup.WindowInspection" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace WordAcceptanceCleanup {
    public static class WindowInspection {
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
        [DllImport("user32.dll")]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        public static string[] GetVisibleTopLevelWindowTitles(int targetProcessId) {
            var titles = new List<string>();
            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
                uint processId;
                GetWindowThreadProcessId(hWnd, out processId);
                if (processId != (uint)targetProcessId) return true;
                if (!IsWindowVisible(hWnd)) return true;
                int length = GetWindowTextLength(hWnd);
                if (length <= 0) return true;
                var text = new StringBuilder(length + 1);
                GetWindowText(hWnd, text, text.Capacity);
                if (text.Length > 0) titles.Add(text.ToString());
                return true;
            }, IntPtr.Zero);
            return titles.ToArray();
        }
    }
}
"@
    }
}

function Stop-OwnedProcess($PidPath, $ExpectedName, $ExpectedCommandFragments) {
    if (-not (Test-Path -LiteralPath $PidPath)) {
        return
    }

    $processId = [int]([System.IO.File]::ReadAllText($PidPath).Trim())
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        Write-Output "Verified owned $ExpectedName PID $processId is already absent."
        return $true
    }
    if ($process.Name -ne $ExpectedName) {
        throw "Refusing to stop PID ${processId}: expected $ExpectedName, found $($process.Name)."
    }
    foreach ($fragment in @($ExpectedCommandFragments)) {
        if ($fragment -and $process.CommandLine -notlike "*$fragment*") {
            throw "Refusing to stop PID ${processId}: command line does not belong to this Word acceptance request."
        }
    }

    Stop-Process -Id $processId -Force -ErrorAction Stop
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if ($null -eq $remaining) {
            Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped and verified owned $ExpectedName PID $processId."
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Owned $ExpectedName PID $processId is still running after cleanup."
}

function Stop-OwnedWordProcess($PidPath, $IdentityPath) {
    if (-not (Test-Path -LiteralPath $PidPath)) {
        return $true
    }

    $processId = [int]([System.IO.File]::ReadAllText($PidPath).Trim())
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        Write-Output "Verified owned WINWORD.EXE PID $processId is already absent."
        return $true
    }
    if (-not (Test-Path -LiteralPath $IdentityPath)) {
        throw "Refusing to stop live WINWORD.EXE PID $processId without a process identity receipt."
    }

    $identity = [System.IO.File]::ReadAllText($IdentityPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $actualStartTimeUtcTicks = [string]$process.StartTime.ToUniversalTime().Ticks
    $actualExecutablePath = [string]$process.Path
    if (
        [int]$identity.pid -ne $processId -or
        [string]$process.ProcessName -ine "WINWORD" -or
        [string]$identity.startTimeUtcTicks -cne $actualStartTimeUtcTicks -or
        [string]$identity.executablePath -ine $actualExecutablePath
    ) {
        throw "Refusing to stop WINWORD.EXE PID ${processId}: its identity does not match the Word acceptance receipt."
    }

    Stop-Process -Id $processId -Force -ErrorAction Stop
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped and verified owned WINWORD.EXE PID $processId."
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Owned WINWORD.EXE PID $processId is still running after cleanup."
}

function Get-WordPreservationMessage($PidPath) {
    if (-not (Test-Path -LiteralPath $PidPath)) {
        return $null
    }
    $processId = [int]([System.IO.File]::ReadAllText($PidPath).Trim())
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $null
    }
    Ensure-WindowInspectionMethods
    $titles = @([WordAcceptanceCleanup.WindowInspection]::GetVisibleTopLevelWindowTitles($processId))
    $unexpectedTitles = @($titles | Where-Object { $_ -and $_ -notlike "*input.docx*" -and $_ -notlike "*accepted.docx*" })
    if ($unexpectedTitles.Count -gt 0) {
        return "Refusing to stop owned WINWORD.EXE PID ${processId}: it has unexpected window(s): $($unexpectedTitles -join '; '). The user may have opened another document in this process."
    }
    return $null
}

function Restore-DefaultPrinter($StatePath) {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        return
    }
    if (-not ("WordAcceptanceCleanup.NativeMethods" -as [type])) {
        Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
namespace WordAcceptanceCleanup {
    public static class NativeMethods {
        [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetDefaultPrinter(string printerName);
    }
}
"@
    }
    $state = [System.IO.File]::ReadAllText($StatePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $originalPrinter = [string]$state.originalPrinter
    $windowsKey = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows"
    Set-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -Type DWord -Value 1
    $originalPrinterObject = Get-CimInstance Win32_Printer |
        Where-Object { $_.Name -eq $originalPrinter } |
        Select-Object -First 1
    if (-not $originalPrinterObject) {
        throw "The original Windows default printer is no longer installed: $originalPrinter"
    }

    [WordAcceptanceCleanup.NativeMethods]::SetDefaultPrinter($originalPrinter) | Out-Null
    $network = $null
    try {
        $network = New-Object -ComObject WScript.Network
        $network.SetDefaultPrinter($originalPrinter)
    } finally {
        if ($null -ne $network) {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($network) | Out-Null
        }
    }
    $result = Invoke-CimMethod -InputObject $originalPrinterObject -MethodName SetDefaultPrinter
    if ([int]$result.ReturnValue -ne 0) {
        throw "Win32_Printer.SetDefaultPrinter failed while restoring ${originalPrinter}: return value $($result.ReturnValue)."
    }
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $defaultPrinter = Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1
        if ([string]$defaultPrinter.Name -eq $originalPrinter) {
            if ([bool]$state.legacyDefaultPrinterModePresent) {
                Set-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -Type DWord -Value ([int]$state.originalLegacyDefaultPrinterMode)
            } else {
                Remove-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -ErrorAction SilentlyContinue
            }
            Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
            Write-Output "Restored and verified Windows default printer: $originalPrinter."
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Windows did not confirm restoration of the original default printer: $originalPrinter"
}

function Remove-OwnedStagingDirectory($StagingPathFile) {
    if (-not (Test-Path -LiteralPath $StagingPathFile)) {
        return
    }
    $stagingPath = [System.IO.File]::ReadAllText($StagingPathFile, [System.Text.Encoding]::UTF8).Trim()
    $tempPath = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\\')
    $fullStagingPath = [System.IO.Path]::GetFullPath($stagingPath)
    $parentPath = [System.IO.Path]::GetDirectoryName($fullStagingPath)
    $leafName = [System.IO.Path]::GetFileName($fullStagingPath)
    if (
        [string]::Compare($parentPath, $tempPath, $true) -ne 0 -or
        $leafName -notmatch '^sto-word-[0-9a-f]{8}$'
    ) {
        throw "Refusing to remove untrusted Word acceptance staging directory: $stagingPath"
    }

    $cleanupError = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            if (Test-Path -LiteralPath $fullStagingPath) {
                Remove-Item -LiteralPath $fullStagingPath -Recurse -Force -ErrorAction Stop
            }
            if (-not (Test-Path -LiteralPath $fullStagingPath)) {
                Remove-Item -LiteralPath $StagingPathFile -Force -ErrorAction SilentlyContinue
                Write-Output "Removed verified Word acceptance staging directory: $fullStagingPath"
                return
            }
        } catch {
            $cleanupError = $_
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Failed to remove verified Word acceptance staging directory after four attempts: $fullStagingPath. $cleanupError"
}

$request = [System.IO.File]::ReadAllText($RequestJson, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$requestDirectory = Split-Path -Parent $RequestJson
$wordIdentityPath = Join-Path $requestDirectory "word-process.json"
$stagingPathFile = Join-Path $requestDirectory "staging.path"
$wordPreservationMessage = Get-WordPreservationMessage $request.wordPidPath
if (-not $wordPreservationMessage) {
    Stop-OwnedWordProcess $request.wordPidPath $wordIdentityPath | Out-Null
}
Restore-DefaultPrinter $request.printerStatePath
Stop-OwnedProcess $request.runnerPidPath "powershell.exe" @("word_acceptance.ps1", $RequestJson) | Out-Null
if ($wordPreservationMessage) {
    throw $wordPreservationMessage
}
Remove-OwnedStagingDirectory $stagingPathFile
