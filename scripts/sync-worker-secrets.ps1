Param(
  [string]$EnvFile = ".env.local",
  [string]$WorkerDir = "worker",
  [string]$WorkerName = "niyazm"
)

$ErrorActionPreference = "Stop"

function Parse-DotenvFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Env file not found: $Path"
  }
  $map = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith("#")) { return }
    if ($line -notmatch "^[A-Za-z_][A-Za-z0-9_]*\s*=") { return }
    $parts = $line -split "=", 2
    $key = $parts[0].Trim()
    $value = $parts[1]
    if ($null -eq $value) { $value = "" }
    $value = $value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $map[$key] = $value
  }
  return $map
}

function Put-WorkerSecret {
  param(
    [string]$Name,
    [string]$Value
  )
  if (-not $Value) {
    Write-Host "skip: $Name (missing/empty)"
    return
  }
  Write-Host "set: $Name"
  # Pipe via stdin so the value is not echoed in the command line.
  $Value | & npx wrangler secret put $Name --name $WorkerName | Out-Host
}

$envMap = Parse-DotenvFile -Path $EnvFile

$googleCx = ""
if ($envMap.ContainsKey("GOOGLE_CSE_CX")) { $googleCx = $envMap["GOOGLE_CSE_CX"] }
elseif ($envMap.ContainsKey("GOOGLE_CSE_SEARCH_ENGINE_ID")) { $googleCx = $envMap["GOOGLE_CSE_SEARCH_ENGINE_ID"] }

Push-Location $WorkerDir
try {
  Put-WorkerSecret -Name "GEMINI_API_KEY" -Value ($envMap["GEMINI_API_KEY"])
  Put-WorkerSecret -Name "NEWS_API_KEY" -Value ($envMap["NEWS_API_KEY"])
  Put-WorkerSecret -Name "EVENT_REGISTRY_API_KEY" -Value ($envMap["EVENT_REGISTRY_API_KEY"])
  Put-WorkerSecret -Name "GOOGLE_CSE_API_KEY" -Value ($envMap["GOOGLE_CSE_API_KEY"])
  Put-WorkerSecret -Name "GOOGLE_CSE_CX" -Value $googleCx
} finally {
  Pop-Location
}

