@echo off
setlocal
chcp 65001 >nul
rem Instala la Oficina Virtual como servidor de MOSTRADOR (secundario).
rem Se corre UNA vez en la PC de Mostrador, desde la carpeta OficinaVirtual que viene en el .zip.
cd /d "%~dp0"
echo.
echo  === Oficina Virtual - servidor de Mostrador ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Falta Node.js en esta PC. Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=9)?0:1)"
if errorlevel 1 (
  echo  Node.js es muy viejo. Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist ".env" (
  echo  Falta el archivo .env: usa el .zip que armo "npm run mostrador:paquete" en el servidor Principal.
  pause
  exit /b 1
)

echo  1/3 Instalando lo necesario (necesita internet, unos minutos)...
rem Sin el navegador de Puppeteer: en Mostrador no corren WhatsApp ni el robot de Pulpos.
set PUPPETEER_SKIP_DOWNLOAD=1
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo  No se pudo instalar. Revisa la conexion a internet y vuelve a abrir este archivo.
  pause
  exit /b 1
)

echo  2/3 Arranque automatico al iniciar Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\inicio-automatico.ps1"

echo  3/3 Arrancando la Oficina (sin ventana)...
wscript "scripts\iniciar-oficina.vbs"

echo.
echo  Listo. En unos segundos abre http://localhost:3000 en esta PC.
echo  La primera vez copia todo del servidor Principal (debe estar encendido); despues trabaja aunque este apagado.
echo  Si Windows pregunta por el Firewall, permite "Node.js" en redes privadas: asi el Principal puede sincronizarse.
echo.
pause
