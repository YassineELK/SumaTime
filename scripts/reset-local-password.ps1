param([Parameter(Mandatory = $true)][string]$Email)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$protectedPassword = Read-Host 'Nouveau mot de passe provisoire (12 caractères minimum)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($protectedPassword)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $credentialJson = @{ email = $Email; password = $plainPassword } | ConvertTo-Json -Compress
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $credentialJson | & node --env-file-if-exists=.env.local scripts/reset-local-password.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Réinitialisation échouée.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $plainPassword = $null
    $credentialJson = $null
}
