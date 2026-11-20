param(
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$excludedPrefixes = @(
  '_claude-sessions/',
  'openspec/',
  'docs/desafio/'
)
$excludedPaths = @(
  '.mcp.json',
  'docs/phases/phase-03-videos/evidence/candidate-before.sha256',
  'docs/phases/phase-03-videos/evidence/candidate-after.sha256'
)

$paths = @(git -C $repository -c core.quotepath=false ls-files -co --exclude-standard) |
  ForEach-Object { $_.Replace('\', '/') } |
  Where-Object {
    $path = $_
    -not $excludedPaths.Contains($path) -and
      -not ($excludedPrefixes | Where-Object { $path.StartsWith($_, [System.StringComparison]::Ordinal) }) -and
      -not [System.IO.Path]::GetFileName($path).StartsWith(
        '.large-',
        [System.StringComparison]::Ordinal
      )
  }
$paths = @($paths | Select-Object -Unique)
[Array]::Sort($paths, [System.StringComparer]::Ordinal)

$lines = foreach ($path in $paths) {
  $absolute = Join-Path $repository $path
  if (Test-Path -LiteralPath $absolute -PathType Leaf) {
    $item = Get-Item -LiteralPath $absolute
    $hash = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
    "$path`t$($item.Length)`t$hash"
  } else {
    "$path`tDELETED`t-"
  }
}

$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath
} else {
  Join-Path $repository $OutputPath
}
$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
  throw "Output directory does not exist: $parent"
}
[System.IO.File]::WriteAllLines($resolvedOutput, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "candidate_paths=$($lines.Count)"
