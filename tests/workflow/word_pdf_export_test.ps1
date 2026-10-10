$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path (Join-Path $root 'scripts/word_pdf_export.cs')
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class PdfExportReceiver {
    public int LegacyCalls;
    protected void Check(string output, int format, bool open, int optimize, int range,
        int from, int to, int item, bool properties, bool irm, int bookmarks,
        bool tags, bool bitmapFonts, bool pdfa, object extension) {
        if (format != 17 || open || optimize != 0 || range != 0 || from != 1 || to != 1 ||
            item != 0 || !properties || !irm || bookmarks != 1 || !tags ||
            !bitmapFonts || pdfa || extension != null)
            throw new InvalidOperationException("Unexpected PDF export options");
        File.WriteAllText(output, "typed dispatch passed");
    }
    public void ExportAsFixedFormat(string output, int format, bool open, int optimize, int range,
        int from, int to, int item, bool properties, bool irm, int bookmarks,
        bool tags, bool bitmapFonts, bool pdfa, object extension = null) {
        Check(output, format, open, optimize, range, from, to, item, properties, irm, bookmarks, tags, bitmapFonts, pdfa, extension);
        LegacyCalls++;
    }
}
public class HighQualityReceiver : PdfExportReceiver {
    public int HighQualityCalls;
    public int FailureCode;
    public bool FailExport;
    public void ExportAsFixedFormat2(string output, int format, bool open, int optimize, int range,
        int from, int to, int item, bool properties, bool irm, int bookmarks,
        bool tags, bool bitmapFonts, bool pdfa, bool quality, object extension = null) {
        HighQualityCalls++;
        if (FailureCode != 0) throw new COMException("Test dispatch failure", FailureCode);
        if (FailExport) throw new IOException("Export failed");
        if (!quality) throw new InvalidOperationException("Image-quality optimization must be true");
        Check(output, format, open, optimize, range, from, to, item, properties, irm, bookmarks, tags, bitmapFonts, pdfa, extension);
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
    $diagnostic = [WordAcceptance.PdfExporter]::Export($legacy, $output)
    if ($legacy.LegacyCalls -ne 1 -or $diagnostic.OptimizeForImageQuality -or
        $diagnostic.Method -ne 'ExportAsFixedFormat' -or $diagnostic.Warning -notmatch 'unverified') {
        throw 'Legacy fallback did not report unknown image quality.'
    }
    foreach ($code in @(-2147352573, -2147352570)) { # MEMBERNOTFOUND, UNKNOWNNAME
        $missing = New-Object HighQualityReceiver
        $missing.FailureCode = $code
        $diagnostic = [WordAcceptance.PdfExporter]::Export($missing, $output)
        if ($missing.LegacyCalls -ne 1 -or $diagnostic.OptimizeForImageQuality) {
            throw 'Unsupported COM method did not use the diagnosed legacy fallback.'
        }
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
    Write-Output 'Typed PDF dispatch test passed: 6 cases (high quality, legacy, two unsupported dispatch codes, two export failures; no Word process created).'
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
}
