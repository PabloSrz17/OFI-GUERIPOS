@echo off
rem Cierra el Servidor POS (corre oculto, sin ventana). Para volver a abrirlo: iniciar-servidor.vbs
taskkill /im ServidorPOS.exe >nul 2>nul
timeout /t 2 /nobreak >nul
taskkill /f /im ServidorPOS.exe >nul 2>nul
echo Servidor POS cerrado. Para abrirlo otra vez: doble clic en iniciar-servidor.vbs
pause
