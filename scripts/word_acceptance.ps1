param(
    [string]$RequestJson,
    [string]$HashOnlyPath,
    [switch]$ForceHashFallback
)

$ErrorActionPreference = "Stop"

$WdDoNotSaveChanges = 0
$WdFieldTOC = 13
$WdAlertsNone = 0
$WdAlertsAll = -1
$WdExportFormatPdf = 17
$WdActiveEndPageNumber = 3

function Read-Utf8Json($Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

function Write-Utf8Json($Path, $Value) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $temporaryPath = "$Path.tmp-$([System.Guid]::NewGuid().ToString('N'))"
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
            $utf8NoBom
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-Sha256($Path, [bool]$ForceFallback = $false) {
    if (-not $ForceFallback -and (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
        return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha.ComputeHash($stream)
        return (-join ($hashBytes | ForEach-Object { $_.ToString("x2") }))
    } finally {
        $stream.Close()
    }
}

if ($HashOnlyPath) {
    Write-Output (Get-Sha256 $HashOnlyPath $ForceHashFallback)
    exit 0
}
if (-not $RequestJson) {
    throw "RequestJson is required unless HashOnlyPath is used."
}

function Ensure-ParentDirectory($Path) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
}

function Test-FontInstalled($FontName) {
    Add-Type -AssemblyName System.Drawing
    $installedFonts = New-Object System.Drawing.Text.InstalledFontCollection
    return @(
        $installedFonts.Families | Where-Object { $_.Name -eq $FontName }
    ).Count -gt 0
}

function Ensure-NativeMethods {
    if (-not ("WordAcceptance.NativeMethods" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace WordAcceptance {
    public static class NativeMethods {
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetDefaultPrinter(string printerName);
    }
}
"@
    }
}

function Get-WordProcessId($WordApplication, $ProcessIdsBefore) {
    Ensure-NativeMethods

    $processId = [uint32]0
    $windowHandle = [IntPtr]([int64]$WordApplication.Hwnd)
    [WordAcceptance.NativeMethods]::GetWindowThreadProcessId($windowHandle, [ref]$processId) | Out-Null
    if ($processId -ne 0) {
        return [int]$processId
    }

    # Some Word builds do not expose Application.Hwnd until after a document
    # has opened. Fall back to the one process created by this COM activation;
    # pre-existing user Word processes are excluded from ownership.
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $newWordProcesses = @(
            Get-Process WINWORD -ErrorAction SilentlyContinue |
                Where-Object { $_.Id -notin $ProcessIdsBefore }
        )
        if ($newWordProcesses.Count -eq 1) {
            return [int]$newWordProcesses[0].Id
        }
        if ($newWordProcesses.Count -gt 1) {
            throw "Expected one Microsoft Word process from COM activation, found $($newWordProcesses.Count)."
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Microsoft Word did not expose an owned process ID."
}

function Get-LicenseDiagnostic {
    $diagnostic = [ordered]@{
        status = "warning"
        message = $null
    }
    try {
        $licenseOutput = (& (Join-Path $PSScriptRoot "check_word_license.ps1") 2>&1 | Out-String).Trim()
        $diagnostic.status = "verified"
        $diagnostic.message = $licenseOutput
        Write-Host "Word acceptance: Microsoft Office license diagnostic passed."
    } catch {
        $diagnostic.message = $_.Exception.Message
        Write-Warning "Office license diagnostic did not pass; capability verification will continue: $($diagnostic.message)"
    }
    return $diagnostic
}

function Assert-OutputFile($Path, $Kind) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Kind output was not created: $Path"
    }
    $item = Get-Item -LiteralPath $Path
    if ($item.Length -le 0) {
        throw "$Kind output is empty: $Path"
    }
    if ($Kind -eq "PDF") {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $signature = New-Object byte[] 5
            if ($stream.Read($signature, 0, 5) -ne 5 -or [System.Text.Encoding]::ASCII.GetString($signature) -ne "%PDF-") {
                throw "PDF output does not have a valid PDF signature: $Path"
            }
        } finally {
            $stream.Close()
        }
    }
}

function Get-DefaultPrinter {
    return Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1
}

function Get-DefaultPrinterManagementState {
    $windowsKey = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows"
    $property = Get-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -ErrorAction SilentlyContinue
    return [ordered]@{
        present = $null -ne $property
        value = if ($null -ne $property) { [int]$property.LegacyDefaultPrinterMode } else { $null }
    }
}

function Set-LegacyDefaultPrinterMode([int]$Value) {
    $windowsKey = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows"
    Set-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -Type DWord -Value $Value
}

function Test-DefaultPrinterSelected($PrinterName) {
    $defaultPrinter = Get-DefaultPrinter
    return [string]$defaultPrinter.Name -eq [string]$PrinterName
}

