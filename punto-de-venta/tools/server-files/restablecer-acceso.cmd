@echo off
rem Si se olvido la contrasena: borra usuarios y sesiones (no toca ventas ni datos).
cd /d "%~dp0"
taskkill /f /im ServidorPOS.exe >nul 2>nul
timeout /t 2 /nobreak >nul
ServidorPOS.exe --restablecer-acceso
wscript.exe "%~dp0iniciar-servidor.vbs"
echo.
echo Listo. Entra a http://localhost:8420 en ESTA PC para crear el usuario de nuevo.
pause
