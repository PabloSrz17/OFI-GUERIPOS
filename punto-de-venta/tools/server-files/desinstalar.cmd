@echo off
rem Cierra el servidor y quita el arranque automatico y el acceso "Abrir POS". No borra datos ni respaldos.
taskkill /f /im ServidorPOS.exe >nul 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Servidor POS.lnk" 2>nul
powershell -NoProfile -Command "Remove-Item -ErrorAction SilentlyContinue ([Environment]::GetFolderPath('Desktop') + '\Abrir POS.url')"
echo Listo. Los datos siguen en la carpeta "datos" y los respaldos en "respaldos".
echo Para quitar la regla del firewall (como administrador):
echo   Remove-NetFirewallRule -DisplayName "Servidor POS"
pause