function Set-DefaultPrinterForAcceptance($Printer) {
    $printerName = [string]$Printer.Name
    if ([WordAcceptance.NativeMethods]::SetDefaultPrinter($printerName)) {
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            if (Test-DefaultPrinterSelected $printerName) { return $true }
            Start-Sleep -Milliseconds 100
        }
    }

    $network = $null
    try {
        $network = New-Object -ComObject WScript.Network
        $network.SetDefaultPrinter($printerName)
    } finally {
        if ($null -ne $network) {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($network) | Out-Null
        }
    }
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        if (Test-DefaultPrinterSelected $printerName) { return $true }
        Start-Sleep -Milliseconds 100
    }

    $result = Invoke-CimMethod -InputObject $Printer -MethodName SetDefaultPrinter
    if ([int]$result.ReturnValue -ne 0) {
        throw "Win32_Printer.SetDefaultPrinter failed for ${printerName}: return value $($result.ReturnValue)."
    }
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        if (Test-DefaultPrinterSelected $printerName) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

function Restore-DefaultPrinterManagementState($State) {
    $windowsKey = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows"
    if ([bool]$State.legacyDefaultPrinterModePresent) {
        Set-LegacyDefaultPrinterMode ([int]$State.originalLegacyDefaultPrinterMode)
    } else {
        Remove-ItemProperty -LiteralPath $windowsKey -Name "LegacyDefaultPrinterMode" -ErrorAction SilentlyContinue
    }
}

function Get-WordPrinterDiagnostic {
    $defaultPrinter = Get-DefaultPrinter
    $managementState = Get-DefaultPrinterManagementState
    $diagnostic = [ordered]@{
        systemDefault = if ($defaultPrinter) { [string]$defaultPrinter.Name } else { $null }
        systemDefaultPort = if ($defaultPrinter) { [string]$defaultPrinter.PortName } else { $null }
        windowsManagedDefault = $managementState.present -and $managementState.value -eq 0
        selectedForWord = if ($defaultPrinter) { [string]$defaultPrinter.Name } else { $null }
        temporarilyChangedSystemDefault = $false
        restoredSystemDefault = $true
    }
    return $diagnostic
}

function Restore-DefaultPrinter($StatePath) {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        return $false
    }
    Ensure-NativeMethods
    $state = Read-Utf8Json $StatePath
    $originalPrinter = [string]$state.originalPrinter
    Set-LegacyDefaultPrinterMode 1
    $originalPrinterObject = Get-CimInstance Win32_Printer |
        Where-Object { $_.Name -eq $originalPrinter } |
        Select-Object -First 1
    if (-not $originalPrinterObject) {
        throw "The original Windows default printer is no longer installed: $originalPrinter"
    }
    if (Set-DefaultPrinterForAcceptance $originalPrinterObject) {
        Restore-DefaultPrinterManagementState $state
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
        return $true
    }
    throw "Windows did not confirm restoration of the original default printer: $originalPrinter"
}

function Update-DocumentForAcceptance($Document) {
    Write-Output "Word acceptance stage: update-body-fields."
    foreach ($field in @($Document.Fields)) {
        # A table of contents is also present in Document.Fields. Updating it
        # here and again through TablesOfContents can leave Word's fixed-format
        # exporter spinning indefinitely, so update every TOC exactly once.
        if ([int]$field.Type -ne $WdFieldTOC) {
            $field.Update() | Out-Null
        }
    }
    Write-Output "Word acceptance stage: update-header-footer-fields."
    foreach ($section in @($Document.Sections)) {
        foreach ($header in @($section.Headers)) {
            foreach ($field in @($header.Range.Fields)) {
                $field.Update() | Out-Null
            }
        }
        foreach ($footer in @($section.Footers)) {
            foreach ($field in @($footer.Range.Fields)) {
                $field.Update() | Out-Null
            }
        }
    }
    Write-Output "Word acceptance stage: update-toc."
    foreach ($toc in @($Document.TablesOfContents)) {
        $toc.Update() | Out-Null
    }
    Write-Output "Word acceptance stage: repaginate-after-fields."
    $Document.Repaginate()
}

function Get-TablePageSpan($Document, $Table) {
    $start = [int]$Table.Range.Start
    # Word's final end-of-cell marker can be reported on the following page
    # even when all visible table content ends on the previous page.
    $end = [Math]::Max($start, [int]$Table.Range.End - 2)
    return @(
        [int]$Document.Range($start, $start).Information($WdActiveEndPageNumber),
        [int]$Document.Range($end, $end).Information($WdActiveEndPageNumber)
    )
}

function Get-TableCaptionParagraphBefore($Document, $Table) {
    $tableStart = [int]$Table.Range.Start
    if ($tableStart -le 0) { return $null }
    try {
        $previous = $Document.Range($tableStart - 1, $tableStart - 1).Paragraphs.Item(1)
    } catch {
        return $null
    }
    if ([int]$previous.Range.Tables.Count -gt 0) { return $null }
    return $previous
}

function Get-TableCaptionBefore($Document, $Table) {
    $previous = Get-TableCaptionParagraphBefore $Document $Table
    if ($null -eq $previous) { return $null }
    $caption = ([string]$previous.Range.Text).Trim()
    if ($caption -notmatch '^(?:\u0422\u0430\u0431\u043b\u0438\u0446\u0430|\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435\s+\u0442\u0430\u0431\u043b\u0438\u0446\u044b)\s+(?:[\u0410-\u042f]\.)?\d+(?:\.\d+)?(?:\s|$)') {
        return $null
    }
    return $previous
}

