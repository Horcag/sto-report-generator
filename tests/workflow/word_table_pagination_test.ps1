$ErrorActionPreference = 'Stop'
$script:WdActiveEndPageNumber = 3

$source = Join-Path $PSScriptRoot '../../scripts/word_acceptance.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $source), [ref]$tokens, [ref]$errors
)
if ($errors.Count -gt 0) { throw "Word acceptance script has parse errors." }

$names = @(
    'Get-TablePageSpan',
    'Get-TableCaptionParagraphBefore',
    'Get-TableCaptionBefore',
    'Get-TableCaptionNumber',
    'Get-TableSplitRowAtPageBoundary',
    'Add-TableContinuationCaption',
    'Move-FittingTablesToNextPage',
    'Split-LongCaptionedTables',
    'Assert-TableContinuationLayout'
)
foreach ($functionAst in $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in $names
}, $true)) {
    Invoke-Expression $functionAst.Extent.Text
}

function New-FakeDocument([bool]$FitsAfterBreak, [string]$Caption = '') {
    if (-not $Caption) {
        $Caption = [regex]::Unescape('\u0422\u0430\u0431\u043b\u0438\u0446\u0430 1')
    }
    $format = [pscustomobject]@{ PageBreakBefore = $false }
    $captionRange = [pscustomobject]@{
        Start = 0
        End = 20
        Text = $Caption
        ParagraphFormat = $format
        Tables = [pscustomobject]@{ Count = 0 }
    }
    $tableRange = [pscustomobject]@{ Start = 20; End = 40 }
    $document = [pscustomobject]@{
        Paragraphs = @([pscustomobject]@{ Range = $captionRange })
        ParagraphCollection = $null
        Tables = @([pscustomobject]@{ Range = $tableRange; Rows = [pscustomobject]@{ Count = 17 } })
        FitsAfterBreak = $FitsAfterBreak
        CaptionFormat = $format
        Repaginations = 0
    }
    $document | Add-Member ScriptMethod Repaginate {
        $this.Repaginations++
    }
    $document | Add-Member ScriptMethod Range {
        param($start, $end)
        if ($start -eq 19) {
            return [pscustomobject]@{ Paragraphs = $this.ParagraphCollection }
        }
        if ($start -eq 20) {
            $page = if ($this.CaptionFormat.PageBreakBefore) { 7 } else { 6 }
        } elseif ($this.CaptionFormat.PageBreakBefore) {
            $page = if ($this.FitsAfterBreak) { 7 } else { 8 }
        } else {
            $page = 7
        }
        $range = [pscustomobject]@{ Page = $page }
        $range | Add-Member ScriptMethod Information { param($kind) return $this.Page }
        return $range
    }
    $captionCollection = [pscustomobject]@{ Value = [pscustomobject]@{ Range = $captionRange } }
    $captionCollection | Add-Member ScriptMethod Item { param($index) return $this.Value }
    $document.ParagraphCollection = $captionCollection
    return $document
}

$fitting = New-FakeDocument $true
Move-FittingTablesToNextPage $fitting
if (-not $fitting.CaptionFormat.PageBreakBefore) {
    throw 'A measured one-page table with 17 rows was not moved.'
}
Assert-TableContinuationLayout $fitting

$long = New-FakeDocument $false
Move-FittingTablesToNextPage $long
if ($long.CaptionFormat.PageBreakBefore) {
    throw 'A multi-page table retained a speculative page break.'
}
try {
    Assert-TableContinuationLayout $long
    throw 'Unlabeled multi-page table was accepted.'
} catch {
    if ($_.Exception.Message -notmatch 'spans pages') { throw }
}

$otherCaption = [regex]::Unescape('\u0420\u0438\u0441\u0443\u043d\u043e\u043a 1')
$other = New-FakeDocument $true $otherCaption
Move-FittingTablesToNextPage $other
if ($other.CaptionFormat.PageBreakBefore) {
    throw 'A non-table caption was changed.'
}

$numberCaption = [pscustomobject]@{
    Range = [pscustomobject]@{ Text = [regex]::Unescape('\u0422\u0430\u0431\u043b\u0438\u0446\u0430 4 - \u041f\u043e\u043b\u044f') }
}
if ((Get-TableCaptionNumber $numberCaption) -ne '4') {
    throw 'The original table caption number was not retained for continuation labels.'
}

$overlapCaption = [pscustomobject]@{
    Range = [pscustomobject]@{
        Start = 98
        End = 101
        Text = [regex]::Unescape('\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 \u0442\u0430\u0431\u043B\u0438\u0446\u044B 4') + "`r"
        Tables = [pscustomobject]@{ Count = 0 }
    }
}
$insideTableParagraph = [pscustomobject]@{
    Range = [pscustomobject]@{
        Start = 99
        End = 100
        Text = 'cell contents'
        Tables = [pscustomobject]@{ Count = 1 }
    }
}
$captionLookupCollection = [pscustomobject]@{ Value = $overlapCaption }
$captionLookupCollection | Add-Member ScriptMethod Item { param($index) return $this.Value }
$captionLookupDocument = [pscustomobject]@{ ParagraphCollection = $captionLookupCollection }
$captionLookupDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    return [pscustomobject]@{ Paragraphs = $this.ParagraphCollection }
}
$captionLookupTable = [pscustomobject]@{ Range = [pscustomobject]@{ Start = 100 } }
if ((Get-TableCaptionBefore $captionLookupDocument $captionLookupTable) -ne $overlapCaption) {
    throw 'Caption lookup failed when the preceding paragraph range overlapped the table start.'
}
$insideTableCollection = [pscustomobject]@{ Value = $insideTableParagraph }
$insideTableCollection | Add-Member ScriptMethod Item { param($index) return $this.Value }
$insideTableDocument = [pscustomobject]@{ ParagraphCollection = $insideTableCollection }
$insideTableDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    return [pscustomobject]@{ Paragraphs = $this.ParagraphCollection }
}
if ($null -ne (Get-TableCaptionBefore $insideTableDocument $captionLookupTable)) {
    throw 'Caption lookup accepted a paragraph inside a table.'
}

