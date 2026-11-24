@echo off
rem Servidor POS: deja el servidor arrancando solo al encender esta PC y crea el acceso "Abrir POS".
rem No necesita permisos de administrador. No cambia el firewall: el comando para eso se muestra al final.
setlocal
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "$l = $s.CreateShortcut([Environment]::GetFolderPath('Startup') + '\Servidor POS.lnk');" ^
  "$l.TargetPath = 'wscript.exe'; $l.Arguments = [char]34 + '%DIR%\iniciar-servidor.vbs' + [char]34; $l.WorkingDirectory = '%DIR%'; $l.Description = 'Servidor POS'; $l.Save();" ^
  "Set-Content -Encoding ASCII -Path ([Environment]::GetFolderPath('Desktop') + '\Abrir POS.url') -Value \"[InternetShortcut]`r`nURL=http://localhost:8420/\""
if errorlevel 1 (
  echo No se pudieron crear los accesos directos.
  pause
  exit /b 1
)

echo.
echo Listo:
echo  - El Servidor POS arrancara solo cada vez que se encienda esta PC, oculto (sin ventana).
echo    Para cerrarlo: detener-servidor.cmd. Para abrirlo: iniciar-servidor.vbs
echo  - En el escritorio quedo el acceso "Abrir POS".
echo.
echo PASO PENDIENTE (una sola vez): permitir que las otras PCs se conecten.
echo Abre PowerShell como administrador y ejecuta:
echo.
echo   New-NetFirewallRule -DisplayName "Servidor POS" -Direction Inbound -Protocol TCP -LocalPort 8420 -Profile Private -Action Allow
echo.
echo La red del negocio debe estar como "Privada" en Windows.
echo.
wscript.exe "%DIR%\iniciar-servidor.vbs"
echo El Servidor POS ya esta corriendo. Las otras PCs entran con alguna de estas direcciones:
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '  http://' + $_.IPAddress + ':8420' }"
echo (Tambien aparece en el POS: Preferencias ^> Acceso.)
echo.
pause
