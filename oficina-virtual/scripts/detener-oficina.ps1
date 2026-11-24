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
if ($servidor) {
  # Primero pide apagado ordenado (cierra bien WhatsApp); si en 20 s no se apagó, a la fuerza.
  try { Invoke-WebRequest "http://127.0.0.1:$puerto/api/apagar" -Method Post -Headers @{ 'X-Oficina' = 'apagar' } -UseBasicParsing -TimeoutSec 5 | Out-Null } catch {}
  for ($i = 0; $i -lt 40 -and (Get-Process -Id $servidor -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  if (Get-Process -Id $servidor -ErrorAction SilentlyContinue) { Stop-Process -Id $servidor -Force }
}

Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*\.cache\puppeteer*' } |
  Stop-Process -Force

'Oficina Virtual detenida.'
