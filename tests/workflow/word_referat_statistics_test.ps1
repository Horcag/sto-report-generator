$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../scripts/word_acceptance.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $source), [ref]$tokens, [ref]$errors
)
if ($errors.Count -gt 0) { throw 'Word acceptance script has parse errors.' }
$names = @('Get-SavedDocumentPageCount', 'Get-PageWord', 'Set-ReferatStatistics', 'Assert-ReferatPageStatistics')
foreach ($functionAst in $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
}, $true)) {
    Invoke-Expression $functionAst.Extent.Text
}

function Replace-DocumentLiteral($Document, $OldText, $NewText) {
    $Document.Paragraphs[0].Range.Text = $Document.Paragraphs[0].Range.Text.Replace($OldText, $NewText)
}
function New-StatisticsDocument([int]$Pages, [string]$Text = 'Pages: {{PAGES}} {{PAGES_WORD}}, {{FIGURES}}') {
    $paragraph = [pscustomobject]@{ Range = [pscustomobject]@{ Start = 0; End = 80; Text = $Text + "`r" } }
    $content = [pscustomobject]@{ Paragraph = $paragraph }
    $content | Add-Member ScriptProperty Text { return $this.Paragraph.Range.Text }
    $window = [pscustomobject]@{ PageCollection = [pscustomobject]@{ Count = $Pages } }
    $window | Add-Member ScriptMethod Panes {
        param($index)
        return [pscustomobject]@{ Pages = $this.PageCollection }
    }
    $document = [pscustomobject]@{
        Paragraphs = @($paragraph)
        Content = $content
        ActiveWindow = $window
        Repaginations = 0
        ChangedPages = $null
        Unstable = $false
    }
    $document | Add-Member ScriptMethod Repaginate {
        $this.Repaginations++
        if ($this.Unstable) { $this.ActiveWindow.PageCollection.Count++ }
        elseif ($null -ne $this.ChangedPages -and -not $this.Content.Text.Contains('{{PAGES}}')) {
            $this.ActiveWindow.PageCollection.Count = $this.ChangedPages
        }
    }
    return $document
}
function Assert-Fails($Action, $Pattern) {
    $failed = $false
    try { & $Action | Out-Null } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        $failed = $true
    }
    if (-not $failed) { throw "Expected failure: $Pattern" }
}
$request = [pscustomobject]@{
    statisticReplacements = [pscustomobject]@{ '{{FIGURES}}' = '20 figures' }
    pageWordForms = @('one', 'few', 'many')
}

# Simulate the final layout adding a page after the earlier count of 123.
$early = New-StatisticsDocument 123
$earlyStatistics = Set-ReferatStatistics $early $request
$early.ActiveWindow.PageCollection.Count = 124
if ($early.Content.Text.Trim() -ne 'Pages: 123 few, 20 figures') { throw 'Old-order reproduction failed.' }
Assert-Fails { Assert-ReferatPageStatistics $early $earlyStatistics 124 } 'differs from final Word page count'
$final = New-StatisticsDocument 123
$final.ActiveWindow.PageCollection.Count = 124
$statistics = Set-ReferatStatistics $final $request
if ($statistics.pages -ne 124 -or $final.Content.Text.Trim() -ne 'Pages: 124 few, 20 figures' -or
    -not (Assert-ReferatPageStatistics $final $statistics 124)) {
    throw 'Post-layout referat count is stale.'
}
Write-Output 'PASS post-layout-124'

$changing = New-StatisticsDocument 123
$changing.ChangedPages = 124
$changedStatistics = Set-ReferatStatistics $changing $request
if ($changedStatistics.pages -ne 124 -or $changing.Repaginations -lt 4 -or
    -not (Assert-ReferatPageStatistics $changing $changedStatistics 124)) {
    throw 'Replacement-driven pagination did not stabilize.'
}
Write-Output 'PASS replacement-stabilization'

Assert-Fails { Assert-ReferatPageStatistics $final $statistics 125 } 'differs from final Word page count'
Write-Output 'PASS changed-page-count-rejected'
$final.Paragraphs[0].Range.Text = 'Pages: 123 few, 20 figures'
Assert-Fails { Assert-ReferatPageStatistics $final $statistics 124 } 'statistic text changed'
Write-Output 'PASS changed-saved-text-rejected'

$plain = New-StatisticsDocument 124 'Unmanaged prose: 123 pages'
$plainStatistics = Set-ReferatStatistics $plain $request
if ($null -ne $plainStatistics.pages -or $plainStatistics.texts.Count -ne 0 -or
    (Assert-ReferatPageStatistics $plain $plainStatistics 124)) {
    throw 'Unmanaged page prose was falsely marked verified.'
}
Write-Output 'PASS unmanaged-text-unknown'

$wordOnly = New-StatisticsDocument 124 'Unmanaged count: 123 {{PAGES_WORD}}'
$wordOnlyStatistics = Set-ReferatStatistics $wordOnly $request
if ($wordOnly.Content.Text.Trim() -ne 'Unmanaged count: 123 few' -or
    (Assert-ReferatPageStatistics $wordOnly $wordOnlyStatistics 124)) {
    throw 'A word-only placeholder falsely verified an unmanaged number.'
}
Write-Output 'PASS word-only-count-unknown'

$unstable = New-StatisticsDocument 123
$unstable.Unstable = $true
Assert-Fails { Set-ReferatStatistics $unstable $request } 'page count did not stabilize'
if ($unstable.Repaginations -ne 10) { throw 'Pagination retry bound changed.' }
Write-Output 'PASS unstable-pagination-bounded'

foreach ($case in @(@(1, 'one'), @(2, 'few'), @(11, 'many'), @(21, 'one'), @(124, 'few'))) {
    if ((Get-PageWord $case[0] $request.pageWordForms) -ne $case[1]) { throw 'Page word selection changed.' }
}
Write-Output 'PASS page-word-forms'
Write-Output 'Referat page statistics tests passed: 8 cases; no Word process created.'