function Get-TableCaptionNumber($Caption) {
    $text = ([string]$Caption.Range.Text).Trim()
    if ($text -notmatch '^(?:\u0422\u0430\u0431\u043b\u0438\u0446\u0430|\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435\s+\u0442\u0430\u0431\u043b\u0438\u0446\u044b)\s+((?:[\u0410-\u042f]\.)?\d+(?:\.\d+)?)') {
        return $null
    }
    return $Matches[1]
}

function Get-TableSplitRowAtPageBoundary($Document, $Table) {
    if ([int]$Table.Rows.Count -lt 3) { return 0 }
    $previousPage = [int]$Document.Range(
        [int]$Table.Rows.Item(1).Range.Start,
        [int]$Table.Rows.Item(1).Range.Start
    ).Information($WdActiveEndPageNumber)
    for ($rowIndex = 2; $rowIndex -le [int]$Table.Rows.Count; $rowIndex++) {
        $row = $Table.Rows.Item($rowIndex)
        $rowStart = [int]$row.Range.Start
        $page = [int]$Document.Range($rowStart, $rowStart).Information($WdActiveEndPageNumber)
        if ($page -gt $previousPage) { return $rowIndex }
        $previousPage = $page
    }
    return 0
}

function Add-TableContinuationCaption($Document, $Table, [string]$Number, $CaptionStyle) {
    # Table.Split inserts the paragraph that separates the two table segments.
    # Reuse it so the label remains directly above the continuation table.
    $captionStart = [int]$Table.Range.Start - 1
    if ($captionStart -lt 0) { throw 'Word did not expose the inserted table continuation paragraph.' }
    $paragraph = $Document.Range($captionStart, $captionStart).Paragraphs.Item(1)
    $paragraphStart = [int]$paragraph.Range.Start
    $paragraphEnd = [int]$paragraph.Range.End
    if ([int]$paragraph.Range.Tables.Count -gt 0 -or
        $paragraphEnd -gt [int]$Table.Range.Start -or
        ([string]$paragraph.Range.Text).Trim().Length -gt 0) {
        throw "Word did not expose the empty separator paragraph before the continuation table (paragraph $paragraphStart-$paragraphEnd; table starts $([int]$Table.Range.Start); containing tables $([int]$paragraph.Range.Tables.Count))."
    }
    # Insert before the existing paragraph mark. Replacing the whole paragraph
    # text can remove Word's table separator and merge the two segments again.
    $continuationLabel = -join @(
        [char]0x041F, [char]0x0440, [char]0x043E, [char]0x0434,
        [char]0x043E, [char]0x043B, [char]0x0436, [char]0x0435,
        [char]0x043D, [char]0x0438, [char]0x0435, ' ',
        [char]0x0442, [char]0x0430, [char]0x0431, [char]0x043B,
        [char]0x0438, [char]0x0446, [char]0x044B, ' ', $Number
    )
    $paragraph.Range.InsertBefore($continuationLabel) | Out-Null
    $paragraph.Range.Style = $CaptionStyle
    $paragraph.Range.ParagraphFormat.Alignment = 0
}

function Copy-TableHeaderRow($SourceTable, $TargetTable) {
    $sourceHeader = $SourceTable.Rows.Item(1)
    $targetHeader = $TargetTable.Rows.Add($TargetTable.Rows.Item(1))
    if ([int]$sourceHeader.Cells.Count -ne [int]$targetHeader.Cells.Count) {
        throw 'Word changed the table column count while splitting a table.'
    }
    for ($cellIndex = 1; $cellIndex -le [int]$sourceHeader.Cells.Count; $cellIndex++) {
        $sourceCell = $sourceHeader.Cells.Item($cellIndex)
        $targetCell = $targetHeader.Cells.Item($cellIndex)
        $sourceParagraphCount = [int]$sourceCell.Range.Paragraphs.Count
        $sourceTableCount = [int]$sourceCell.Range.Tables.Count
        if ($sourceTableCount -gt 1) {
            throw "Cannot safely duplicate nested table in header cell $cellIndex (paragraphs=$sourceParagraphCount; tables=$sourceTableCount; text length=$(([string]$sourceCell.Range.Text).Length))."
        }
        # Copy the full cell contents to preserve intentional multi-paragraph
        # headers and formatting, while excluding Word's final end-of-cell mark
        # from the assignment so the target cell remains structurally intact.
        $sourceContent = $sourceCell.Range.Duplicate
        $sourceContent.End = [int]$sourceContent.End - 1
        $targetContent = $targetCell.Range.Duplicate
        $targetContent.End = [int]$targetContent.End - 1
        $targetContent.FormattedText = $sourceContent.FormattedText
    }
    $targetHeader.HeadingFormat = -1
}

