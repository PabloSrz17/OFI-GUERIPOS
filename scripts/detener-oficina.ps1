# Detiene la Oficina Virtual: primero el vigilante (para que no la reinicie), luego el servidor
# y el navegador del robot de Pulpos.
$raiz = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $raiz 'data\oficina.pid'

if (Test-Path $pidFile) {
  $vigilante = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
  if ($vigilante -and $vigilante.ProcessName -match '^powershell') { Stop-Process -Id $vigilante.Id -Force }
  Remove-Item $pidFile -Force
}

$puerto = 3000
$linea = Select-String -Path (Join-Path $raiz '.env') -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue
if ($linea) { $puerto = [int]$linea.Matches[0].Groups[1].Value }
$servidor = (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($servidor) { Stop-Process -Id $servidor -Force }

Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*\.cache\puppeteer*' } |
  Stop-Process -Force

'Oficina Virtual detenida.'
