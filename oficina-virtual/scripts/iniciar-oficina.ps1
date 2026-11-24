# Mantiene la Oficina Virtual encendida: la arranca y, si se cae, la vuelve a arrancar.
# Lo lanza iniciar-oficina.vbs (sin ventana) desde la carpeta Inicio de Windows.
# Registro en data\logs\oficina.log
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$logs = Join-Path $raiz 'data\logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'oficina.log'
$pidFile = Join-Path $raiz 'data\oficina.pid'

$puerto = 3000
$linea = Select-String -Path (Join-Path $raiz '.env') -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue
if ($linea) { $puerto = [int]$linea.Matches[0].Groups[1].Value }

# Ya hay una Oficina Virtual corriendo: no abrir otra.
if (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) { exit }
$PID | Set-Content $pidFile

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

function Anotar($texto) {
  Add-Content -Path $log -Encoding UTF8 -Value "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $texto ====="
}

# Actualización automática (src/sync/programa.js): si con el programa nuevo la Oficina no logra quedarse
# arriba (se cae 3 veces seguidas), se regresan los archivos que tenía antes.
$actualizacion = Join-Path $raiz 'data\actualizacion'
function Revisar-Actualizacion {
  $pendiente = Join-Path $actualizacion 'pendiente.json'
  if (-not (Test-Path $pendiente)) { return }
  try { $p = Get-Content $pendiente -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Remove-Item -LiteralPath $pendiente -Force; return }
  $p.intentos = [int]$p.intentos + 1
  if ($p.intentos -le 3) {
    [IO.File]::WriteAllText($pendiente, ($p | ConvertTo-Json -Depth 3))
    return
  }
  Anotar 'El programa nuevo no arrancó: se regresa al anterior'
  $respaldo = Join-Path $actualizacion 'anterior'
  foreach ($r in @($p.archivos)) { if ($r) { Copy-Item -LiteralPath (Join-Path $respaldo $r) -Destination (Join-Path $raiz $r) -Force -ErrorAction SilentlyContinue } }
  foreach ($r in @($p.nuevos)) { if ($r) { Remove-Item -LiteralPath (Join-Path $raiz $r) -Force -ErrorAction SilentlyContinue } }
  [IO.File]::WriteAllText((Join-Path $actualizacion 'rechazada.txt'), [string]$p.version)
  Remove-Item -LiteralPath $pendiente -Force
}

while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.anterior" -Force }
  Revisar-Actualizacion
  # Un navegador del robot que quedó huérfano bloquearía el perfil de Pulpos: se cierra.
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.ExecutablePath -like '*\.cache\puppeteer*' -and -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Anotar 'Arrancando Oficina Virtual'
  # cmd hace la redirección para que el log quede en UTF-8 tal como lo escribe Node.
  cmd /c "`"$node`" --env-file-if-exists=.env src\server.js >> `"$log`" 2>&1"
  Anotar "Se detuvo (código $LASTEXITCODE); reinicio en 10 s"
  Start-Sleep -Seconds 10
}