function Split-LongCaptionedTables($Document) {
    $Document.Repaginate()
    $tableIndex = 1
    $splitCount = 0
    while ($tableIndex -le [int]$Document.Tables.Count) {
        $table = $Document.Tables.Item($tableIndex)
        $caption = Get-TableCaptionBefore $Document $table
        if ($null -eq $caption) {
            $tableIndex++
            continue
        }
        $pages = @(Get-TablePageSpan $Document $table)
        if ($pages[0] -eq $pages[1]) {
            $tableIndex++
            continue
        }

        $number = Get-TableCaptionNumber $caption
        if (-not $number) {
            throw "Could not determine the number for the continuation of table '$(([string]$caption.Range.Text).Trim())'."
        }
        $splitRow = Get-TableSplitRowAtPageBoundary $Document $table
        if ($splitRow -eq 2) {
            # A header-only first page is not a useful segment. Try moving the
            # original caption and table together before deciding whether Word
            # has a safe boundary after at least one body row.
            $captionFormat = $caption.Range.ParagraphFormat
            $originalBreak = $captionFormat.PageBreakBefore
            if (-not [bool]$originalBreak) {
                try {
                    $captionFormat.PageBreakBefore = $true
                    $Document.Repaginate()
                    $movedSplitRow = Get-TableSplitRowAtPageBoundary $Document $table
                    if ($movedSplitRow -ge 3) {
                        $splitRow = $movedSplitRow
                    }
                } finally {
                    if ($splitRow -lt 3) {
                        $captionFormat.PageBreakBefore = $originalBreak
                        $Document.Repaginate()
                    }
                }
            }
        }
        if ($splitRow -lt 3 -or $splitRow -gt [int]$table.Rows.Count) {
            $captionText = ([string]$caption.Range.Text).Trim()
            throw "Could not find a safe row boundary for captioned table '$captionText' spanning pages $($pages[0])-$($pages[1])."
        }

        $originalIndex = $tableIndex
        $originalRowCount = [int]$table.Rows.Count
        $originalTableCount = [int]$Document.Tables.Count
        $secondSegment = $table.Split($table.Rows.Item($splitRow))
        $Document.Repaginate()
        if ([int]$Document.Tables.Count -ne ($originalTableCount + 1)) {
            throw 'Word did not create a second table segment after SplitTable.'
        }
        $firstSegment = $Document.Tables.Item($originalIndex)
        if ([int]$secondSegment.Range.Start -le [int]$firstSegment.Range.Start) {
            throw 'Word returned an invalid table segment order after SplitTable.'
        }
        if ([int]$firstSegment.Rows.Count -ne ($splitRow - 1) -or
            [int]$secondSegment.Rows.Count -ne ($originalRowCount - $splitRow + 1)) {
            throw 'Word split the table at an unexpected row boundary; refusing to publish changed table content.'
        }
        Copy-TableHeaderRow $firstSegment $secondSegment
        $Document.Repaginate()
        $expectedSecondRows = $originalRowCount - $splitRow + 2
        if ([int]$Document.Tables.Count -ne ($originalTableCount + 1) -or
            [int]$firstSegment.Rows.Count -ne ($splitRow - 1) -or
            [int]$secondSegment.Rows.Count -ne $expectedSecondRows) {
            throw "Table $number changed structure while copying its header (tables=$([int]$Document.Tables.Count); first rows=$([int]$firstSegment.Rows.Count); continuation rows=$([int]$secondSegment.Rows.Count))."
        }
        Add-TableContinuationCaption $Document $secondSegment $number $caption.Range.Style
        $Document.Repaginate()
        if ([int]$Document.Tables.Count -ne ($originalTableCount + 1) -or
            [int]$firstSegment.Rows.Count -ne ($splitRow - 1) -or
            [int]$secondSegment.Rows.Count -ne $expectedSecondRows) {
            throw "Table $number changed structure while adding its continuation caption (tables=$([int]$Document.Tables.Count); first rows=$([int]$firstSegment.Rows.Count); continuation rows=$([int]$secondSegment.Rows.Count))."
        }
        $continuationCaption = Get-TableCaptionBefore $Document $secondSegment
        if ($null -eq $continuationCaption) {
            $candidate = Get-TableCaptionParagraphBefore $Document $secondSegment
            if ($null -eq $candidate) {
                throw "Could not resolve the paragraph before continuation table $number (table start=$([int]$secondSegment.Range.Start))."
            }
            $candidateText = ([string]$candidate.Range.Text).Replace("`r", '<CR>').Replace("`n", '<LF>')
            throw "Continuation caption before table $number has unexpected text '$candidateText' (paragraph $([int]$candidate.Range.Start)-$([int]$candidate.Range.End))."
        }
        $firstSegment.Borders.Item(-3).LineStyle = 0
        $firstPages = @(Get-TablePageSpan $Document $firstSegment)
        if ($firstPages[0] -ne $firstPages[1]) {
            $lastRow = $firstSegment.Rows.Item([int]$firstSegment.Rows.Count)
            $lastCell = $lastRow.Cells.Item([int]$lastRow.Cells.Count)
            $lastTextEnd = [Math]::Max(
                [int]$lastCell.Range.Start,
                [int]$lastCell.Range.End - 2
            )
            $lastTextPage = [int]$Document.Range($lastTextEnd, $lastTextEnd).Information($WdActiveEndPageNumber)
            $tableMarkerPage = [int]$Document.Range(
                [int]$firstSegment.Range.End - 1,
                [int]$firstSegment.Range.End - 1
            ).Information($WdActiveEndPageNumber)
            throw "First segment of table $number still spans visible pages $($firstPages[0])-$($firstPages[1]) after splitting at row $splitRow (last row text page $lastTextPage; end marker page $tableMarkerPage)."
        }
        $splitCount++
        if ($splitCount -gt 100) {
            throw 'Stopped after 100 table splits; Word pagination did not converge.'
        }
        # Revisit the continuation segment: its new caption and repeated header
        # can move later rows and therefore change the next measured boundary.
        $tableIndex = $originalIndex + 1
    }
    return $splitCount
}

