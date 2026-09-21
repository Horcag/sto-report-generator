param(
    [string]$StatusTextPath,
    [string]$VNextStatusTextPath
)

$ErrorActionPreference = "Stop"

function Find-OfficeScript {
    param([string]$Name)

    $candidates = @(
        (Join-Path $env:ProgramFiles "Microsoft Office\root\Office16\$Name"),
        (Join-Path $env:ProgramFiles "Microsoft Office\Office16\$Name")
    )
    if (${env:ProgramFiles(x86)}) {
        $candidates += @(
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Office\root\Office16\$Name"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Office\Office16\$Name")
        )
    }
    return $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Invoke-CapturedProcess {
    param(
        [string]$FileName,
        [string]$Arguments,
        [string]$Description
    )

    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = $FileName
    $processInfo.Arguments = $Arguments
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($processInfo)
    $outputText = $process.StandardOutput.ReadToEnd()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "$Description failed with exit code $($process.ExitCode): $errorText$outputText"
    }
    return $outputText
}

function Test-IsWordProductId {
    param([string]$ProductId)

    return $ProductId -match '(?i)(?:(?:O365|M365Apps)(?:ProPlus|Business)|Office\d*(?:ProPlus|Standard|Word)|(?:ProPlus|Standard|Word)\d*(?:Retail|Volume))'
}

function Convert-ToProductKey {
    param([string]$ProductId)

    return ($ProductId -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
}

function Get-VNextLicenseStatusText {
    if ($VNextStatusTextPath) {
        return [System.IO.File]::ReadAllText($VNextStatusTextPath)
    }
    if ($StatusTextPath) {
        return $null
    }

    $vnextdiag = Find-OfficeScript -Name "vnextdiag.ps1"
    if (-not $vnextdiag) {
        return $null
    }
    $powerShell = (Get-Process -Id $PID).Path
    return Invoke-CapturedProcess `
        -FileName $powerShell `
        -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$vnextdiag`" -action list" `
        -Description "Microsoft 365 Apps vNext license check"
}

function Test-VNextWordLicense {
    param([string]$StatusText)

    if (-not $StatusText) {
        return $false
    }

    $wordModes = @([regex]::Matches(
        $StatusText,
        '(?im)^\s*(?<product>\S+)\s*=\s*(?<mode>vNext|Device|Legacy)\s*$'
    ) | Where-Object { Test-IsWordProductId $_.Groups['product'].Value })

    $wordLicenses = @()
    foreach ($jsonMatch in [regex]::Matches($StatusText, '(?ms)\{\s*"Version"\s*:.*?\}')) {
        try {
            $license = $jsonMatch.Value | ConvertFrom-Json
            if (Test-IsWordProductId ([string]$license.Product)) {
                $wordLicenses += $license
            }
        } catch {
            throw "Microsoft 365 Apps vNext license output contains invalid JSON: $($_.Exception.Message)"
        }
    }

    $authoritativeModes = @($wordModes | Where-Object { $_.Groups['mode'].Value -in @('vNext', 'Device') })
    $authoritativeProductKeys = @($authoritativeModes | ForEach-Object {
        Convert-ToProductKey $_.Groups['product'].Value
    })
    $authoritativeLicenses = @($wordLicenses | Where-Object {
        $authoritativeProductKeys -contains (Convert-ToProductKey ([string]$_.Product))
    })

    if ($authoritativeLicenses | Where-Object { $_.LicenseState -eq 'Licensed' }) {
        Write-Host "Microsoft 365 Apps license: LICENSED (vNext/device)."
        return $true
    }

    if ($authoritativeModes.Count -gt 0) {
        $states = @($authoritativeLicenses | ForEach-Object { [string]$_.LicenseState } | Where-Object { $_ } | Select-Object -Unique)
        if ($states.Count -eq 0) {
            $states = @('no matching license')
        }
        throw "Microsoft Word acceptance requires an activated Microsoft 365 Apps license. Current vNext status: $($states -join ', ')."
    }

    return $false
}

function Get-LegacyOfficeLicenseStatusText {
    if ($StatusTextPath) {
        return [System.IO.File]::ReadAllText($StatusTextPath)
    }

    $ospp = Find-OfficeScript -Name "OSPP.VBS"
    if (-not $ospp) {
        throw "Neither a licensed vNext Microsoft 365 Apps product nor the legacy Office license checker OSPP.VBS was found."
    }

    return Invoke-CapturedProcess `
        -FileName (Join-Path $env:SystemRoot "System32\cscript.exe") `
        -Arguments "//Nologo `"$ospp`" /dstatus" `
        -Description "Legacy Microsoft Office license check"
}

$vnextStatusText = Get-VNextLicenseStatusText
if (Test-VNextWordLicense -StatusText $vnextStatusText) {
    return
}

$statusText = Get-LegacyOfficeLicenseStatusText
$productBlocks = [regex]::Split($statusText, '(?m)^-{20,}\s*$')
$wordLicenseBlocks = @($productBlocks |
    Where-Object {
        $licenseName = [regex]::Match($_, '(?im)^LICENSE NAME:\s*(.+)$').Groups[1].Value
        Test-IsWordProductId $licenseName
    } |
    Where-Object { $_ -match '(?im)^LICENSE STATUS:' })

if ($wordLicenseBlocks.Count -eq 0) {
    throw "A supported legacy Microsoft Office license that includes Word was not found in OSPP status."
}
if (-not ($wordLicenseBlocks | Where-Object { $_ -match '(?im)^LICENSE STATUS:\s*---LICENSED---\s*$' })) {
    $details = @($wordLicenseBlocks | ForEach-Object {
        $licenseStatus = [regex]::Match($_, '(?im)^LICENSE STATUS:\s*(.+)$').Groups[1].Value.Trim()
        $errorCode = [regex]::Match($_, '(?im)^ERROR CODE:\s*(.+)$').Groups[1].Value.Trim()
        @($licenseStatus, $errorCode) | Where-Object { $_ }
    }) | Select-Object -Unique
    throw "Microsoft Word acceptance requires an activated legacy Office license. Current status: $($details -join ', ')."
}

Write-Output "Legacy Microsoft Office license: LICENSED."
