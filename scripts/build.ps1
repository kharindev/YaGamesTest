$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "YaGamesTest"
$archive = Join-Path $dist ("YaGamesTest-{0}.zip" -f $manifest.version)

if (Test-Path -LiteralPath $dist) {
  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  $resolvedDist = (Resolve-Path -LiteralPath $dist).Path
  if (-not $resolvedDist.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove build directory outside the repository"
  }
  Remove-Item -LiteralPath $resolvedDist -Recurse -Force
}

New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "manifest.json"), (Join-Path $root "background.js"), (Join-Path $root "content.js"), (Join-Path $root "page-monitor.js") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "checks") -Destination $stage -Recurse
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $archive -CompressionLevel Optimal
Write-Output $archive
