$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path (Join-Path $root 'scripts/word_pdf_export.cs')
Add-Type -TypeDefinition @'
using System;
using System.IO;
public class PdfExportReceiver {
    public int Calls;
    public void ExportAsFixedFormat(
        string output, int format, bool open, int optimize, int range,
        int from, int to, int item, bool properties, bool irm, int bookmarks,
        bool tags, bool bitmapFonts, bool pdfa, object extension = null) {
        if (format != 17 || open || optimize != 0 || range != 0 || from != 1 || to != 1 ||
            item != 0 || !properties || !irm || bookmarks != 1 || !tags ||
            !bitmapFonts || pdfa || extension != null)
            throw new InvalidOperationException("Unexpected PDF export options");
        Calls++;
        File.WriteAllText(output, "typed dispatch passed");
    }
}
'@
$directory = Join-Path ([IO.Path]::GetTempPath()) ('sto-dispatch-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
try {
    # Join-Path produces a PowerShell-adapted value, as in the live launcher.
    $output = Join-Path $directory 'PDF export with spaces.txt'
    $receiver = New-Object PdfExportReceiver
    [WordAcceptance.PdfExporter]::Export($receiver, $output)
    if ($receiver.Calls -ne 1 -or [IO.File]::ReadAllText($output) -ne 'typed dispatch passed') {
        throw 'Typed PDF dispatch did not reach its receiver.'
    }
    Write-Output 'Typed PDF dispatch test passed (no Word process created).'
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
}