function Move-FittingTablesToNextPage($Document) {
    foreach ($table in @($Document.Tables)) {
        $caption = Get-TableCaptionBefore $Document $table
        if ($null -eq $caption) { continue }
        $pages = @(Get-TablePageSpan $Document $table)
        if ($pages[0] -eq $pages[1]) { continue }
        # A table already covering an entire intermediate page cannot fit on
        # one page after moving its caption. Avoid two futile repaginations;
        # the later split stage handles its page boundaries.
        if ($pages[1] - $pages[0] -ge 2) { continue }

        $format = $caption.Range.ParagraphFormat
        $originalBreak = $format.PageBreakBefore
        if ([bool]$originalBreak) { continue }

        $fits = $false
        try {
            $format.PageBreakBefore = $true
            $Document.Repaginate()
            $movedPages = @(Get-TablePageSpan $Document $table)
            $fits = $movedPages[0] -eq $movedPages[1]
        } finally {
            if (-not $fits) {
                $format.PageBreakBefore = $originalBreak
                $Document.Repaginate()
            }
        }
    }
}

function Assert-TableContinuationLayout($Document) {
    $Document.Repaginate()
    foreach ($table in @($Document.Tables)) {
        $caption = Get-TableCaptionBefore $Document $table
        if ($null -eq $caption) { continue }
        $pages = @(Get-TablePageSpan $Document $table)
        if ($pages[0] -ne $pages[1]) {
            $captionText = ([string]$caption.Range.Text).Trim()
            throw "Table '$captionText' spans pages $($pages[0])-$($pages[1]). Split it into page-sized segments and add a numbered continuation caption above each later part."
        }
    }
}

function Get-SavedDocumentPageCount($Document) {
    # Repaginate has already refreshed Word's layout. Reading the built-in
    # window Pages collection validates the rendered result without invoking a second
    # synchronous ComputeStatistics pagination pass, which can hang on an
    # otherwise healthy desktop Word instance.
    $pageCount = [int]$Document.ActiveWindow.Panes(1).Pages.Count
    if ($pageCount -le 0) {
        throw "Microsoft Word reported an invalid saved page count: $pageCount"
    }
    return $pageCount
}

function Replace-DocumentLiteral($Document, $OldText, $NewText) {
    $range = $Document.Content
    $range.Find.ClearFormatting()
    $range.Find.Replacement.ClearFormatting()
    $range.Find.Execute($OldText, $false, $false, $false, $false, $false, $true, 1, $false, $NewText, 2) | Out-Null
}

function Get-PageWord($Pages, $Forms) {
    $lastTwo = [int]$Pages % 100
    $lastDigit = [int]$Pages % 10
    if ($lastTwo -gt 10 -and $lastTwo -lt 20) { return [string]$Forms[2] }
    if ($lastDigit -eq 1) { return [string]$Forms[0] }
    if ($lastDigit -gt 1 -and $lastDigit -lt 5) { return [string]$Forms[1] }
    return [string]$Forms[2]
}

function Set-ReferatStatistics($Document, $Request) {
    foreach ($property in $Request.statisticReplacements.PSObject.Properties) {
        Replace-DocumentLiteral $Document ([string]$property.Name) ([string]$property.Value)
    }
    $pageParagraphs = @()
    foreach ($paragraph in @($Document.Paragraphs)) {
        $template = [string]$paragraph.Range.Text
        if ($template.Contains('{{PAGES}}') -or $template.Contains('{{PAGES_WORD}}')) {
            $pageParagraphs += [pscustomobject]@{
                Paragraph = $paragraph
                Template = $template.TrimEnd([char[]]@([char]13, [char]7))
            }
        }
    }
    if ($pageParagraphs.Count -gt 0) {
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            $Document.Repaginate()
            $pages = Get-SavedDocumentPageCount $Document
            foreach ($entry in $pageParagraphs) {
                $text = $entry.Template
                foreach ($property in $Request.statisticReplacements.PSObject.Properties) {
                    $text = $text.Replace([string]$property.Name, [string]$property.Value)
                }
                $text = $text.Replace('{{PAGES}}', [string]$pages)
                $text = $text.Replace('{{PAGES_WORD}}', (Get-PageWord $pages $Request.pageWordForms))
                $text = $text.Replace(' ,', '').Replace(', ,', ',')
                $range = $entry.Paragraph.Range
                $range.End = [Math]::Max($range.Start, $range.End - 1)
                $range.Text = $text
            }
            $Document.Repaginate()
            if ((Get-SavedDocumentPageCount $Document) -eq $pages) { break }
            if ($attempt -eq 4) { throw 'Referat page count did not stabilize.' }
        }
    }
    if ($Document.Content.Text -match '\{\{(?:PAGES|PAGES_WORD|FIGURES|TABLES|SOURCES|APPENDICES)\}\}') {
        throw 'Referat statistic placeholders remain after Word replacement.'
    }
}

