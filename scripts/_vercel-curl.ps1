param(
  [Parameter(Mandatory = $true)][string]$Method,
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$BodyFile = '',
  [string]$Auth = ''
)

$npxArgs = @('vercel', 'curl', $Url, '-X', $Method, '-o', $OutFile)
if ($Auth) {
  $npxArgs += @('-H', ("Authorization: Bearer " + $Auth))
}
if ($BodyFile) {
  $npxArgs += @('-H', 'Content-Type: application/json', '--data-binary', ("@" + $BodyFile))
}

& npx @npxArgs | Out-Null
if (-not (Test-Path -LiteralPath $OutFile)) {
  Set-Content -LiteralPath $OutFile -Value '' -Encoding utf8
}
exit $LASTEXITCODE
