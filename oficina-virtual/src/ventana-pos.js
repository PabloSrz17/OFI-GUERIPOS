// Ventana del Punto de Venta con impresión directa (sin el cuadro de "Imprimir"): Chrome o Edge con --kiosk-printing,
// en su propio perfil para que el Chrome normal siga preguntando. Es el mismo perfil que el acceso
// "Punto de Venta (mostrador).cmd" que descarga el POS, así que conserva su configuración (imprimir al cobrar, copias).
// Si la ventana ya está abierta (aunque esté minimizada) sólo la trae al frente; no abre otra.
const { execFile } = require('node:child_process');
const path = require('node:path');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class VentanaPV {
  public delegate bool Cada(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Cada f, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  // Primera ventana visible del navegador (con título) que pertenece a alguno de esos procesos; minimizada también cuenta.
  public static IntPtr Buscar(uint[] pids) {
    var set = new HashSet<uint>(pids); IntPtr hallada = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!set.Contains(pid) || !IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      hallada = h; return false;
    }, IntPtr.Zero);
    return hallada;
  }
}
'@
$dir = $env:PV_DIR
$pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dir) } | ForEach-Object { [uint32]$_.ProcessId })
if ($pids.Count -gt 0) {
  $h = [VentanaPV]::Buscar([uint32[]]$pids)
  if ($h -ne [IntPtr]::Zero) {
    if ([VentanaPV]::IsIconic($h)) { [void][VentanaPV]::ShowWindow($h, 9) } else { [void][VentanaPV]::ShowWindow($h, 5) }
    # Windows sólo deja pasar al frente una ventana si "se tocó una tecla": se simula Alt.
    [VentanaPV]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [void][VentanaPV]::SetForegroundWindow($h)
    [VentanaPV]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    'enfocada'; exit 0
  }
}
if ($env:PV_IMPRESORA -and (Get-Printer -Name $env:PV_IMPRESORA -ErrorAction SilentlyContinue)) {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($env:PV_IMPRESORA)
}
$navegador = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "\${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "\${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) { 'sin-navegador'; exit 0 }
Start-Process -FilePath $navegador -ArgumentList @('--kiosk-printing', "--user-data-dir=""$dir""", '--no-first-run', "--app=$env:PV_URL")
'nueva'
`.replace(/\\\$\{/g, '${');

let enCurso = null; // dos clics seguidos no abren dos ventanas

/** Abre la ventana del POS o la trae al frente. Resuelve 'nueva', 'enfocada' o 'sin-navegador'. */
function abrirVentana({ url, impresora }) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Sólo en Windows'));
  if (enCurso) return enCurso;
  const env = {
    ...process.env,
    PV_DIR: path.join(process.env.LOCALAPPDATA || '', 'PuntoDeVentaMostrador'),
    PV_URL: url,
    PV_IMPRESORA: impresora || '',
  };
  enCurso = new Promise((ok, mal) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { env, windowsHide: true, timeout: 20000 }, (e, salida, err) => {
      if (e) return mal(new Error(String(err || e.message).trim().split('\n')[0]));
      ok(String(salida).trim().split(/\r?\n/).pop());
    });
  }).finally(() => setTimeout(() => (enCurso = null), 3000));
  return enCurso;
}

module.exports = { abrirVentana };
