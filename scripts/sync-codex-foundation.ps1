[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'docs/ai/codex/skills'
$destinationRoot = Join-Path $projectRoot '.agents/skills'
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Fundação Codex ausente: $sourceRoot"
}
New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
$copiedFiles = 0
foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force) {
    $relativePath = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
    $destination = Join-Path $destinationRoot $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination -Force
    $copiedFiles++
}
Write-Output "Fundação Codex sincronizada: $copiedFiles arquivos. Outras skills locais foram preservadas."
