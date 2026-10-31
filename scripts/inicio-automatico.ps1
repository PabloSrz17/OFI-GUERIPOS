# Pone (o quita con -Quitar) el acceso directo "Oficina Virtual" en la carpeta Inicio de Windows,
# para que arranque sola al iniciar sesión. No requiere permisos de administrador.
param([switch]$Quitar)

$acceso = Join-Path ([Environment]::GetFolderPath('Startup')) 'Oficina Virtual.lnk'

if ($Quitar) {
  Remove-Item $acceso -ErrorAction SilentlyContinue
  'Arranque automático quitado.'
  return
}

$atajo = (New-Object -ComObject WScript.Shell).CreateShortcut($acceso)
$atajo.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$atajo.Arguments = '"' + (Join-Path $PSScriptRoot 'iniciar-oficina.vbs') + '"'
$atajo.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$atajo.Description = 'Arranca la Oficina Virtual al iniciar sesión'
$atajo.Save()
"Arranque automático instalado: $acceso"
