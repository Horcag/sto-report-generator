$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../scripts/word_acceptance.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source), [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'Word acceptance script has parse errors.' }
$names = @('Test-StyleExists', 'Get-StyleChecks')
$functions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
}, $true))
if ($functions.Count -ne 2) { throw 'Both style existence functions must be discovered.' }
foreach ($functionAst in $functions) { Invoke-Expression $functionAst.Extent.Text }

function New-StyleDocument($ExpectedId = $null, [string]$Xml = '') {
    $styles = [pscustomobject]@{ ExpectedId = $ExpectedId; Named = @{}; Calls = @(); IsBuiltIn = $true }
    $styles | Add-Member ScriptMethod Item {
        param($index)
        $this.Calls += $index
        if ($index -is [string]) {
            if ($this.Named.ContainsKey($index)) { return $this.Named[$index] }
            throw 'Canonical name unavailable in the localized COM collection.'
        }
        if ($null -ne $this.ExpectedId -and [int]$index -eq [int]$this.ExpectedId) {
            return [pscustomobject]@{ BuiltIn = $this.IsBuiltIn; NameLocal = 'Localized name'; Font = [pscustomobject]@{ Bold = -1 } }
        }
        throw 'Numeric style ID does not exist.'
    }
    return [pscustomobject]@{ Styles = $styles; WordOpenXML = $Xml }
}
function New-StylePackage([string]$Name, [string]$Part = '/word/styles.xml') {
    $escaped = [System.Security.SecurityElement]::Escape($Name)
    return '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><pkg:part pkg:name="' + $Part + '"><pkg:xmlData><w:styles><w:style w:styleId="saved"><w:name w:val="' + $escaped + '"/></w:style></w:styles></pkg:xmlData></pkg:part></pkg:package>'
}

# Explicit expected constants, independent of the implementation's name map.
$builtIns = @{
    'Normal' = -1; 'Default Paragraph Font' = -66; 'Normal Table' = -106
    'footer' = -33; 'header' = -32; 'page number' = -42; 'Plain Text' = -91
    'List Paragraph' = -180; 'Subtitle' = -75; 'TOC Heading' = -267
    'footnote text' = -30; 'footnote reference' = -39; 'Body Text' = -67; 'Hyperlink' = -86
    'heading 1' = -2; 'heading 2' = -3; 'heading 3' = -4; 'heading 4' = -5; 'heading 5' = -6
    'heading 6' = -7; 'heading 7' = -8; 'heading 8' = -9; 'heading 9' = -10
    'toc 1' = -20; 'toc 2' = -21; 'toc 3' = -22; 'toc 4' = -23; 'toc 5' = -24
    'toc 6' = -25; 'toc 7' = -26; 'toc 8' = -27; 'toc 9' = -28
}
foreach ($entry in $builtIns.GetEnumerator()) {
    $document = New-StyleDocument $entry.Value
    if (-not (Test-StyleExists $document $entry.Key)) { throw "Localized built-in rejected: $($entry.Key)" }
    if ($document.Styles.Calls.Count -ne 2 -or $document.Styles.Calls[1] -is [string] -or
        $document.Styles.Calls[1] -ne $entry.Value) { throw "Wrong numeric lookup for $($entry.Key)" }
}
if ($builtIns.Count -ne 32) { throw 'Expected all 32 documented built-in cases.' }

$document = New-StyleDocument (-1)
$document.Styles.IsBuiltIn = $false
if (Test-StyleExists $document 'Normal') { throw 'Non-built-in object accepted as a numeric built-in style.' }
if (Test-StyleExists (New-StyleDocument) 'Normal') { throw 'Missing built-in style was accepted.' }

foreach ($name in @('Table Grid', 'Balloon Text', 'No List', 'Imported custom style')) {
    if (-not (Test-StyleExists (New-StyleDocument $null (New-StylePackage $name)) $name)) {
        throw "Persisted canonical style rejected: $name"
    }
}
if (Test-StyleExists (New-StyleDocument $null (New-StylePackage 'Existing custom style')) 'Missing custom style') {
    throw 'An unrelated saved style hid a missing imported custom style.'
}
if (Test-StyleExists (New-StyleDocument $null (New-StylePackage 'Missing custom style' '/word/document.xml')) 'Missing custom style') {
    throw 'A name outside the saved styles part was accepted.'
}
if (Test-StyleExists (New-StyleDocument $null '<invalid>') 'Missing custom style') {
    throw 'Malformed saved XML hid a missing style.'
}
$named = New-StyleDocument
$named.Styles.Named['Imported custom style'] = [pscustomobject]@{ BuiltIn = $false }
if (-not (Test-StyleExists $named 'Imported custom style') -or $named.Styles.Calls.Count -ne 1) {
    throw 'Existing custom COM lookup changed.'
}
$checks = @(Get-StyleChecks (New-StyleDocument (-1)) @(
    [pscustomobject]@{ styleId = 'normal-id'; displayName = 'Normal' },
    [pscustomobject]@{ styleId = 'missing-id'; displayName = 'Missing custom style' }
))
if ($checks.Count -ne 2 -or $checks[0].styleId -ne 'normal-id' -or -not $checks[0].exists -or
    $checks[1].styleId -ne 'missing-id' -or $checks[1].displayName -ne 'Missing custom style' -or $checks[1].exists) {
    throw 'Get-StyleChecks suppressed or changed a missing imported style.'
}
Write-Output 'Word built-in style existence: 32 numeric cases and 11 saved/custom/failure cases passed; both functions executed.'

$boldRoles = @('StoHeading1', 'StoHeading2', 'StoHeading3', 'StoHeading4', 'StoHeading5', 'StoHeading6', 'AppendixHeading', 'TOCHeading')
foreach ($id in $boldRoles) {
    $document = New-StyleDocument
    $document.Styles.Named['Sample heading'] = [pscustomobject]@{ Font = [pscustomobject]@{ Bold = -1 } }
    $checks = @(Get-StyleChecks $document @([pscustomobject]@{ styleId = $id; displayName = 'Sample heading' }))
    if ($checks.Count -ne 1 -or $checks[0].effectiveBold -ne -1) { throw "Effective Word bold was not verified for $id" }
    $document.Styles.Named['Sample heading'].Font.Bold = 0
    $rejected = $false
    try { Get-StyleChecks $document @([pscustomobject]@{ styleId = $id; displayName = 'Sample heading' }) | Out-Null } catch {
        if ($_.Exception.Message -notmatch 'does not render bold') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw "Missing bold was accepted for $id" }
}
foreach ($level in @(5, 6)) {
    $checks = @(Get-StyleChecks (New-StyleDocument (-($level + 1))) @([pscustomobject]@{ styleId = "StoHeading$level"; displayName = "heading $level" }))
    if ($checks[0].effectiveBold -ne -1) { throw 'Localized effective bold lookup failed.' }
}
Write-Output 'Word effective bold: 8 roles, 8 rejection cases and 2 localized heading lookups passed.'
$localizedToc = @(Get-StyleChecks (New-StyleDocument (-267)) @([pscustomobject]@{ styleId = 'TOCHeading'; displayName = 'TOC Heading' }))
if ($localizedToc.Count -ne 1 -or $localizedToc[0].effectiveBold -ne -1) { throw 'Localized TOC Heading effective bold lookup failed.' }
Write-Output 'Localized TOC Heading effective bold lookup passed.'
