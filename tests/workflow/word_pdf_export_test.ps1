$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path (Join-Path $root 'scripts/word_pdf_export.cs')
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class PdfExportReceiver {
    public int LegacyCalls;
    protected void Check(string OutputFileName, int ExportFormat, bool OpenAfterExport, int OptimizeFor, int Range,
        int From, int To, int Item, bool IncludeDocProps, bool KeepIRM, int CreateBookmarks,
        bool DocStructureTags, bool BitmapMissingFonts, bool UseISO19005_1, object FixedFormatExtClassPtr) {
        if (ExportFormat != 17 || OpenAfterExport || (OptimizeFor != 0 && OptimizeFor != 1) || Range != 0 || From != 1 || To != 1 ||
            Item != 0 || !IncludeDocProps || !KeepIRM || CreateBookmarks != 1 || !DocStructureTags ||
            !BitmapMissingFonts || UseISO19005_1 || FixedFormatExtClassPtr != null)
            throw new InvalidOperationException("Unexpected PDF export options");
        File.WriteAllText(OutputFileName, "typed dispatch passed");
    }
    public void ExportAsFixedFormat(string OutputFileName, int ExportFormat, bool OpenAfterExport, int OptimizeFor, int Range,
        int From, int To, int Item, bool IncludeDocProps, bool KeepIRM, int CreateBookmarks,
        bool DocStructureTags, bool BitmapMissingFonts, bool UseISO19005_1, object FixedFormatExtClassPtr = null) {
        Check(OutputFileName, ExportFormat, OpenAfterExport, OptimizeFor, Range, From, To, Item, IncludeDocProps, KeepIRM, CreateBookmarks, DocStructureTags, BitmapMissingFonts, UseISO19005_1, FixedFormatExtClassPtr);
        LegacyCalls++;
    }
}
public class HighQualityReceiver : PdfExportReceiver {
    public int HighQualityCalls;
    public int FailureCode;
    public bool FailExport;
    public void ExportAsFixedFormat2(string OutputFileName, int ExportFormat, bool OpenAfterExport, int OptimizeFor, int Range,
        int From, int To, int Item, bool IncludeDocProps, bool KeepIRM, int CreateBookmarks,
        bool DocStructureTags, bool BitmapMissingFonts, bool UseISO19005_1, object FixedFormatExtClassPtr = null, bool OptimizeForImageQuality = false) {
        HighQualityCalls++;
        if (FailureCode != 0) throw new COMException("Test dispatch failure", FailureCode);
        if (FailExport) throw new IOException("Export failed");
        if (!OptimizeForImageQuality) throw new InvalidOperationException("Image-OptimizeForImageQuality optimization must be true");
        Check(OutputFileName, ExportFormat, OpenAfterExport, OptimizeFor, Range, From, To, Item, IncludeDocProps, KeepIRM, CreateBookmarks, DocStructureTags, BitmapMissingFonts, UseISO19005_1, FixedFormatExtClassPtr);
    }
}
'@
$directory = Join-Path ([IO.Path]::GetTempPath()) ('sto-dispatch-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
try {
    $output = Join-Path $directory 'PDF export with spaces.txt'
    $receiver = New-Object HighQualityReceiver
    $diagnostic = [WordAcceptance.PdfExporter]::Export($receiver, $output)
    if ($receiver.HighQualityCalls -ne 1 -or $receiver.LegacyCalls -ne 0 -or
        -not $diagnostic.OptimizeForImageQuality -or $diagnostic.Method -ne 'ExportAsFixedFormat2' -or $diagnostic.Warning) {
        throw 'High-quality typed dispatch or diagnostic is incorrect.'
    }
    $legacy = New-Object PdfExportReceiver
    $failed = $false
    try { [WordAcceptance.PdfExporter]::Export($legacy, $output) | Out-Null } catch { $failed = $true }
    if (-not $failed -or $legacy.LegacyCalls -ne 0) { throw 'Original quality silently fell back.' }
    foreach ($mode in @('print', 'screen')) {
        $diagnostic = [WordAcceptance.PdfExporter]::Export($legacy, $output, $mode)
        if ($diagnostic.OptimizeForImageQuality -or -not $diagnostic.Warning) { throw 'Explicit reduced quality was not diagnosed.' }
    }
    if ($legacy.LegacyCalls -ne 2) { throw 'Explicit modes were not exported.' }
    foreach ($code in @(-2147352573, -2147352570)) {
        $missing = New-Object HighQualityReceiver
        $missing.FailureCode = $code
        $failed = $false
        try { [WordAcceptance.PdfExporter]::Export($missing, $output) | Out-Null } catch { $failed = $true }
        if (-not $failed -or $missing.LegacyCalls -ne 0) { throw 'Unavailable original quality silently fell back.' }
    }
    foreach ($code in @(0, -2147352562)) { # Actual export error, BADPARAMCOUNT
        $broken = New-Object HighQualityReceiver
        $broken.FailExport = $true
        $broken.FailureCode = $code
        $failed = $false
        try { [WordAcceptance.PdfExporter]::Export($broken, $output) | Out-Null } catch { $failed = $true }
        if (-not $failed -or $broken.LegacyCalls -ne 0) { throw 'An export error was silently downgraded.' }
    }
    if ([IO.File]::ReadAllText($output) -ne 'typed dispatch passed') { throw 'Typed export options changed.' }
    Write-Output 'Typed PDF dispatch test passed: 8 cases (named binding with reordered optional arguments, strict legacy failure, print/screen, two unsupported dispatch codes, two export failures; no Word process created).'
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
}
