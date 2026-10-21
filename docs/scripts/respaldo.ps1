# ============================================================
# respaldo.ps1 · Copia (o repone) los archivos del bucket privado "adjuntos".
#
# USO (PowerShell, desde la carpeta del proyecto):
#   Descargar todo a una carpeta local:
#     powershell -ExecutionPolicy Bypass -File docs\scripts\respaldo.ps1 `
#       -Modo descarga -Url "https://TU-PROYECTO.supabase.co" -Carpeta "C:\RespaldosCompras\2026-10-24_storage"
#   Subir una copia a un proyecto (restauración / proyecto de pruebas):
#     powershell -ExecutionPolicy Bypass -File docs\scripts\respaldo.ps1 `
#       -Modo subida -Url "https://PROYECTO-PRUEBAS.supabase.co" -Carpeta "C:\RespaldosCompras\2026-10-24_storage"
#
# La clave secreta (service_role) se pide en pantalla y NO se guarda.
# Requiere PowerShell 5+ (incluido en Windows 10/11). Sin dependencias.
# ============================================================

param(
  [Parameter(Mandatory = $true)][ValidateSet('descarga', 'subida')] [string]$Modo,
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Carpeta,
  [string]$Bucket = 'adjuntos'
)

$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')

if ($Url -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
  Write-Host "La URL debe ser como https://abcdefgh.supabase.co (sin rutas)." -ForegroundColor Red
  exit 1
}

# Clave secreta: solo en memoria durante la ejecución.
$claveSegura = Read-Host "Pega la clave service_role del proyecto $Url (no se guardará)" -AsSecureString
$clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($claveSegura))
if ([string]::IsNullOrWhiteSpace($clave) -or $clave.Length -lt 30) {
  Write-Host "Clave vacía o demasiado corta; opera desde Project Settings → API Keys." -ForegroundColor Red
  exit 1
}
$cab = @{ 'Authorization' = "Bearer $clave"; 'apikey' = $clave }

function Tipo-De($ruta) {
  switch -Regex ($ruta) {
    '\.jpe?g$' { 'image/jpeg'; break }
    '\.png$'   { 'image/png'; break }
    '\.webp$'  { 'image/webp'; break }
    '\.pdf$'   { 'application/pdf'; break }
    default    { 'application/octet-stream' }
  }
}

function Listar-Recursivo($prefijo) {
  $acumulado = @()
  $offset = 0
  while ($true) {
    $cuerpo = @{ prefix = $prefijo; limit = 100; offset = $offset;
                 sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json
    $lote = Invoke-RestMethod -Method Post -Uri "$Url/storage/v1/object/list/$Bucket" `
              -Headers $cab -ContentType 'application/json' -Body $cuerpo
    if (-not $lote -or $lote.Count -eq 0) { break }
    foreach ($item in $lote) {
      $rutaCompleta = if ($prefijo) { "$prefijo/$($item.name)" } else { $item.name }
      if ($null -eq $item.id) {
        # Es una "carpeta": descender.
        $acumulado += Listar-Recursivo $rutaCompleta
      } else {
        $acumulado += $rutaCompleta
      }
    }
    if ($lote.Count -lt 100) { break }
    $offset += 100
  }
  return $acumulado
}

if ($Modo -eq 'descarga') {
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  Write-Host "Listando objetos del bucket '$Bucket'…"
  $rutas = @(Listar-Recursivo '')
  Write-Host ("{0} archivo(s) por descargar." -f $rutas.Count)
  $ok = 0; $fallos = 0
  foreach ($r in $rutas) {
    $destino = Join-Path $Carpeta ($r -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
    try {
      Invoke-WebRequest -Uri "$Url/storage/v1/object/$Bucket/$r" -Headers $cab `
        -OutFile $destino | Out-Null
      $ok++
      Write-Host ("  ✓ {0}" -f $r)
    } catch {
      $fallos++
      Write-Host ("  ✗ {0}  ({1})" -f $r, $_.Exception.Message) -ForegroundColor Red
    }
  }
  Write-Host ""
  Write-Host ("Descarga terminada: {0} correctos, {1} fallidos, carpeta: {2}" -f $ok, $fallos, $Carpeta) `
    -ForegroundColor ($(if ($fallos -eq 0) { 'Green' } else { 'Yellow' }))
  if ($fallos -gt 0) { exit 2 }
}
else {
  if (-not (Test-Path $Carpeta)) {
    Write-Host "La carpeta $Carpeta no existe." -ForegroundColor Red
    exit 1
  }
  $archivos = Get-ChildItem -Path $Carpeta -Recurse -File
  Write-Host ("{0} archivo(s) por subir al bucket '{1}' de {2}." -f $archivos.Count, $Bucket, $Url)
  $ok = 0; $fallos = 0
  foreach ($a in $archivos) {
    $relativa = $a.FullName.Substring((Resolve-Path $Carpeta).Path.Length).TrimStart('\') -replace '\\', '/'
    try {
      $cabSubida = $cab.Clone()
      $cabSubida['x-upsert'] = 'true'
      Invoke-WebRequest -Method Post -Uri "$Url/storage/v1/object/$Bucket/$relativa" `
        -Headers $cabSubida -ContentType (Tipo-De $relativa) -InFile $a.FullName | Out-Null
      $ok++
      Write-Host ("  ✓ {0}" -f $relativa)
    } catch {
      $fallos++
      Write-Host ("  ✗ {0}  ({1})" -f $relativa, $_.Exception.Message) -ForegroundColor Red
    }
  }
  Write-Host ""
  Write-Host ("Subida terminada: {0} correctos, {1} fallidos." -f $ok, $fallos) `
    -ForegroundColor ($(if ($fallos -eq 0) { 'Green' } else { 'Yellow' }))
  if ($fallos -gt 0) { exit 2 }
}