function Test-StyleExists($Document, $DisplayName) {
    try {
        $style = $Document.Styles.Item([string]$DisplayName)
        if ($style -ne $null) {
            return $true
        }
    } catch {
        # Fall through to the built-in heading lookup below.
    }

    # Word localizes built-in heading names in the COM model even when OOXML
    # stores the canonical DOTM name (for example, "heading 5"). Resolve that
    # case through WdBuiltinStyle: Heading 1 is -2, Heading 9 is -10.
    if ($DisplayName -match '^heading ([1-9])$') {
        $headingLevel = [int]$Matches[1]
        $builtInStyleId = -($headingLevel + 1)
        try {
            $builtInStyle = $Document.Styles.Item($builtInStyleId)
            return $builtInStyle -ne $null -and [bool]$builtInStyle.BuiltIn
        } catch {
            return $false
        }
    }

    return $false
}

function Get-StyleChecks($Document, $ExpectedStyles) {
    $checks = @()
    foreach ($expected in @($ExpectedStyles)) {
        $exists = Test-StyleExists $Document $expected.displayName
        $checks += [ordered]@{
            styleId = $expected.styleId
            displayName = $expected.displayName
            exists = $exists
        }
    }
    return $checks
}

$request = Read-Utf8Json $RequestJson
if ($request.schemaVersion -ne 1) {
    throw "Unsupported request schemaVersion."
}
if (-not (Test-Path -LiteralPath $request.inputDocx)) {
    throw "Input DOCX not found: $($request.inputDocx)"
}
if ([System.IO.Path]::GetFullPath($request.inputDocx) -eq [System.IO.Path]::GetFullPath($request.acceptedDocx)) {
    throw "Accepted DOCX path must be different from input DOCX."
}
if ($request.interactionMode -notin @("background", "interactive")) {
    throw "Unsupported Word interactionMode: $($request.interactionMode)"
}

[System.IO.File]::WriteAllText($request.runnerPidPath, [string]$PID)

Ensure-ParentDirectory $request.acceptedDocx
Ensure-ParentDirectory $request.pdf
Ensure-ParentDirectory $request.manifest
foreach ($previousOutput in @($request.acceptedDocx, $request.pdf, $request.manifest)) {
    if (Test-Path -LiteralPath $previousOutput) {
        Remove-Item -LiteralPath $previousOutput -Force
    }
}