$localizedCaptionStyle = [pscustomobject]@{ NameLocal = 'localized table caption' }
$paragraphRange = [pscustomobject]@{
    Start = 99
    End = 100
    Text = "`r"
    Style = $null
    Tables = [pscustomobject]@{ Count = 0 }
    ParagraphFormat = [pscustomobject]@{ Alignment = 1 }
}
$paragraphRange | Add-Member ScriptMethod InsertBefore {
    param($text)
    $this.Text = [string]$text + [string]$this.Text
}
$insertedParagraph = [pscustomobject]@{ Range = $paragraphRange }
$insertedParagraphCollection = [pscustomobject]@{ Value = $insertedParagraph }
$insertedParagraphCollection | Add-Member ScriptMethod Item {
    param($index)
    return $this.Value
}
$paragraphDocument = [pscustomobject]@{ ParagraphCollection = $insertedParagraphCollection }
$paragraphDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    return [pscustomobject]@{ Paragraphs = $this.ParagraphCollection }
}
$continuationTable = [pscustomobject]@{ Range = [pscustomobject]@{ Start = 100 } }
Add-TableContinuationCaption $paragraphDocument $continuationTable '4' $localizedCaptionStyle
$expectedContinuationCaption = [regex]::Unescape('\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 \u0442\u0430\u0431\u043B\u0438\u0446\u044B 4') + "`r"
if ($paragraphRange.Text -ne $expectedContinuationCaption -or
    $paragraphRange.Style -ne $localizedCaptionStyle -or
    $paragraphRange.ParagraphFormat.Alignment -ne 0) {
    throw 'The continuation caption did not inherit the source caption style and left alignment.'
}

$rowPages = @(5, 5, 6, 6, 7)
$fakeRows = @(
    for ($index = 0; $index -lt $rowPages.Count; $index++) {
        [pscustomobject]@{ Range = [pscustomobject]@{ Start = $index * 10; End = ($index * 10) + 8 } }
    }
)
$fakeRowsCollection = [pscustomobject]@{ Items = $fakeRows; Count = $fakeRows.Count }
$fakeRowsCollection | Add-Member ScriptMethod Item {
    param($index)
    return $this.Items[$index - 1]
}
$fakeTable = [pscustomobject]@{ Rows = $fakeRowsCollection }
$pageMap = @{}
for ($index = 0; $index -lt $rowPages.Count; $index++) {
    $pageMap[$index * 10] = $rowPages[$index]
}
$boundaryDocument = [pscustomobject]@{ PageMap = $pageMap }
$boundaryDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    $range = [pscustomobject]@{ Page = $this.PageMap[[int]$start] }
    $range | Add-Member ScriptMethod Information { param($kind) return $this.Page }
    return $range
}
if ((Get-TableSplitRowAtPageBoundary $boundaryDocument $fakeTable) -ne 3) {
    throw 'A long table was not split before the first row rendered on a new page.'
}

$singlePageRows = [pscustomobject]@{ Items = $fakeRows[0..2]; Count = 3 }
$singlePageRows | Add-Member ScriptMethod Item {
    param($index)
    return $this.Items[$index - 1]
}
$singlePageTable = [pscustomobject]@{ Rows = $singlePageRows }
$singlePageDocument = [pscustomobject]@{ PageMap = @{ 0 = 5; 10 = 5; 20 = 5 } }
$singlePageDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    $range = [pscustomobject]@{ Page = $this.PageMap[[int]$start] }
    $range | Add-Member ScriptMethod Information { param($kind) return $this.Page }
    return $range
}
if ((Get-TableSplitRowAtPageBoundary $singlePageDocument $singlePageTable) -ne 0) {
    throw 'A table with no rendered page boundary produced a speculative split.'
}

$markerDocument = [pscustomobject]@{ PageMap = @{ 100 = 4; 119 = 4; 120 = 5 } }
$markerDocument | Add-Member ScriptMethod Range {
    param($start, $end)
    $range = [pscustomobject]@{ Page = $this.PageMap[[int]$start] }
    $range | Add-Member ScriptMethod Information { param($kind) return $this.Page }
    return $range
}
$markerTable = [pscustomobject]@{ Range = [pscustomobject]@{ Start = 100; End = 121 } }
$markerSpan = @(Get-TablePageSpan $markerDocument $markerTable)
if ($markerSpan[0] -ne 4 -or $markerSpan[1] -ne 4) {
    throw 'The Word end-of-cell marker was counted as visible table content on the next page.'
}

Write-Output 'Word table pagination decision tests passed.'
