$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null
foreach ($item in @("index.html", "create.html", "js", "lib", "assets")) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $dist -Recurse -Force
}
if (Get-NetTCPConnection -LocalPort 7897 -State Listen -ErrorAction SilentlyContinue) {
  $env:HTTPS_PROXY = "http://127.0.0.1:7897"
  $env:HTTP_PROXY = "http://127.0.0.1:7897"
}
Set-Location $root
try {
  npx --yes wrangler@latest pages deploy $dist --project-name winter-gift --branch main --commit-dirty=true
} finally {
  Set-Location $PSScriptRoot
}
