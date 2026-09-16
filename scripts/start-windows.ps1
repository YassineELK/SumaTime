$ErrorActionPreference = 'Stop'
$applicationRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $applicationRoot
if (-not (Test-Path -LiteralPath '.next/BUILD_ID')) {
    throw "Compilez avec npm run build avant de continuer."
}
& node --env-file-if-exists=.env.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 5173
exit $LASTEXITCODE
