$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '../../scripts/word_acceptance.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $source), [ref]$tokens, [ref]$errors
)
if ($errors.Count -gt 0) { throw 'Word acceptance script has parse errors.' }
$functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Copy-TableHeaderRow'
}, $true)
if ($null -eq $functionAst) { throw 'Copy-TableHeaderRow was not found.' }
Invoke-Expression $functionAst.Extent.Text

function New-Collection($Items) {
    $collection = [pscustomobject]@{ Items = @($Items); Count = @($Items).Count }
    $collection | Add-Member ScriptMethod Item {
        param($index)
        return $this.Items[$index - 1]
    }
    return $collection
}

function New-Paragraph($Alignment, $SpaceAfter, $LeftIndent) {
    $format = [pscustomobject]@{
        Alignment = $Alignment
        SpaceAfter = $SpaceAfter
        LeftIndent = $LeftIndent
    }
    $format | Add-Member ScriptProperty Duplicate {
        return [pscustomobject]@{
            Alignment = $this.Alignment
            SpaceAfter = $this.SpaceAfter
            LeftIndent = $this.LeftIndent
        }
    }
    return [pscustomobject]@{ Format = $format }
}

function New-Cell($Text, $Paragraphs) {
    $content = [pscustomobject]@{ End = 100; FormattedText = $Text }
    return [pscustomobject]@{
        Range = [pscustomobject]@{
            Duplicate = $content
            Paragraphs = (New-Collection $Paragraphs)
            Tables = [pscustomobject]@{ Count = 1 }
        }
    }
}

# Model the boundary after FormattedText copying: earlier paragraph marks carry
# formatting, but the last paragraph keeps the first data row's formatting.
$sourceCells = @(
    (New-Cell 'Single paragraph' @((New-Paragraph 1 6 2))),
    (New-Cell "First`rSecond`rLast" @(
        (New-Paragraph 1 3 0), (New-Paragraph 1 6 2), (New-Paragraph 1 9 4)
    ))
)
$targetCells = @(
    (New-Cell '' @((New-Paragraph 0 0 0))),
    (New-Cell '' @(
        (New-Paragraph 1 3 0), (New-Paragraph 1 6 2), (New-Paragraph 0 0 0)
    ))
)
$sourceHeader = [pscustomobject]@{ Cells = (New-Collection $sourceCells) }
$targetHeader = [pscustomobject]@{ Cells = (New-Collection $targetCells); HeadingFormat = 0 }
$sourceTable = [pscustomobject]@{ Rows = (New-Collection @($sourceHeader)) }
$dataRow = [pscustomobject]@{ Cells = (New-Collection @((New-Cell 'Data' @((New-Paragraph 0 0 0))))) }
$targetRows = New-Collection @($dataRow)
$targetRows | Add-Member NoteProperty AddedHeader $targetHeader
$targetRows | Add-Member NoteProperty BeforeRow $null
$targetRows | Add-Member ScriptMethod Add {
    param($before)
    $this.BeforeRow = $before
    return $this.AddedHeader
}

Copy-TableHeaderRow $sourceTable ([pscustomobject]@{ Rows = $targetRows })

for ($cellIndex = 0; $cellIndex -lt $sourceCells.Count; $cellIndex++) {
    $from = $sourceCells[$cellIndex].Range
    $to = $targetCells[$cellIndex].Range
    if ($to.Duplicate.FormattedText -ne $from.Duplicate.FormattedText) {
        throw "Header text was not copied in cell $cellIndex."
    }
    if ($from.Duplicate.End -ne 99 -or $to.Duplicate.End -ne 99) {
        throw 'Header copying included an end-of-cell mark.'
    }
    for ($index = 1; $index -le $from.Paragraphs.Count; $index++) {
        foreach ($property in @('Alignment', 'SpaceAfter', 'LeftIndent')) {
            if ($to.Paragraphs.Item($index).Format.$property -ne $from.Paragraphs.Item($index).Format.$property) {
                throw "Header cell $cellIndex paragraph $index lost $property."
            }
        }
    }
}
if ($targetHeader.HeadingFormat -ne -1 -or $targetRows.BeforeRow -ne $dataRow -or
    $dataRow.Cells.Item(1).Range.Paragraphs.Item(1).Format.Alignment -ne 0) {
    throw 'Header insertion changed the first data row or lost the repeated-header flag.'
}
Write-Output 'Word header copy tests passed: single and multi-paragraph formatting, text, cell boundaries, data row, repeat flag.'
