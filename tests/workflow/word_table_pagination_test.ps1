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
    'Get-TableCaptionBefore',
    'Move-FittingTablesToNextPage',
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
    }
    $tableRange = [pscustomobject]@{ Start = 20; End = 40 }
    $document = [pscustomobject]@{
        Paragraphs = @([pscustomobject]@{ Range = $captionRange })
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

Write-Output 'Word table pagination decision tests passed.'