$stagingDirectory = $null
$stagedInputDocx = $null
$stagedAcceptedDocx = $null
$stagedPdf = $null
$word = $null
$document = $null
$reopened = $null
$operationError = $null
$shutdownErrors = @()
$licenseDiagnostic = $null
$printerDiagnostic = $null
$runnerProcess = Get-Process -Id $PID
$wordProcess = $null
$ownsWordProcess = $false
try {
    $stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sto-word-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    $stagedInputDocx = Join-Path $stagingDirectory "input.docx"
    $stagedAcceptedDocx = Join-Path $stagingDirectory "accepted.docx"
    $stagedPdf = Join-Path $stagingDirectory "accepted.pdf"
    [System.IO.File]::WriteAllText((Join-Path (Split-Path -Parent $request.runnerPidPath) "staging.path"), $stagingDirectory)
    New-Item -ItemType Directory -Force -Path $stagingDirectory | Out-Null
    Copy-Item -LiteralPath $request.inputDocx -Destination $stagedInputDocx
    Write-Output "Word acceptance: staged input in a short local path."

    $licenseDiagnostic = Get-LicenseDiagnostic

    $printerDiagnostic = Get-WordPrinterDiagnostic
    if ($printerDiagnostic.selectedForWord) {
        Write-Output "Word acceptance: using the user's current default printer for layout: $($printerDiagnostic.selectedForWord)."
    }

    $wordProcessIdsBefore = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $stageClock = [System.Diagnostics.Stopwatch]::StartNew()
    $word = New-Object -ComObject Word.Application
    $ownedWordPid = Get-WordProcessId $word $wordProcessIdsBefore
    if ($ownedWordPid -in $wordProcessIdsBefore) {
        throw "Microsoft Word COM reused a pre-existing Word process (PID $ownedWordPid); refusing to automate or close it."
    }
    $ownsWordProcess = $true
    $wordProcess = Get-Process -Id $ownedWordPid -ErrorAction Stop
    if ($wordProcess.ProcessName -ne "WINWORD") {
        throw "Owned process $ownedWordPid is not Microsoft Word."
    }
    if ($wordProcess.SessionId -ne $runnerProcess.SessionId -or -not [Environment]::UserInteractive) {
        throw "Word acceptance requires the current interactive Windows user session. Runner session: $($runnerProcess.SessionId); Word session: $($wordProcess.SessionId)."
    }
    [System.IO.File]::WriteAllText($request.wordPidPath, [string]$ownedWordPid)
    Write-Utf8Json (Join-Path (Split-Path -Parent $request.runnerPidPath) "word-process.json") ([ordered]@{
        pid = $ownedWordPid
        startTimeUtcTicks = $wordProcess.StartTime.ToUniversalTime().Ticks.ToString()
        executablePath = $wordProcess.Path
    })
    $word.Visible = $request.interactionMode -eq "interactive"
    if ($request.interactionMode -eq "interactive") {
        $word.DisplayAlerts = $WdAlertsAll
    } else {
        $word.DisplayAlerts = $WdAlertsNone
    }

    Write-Output "Word acceptance: Microsoft Word started in $($request.interactionMode) mode in Windows session $($wordProcess.SessionId)."

    if (-not (Test-FontInstalled $request.requiredFont)) {
        throw "Required font is not installed: $($request.requiredFont)"
    }
    Write-Output "Word acceptance: required font is installed."

    # Word retains legacy path-length constraints even when the host and Git
    # support long paths. Work from a short local staging directory, then copy
    # the accepted artifacts to the caller's requested destinations.
    $document = $word.Documents.Open($stagedInputDocx, $false, $false)
    Write-Output "Word acceptance: staged DOCX opened."
    Write-Output "Word acceptance duration: startup-and-open ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Update-DocumentForAcceptance $document
    Write-Output "Word acceptance duration: update-fields ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Write-Output "Word acceptance stage: fit-tables."
    Move-FittingTablesToNextPage $document
    Write-Output "Word acceptance duration: fit-tables ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Write-Output "Word acceptance stage: set-referat-statistics."
    Set-ReferatStatistics $document $request
    Write-Output "Word acceptance duration: set-referat-statistics ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Write-Output "Word acceptance stage: split-long-tables."
    $splitTables = Split-LongCaptionedTables $document
    Write-Output "Word acceptance: $splitTables long table segment(s) created."
    Write-Output "Word acceptance duration: split-long-tables ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Assert-TableContinuationLayout $document
    Write-Output "Word acceptance duration: verify-table-layout ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Write-Output "Word acceptance: fields, TOC, and pagination updated."
    $document.Save()
    $pageCountBeforeReopen = Get-SavedDocumentPageCount $document
    Write-Output "Word acceptance: DOCX saved with $pageCountBeforeReopen pages."
    Copy-Item -LiteralPath $stagedInputDocx -Destination $stagedAcceptedDocx
    Copy-Item -LiteralPath $stagedAcceptedDocx -Destination $request.acceptedDocx
    Assert-OutputFile $request.acceptedDocx "DOCX"
    Write-Output "Word acceptance: accepted DOCX copied before PDF export."
    $document.Close($WdDoNotSaveChanges)
    $document = $null

    # Export from a fresh Word document object. Updating fields and the TOC
    # leaves a large undo/layout transaction on the original object; desktop
    # Word's successful UI path reopens the saved file before publishing.
    $document = $word.Documents.Open($stagedAcceptedDocx, $false, $false)
    $pageCountAfterReopen = Get-SavedDocumentPageCount $document
    if ($document.Content.Text -match '\{\{(?:PAGES|PAGES_WORD|FIGURES|TABLES|SOURCES|APPENDICES)\}\}') {
        throw 'Accepted DOCX still contains referat statistic placeholders.'
    }
    Write-Output "Word acceptance: saved DOCX reopened with $pageCountAfterReopen pages before PDF export."
    # Pass real CLR values rather than PowerShell-adapted COM arguments.
    Add-Type -Path (Join-Path $PSScriptRoot "word_pdf_export.cs")
    Write-Output "Word acceptance duration: save-and-reopen ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Write-Output "Word acceptance stage: export-pdf."
    [WordAcceptance.PdfExporter]::Export($document, [string]$stagedPdf)
    Write-Output "Word acceptance: PDF exported."
    Write-Output "Word acceptance duration: export-pdf ms=$($stageClock.ElapsedMilliseconds)."
    $stageClock.Restart()
    Copy-Item -LiteralPath $stagedPdf -Destination $request.pdf
    Assert-OutputFile $request.pdf "PDF"
    Write-Output "Word acceptance: PDF copied before layout validation."

    # Keep a native Word preview available when a deterministic layout rule
    # rejects the document. The launcher records status=failed in that case.
    Write-Output "Word acceptance stage: verify-table-layout."
    Assert-TableContinuationLayout $document

    # Querying Word styles creates additional COM proxies. Keep those lookups
    # after fixed-format export so they cannot interfere with Word's PDF path.
    Write-Output "Word acceptance stage: verify-styles."
    $styleChecks = Get-StyleChecks $document $request.expectedStyles
    $missingStyles = @($styleChecks | Where-Object { -not $_.exists })
    if ($missingStyles.Count -gt 0) {
        $missingNames = ($missingStyles | ForEach-Object { $_.displayName }) -join ", "
        throw "Required Word styles are missing: $missingNames"
    }
    Write-Output "Word acceptance: required styles verified."

    $document.Close($WdDoNotSaveChanges)
    $document = $null

    Assert-OutputFile $request.acceptedDocx "DOCX"
    Assert-OutputFile $request.pdf "PDF"
    Write-Output "Word acceptance: accepted artifacts copied to requested paths."

    $stable = $pageCountBeforeReopen -eq $pageCountAfterReopen
    if ($printerDiagnostic.temporarilyChangedSystemDefault) {
        $printerDiagnostic.restoredSystemDefault = Restore-DefaultPrinter $request.printerStatePath
        Write-Output "Word acceptance: original Windows default printer restored."
    }
    $wordBuild = $null
    try {
        $wordBuild = [string]$word.Build
    } catch {
        $wordBuild = $null
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        status = "pendingCleanup"
        renderer = "word-desktop-interactive"
        execution = [ordered]@{
            requestedMode = "auto"
            completedMode = $request.interactionMode
            attemptedModes = @($request.attemptedModes)
            windowsSessionId = [int]$wordProcess.SessionId
            userInteractive = [bool]([Environment]::UserInteractive)
        }
        capabilityChecks = [ordered]@{
            openedDocx = $true
            updatedFieldsAndToc = $true
            repaginated = $true
            savedAcceptedDocx = $true
            exportedPdf = $true
            reopenedAcceptedDocx = $true
            stablePageCount = $stable
        }
        officeLicenseDiagnostic = $licenseDiagnostic
        printer = $printerDiagnostic
        word = [ordered]@{
            version = [string]$word.Version
            build = $wordBuild
        }
        inputDocx = [ordered]@{
            path = $request.inputDocx
            sha256 = Get-Sha256 $request.inputDocx
        }
        acceptedDocx = [ordered]@{
            path = $request.acceptedDocx
            sha256 = Get-Sha256 $request.acceptedDocx
        }
        pdf = [ordered]@{
            path = $request.pdf
            sha256 = Get-Sha256 $request.pdf
            validSignature = $true
        }
        pageCountBeforeReopen = $pageCountBeforeReopen
        pageCountAfterReopen = $pageCountAfterReopen
        stablePageCount = $stable
        referatStatistics = [ordered]@{
            pages = $pageCountAfterReopen
            figures = [int]$request.statisticCounts.figures
            tables = [int]$request.statisticCounts.tables
            sources = [int]$request.statisticCounts.sources
            appendices = [int]$request.statisticCounts.appendices
            placeholdersCleared = $true
        }
        requiredFont = [ordered]@{
            name = $request.requiredFont
            installed = $true
        }
        stylePreset = $request.stylePreset
        styleChecks = $styleChecks
    }
    if (-not $stable) {
        throw "Word page count changed after reopening accepted DOCX."
    }
    Write-Utf8Json $request.manifest $manifest

} catch {
    $operationError = $_
} finally {
    if ($reopened -ne $null) {
        try {
            $reopened.Close($WdDoNotSaveChanges)
        } catch {
            $shutdownErrors += "Failed to close the reopened Word document: $($_.Exception.Message)"
        }
    }
    if ($document -ne $null) {
        try {
            $document.Close($WdDoNotSaveChanges)
        } catch {
            $shutdownErrors += "Failed to close the primary Word document: $($_.Exception.Message)"
        }
    }
    if ($word -ne $null) {
        if ($ownsWordProcess) {
            try {
                $word.Quit()
            } catch {
                $shutdownErrors += "Failed to quit Microsoft Word: $($_.Exception.Message)"
            }
        }
        try {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
        } catch {
            $shutdownErrors += "Failed to release the Microsoft Word COM reference: $($_.Exception.Message)"
        }
    }
    if (Test-Path -LiteralPath $request.printerStatePath) {
        try {
            Restore-DefaultPrinter $request.printerStatePath | Out-Null
        } catch {
            $shutdownErrors += "Failed to restore the original Windows default printer: $($_.Exception.Message)"
        }
    }
    # The launcher verifies process exit before removing staging or PID receipts.

}

$secondaryErrors = @($shutdownErrors)
if ($operationError) {
    $message = "Word acceptance failed: $($operationError.Exception.Message)"
    if ($operationError.ScriptStackTrace) {
        $message += [Environment]::NewLine + $operationError.ScriptStackTrace
    }
    if ($secondaryErrors.Count -gt 0) {
        $message += [Environment]::NewLine + ($secondaryErrors -join [Environment]::NewLine)
    }
    throw $message
}
if ($secondaryErrors.Count -gt 0) {
    throw ($secondaryErrors -join [Environment]::NewLine)
}

Write-Output "Word acceptance complete: $($request.manifest)"
