// Impresora de tickets de ESTA PC (en Mostrador, la WL88S). El Punto de Venta del Principal le manda por el enlace
// los bytes del ticket ya armados (ESC/POS, con la orden de corte después de cada copia) y aquí se mandan en crudo
// (RAW) a la cola de Windows: no hay cuadro de "Imprimir" ni depende de las preferencias del driver.
// Si el ticket se queda atorado (impresora apagada, sin papel) se quita de la cola y se avisa.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ATORADO_SEG = 20;

const IMPRIMIR = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OficinaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static int Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No se encontró la impresora " + printer + " en Mostrador");
    try {
      int job = StartDocPrinter(h, 1, new DOCINFO { pDocName = "Ticket POS", pDataType = "RAW" });
      if (job == 0) throw new Exception("La impresora no aceptó el ticket (error " + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h);
      int written;
      bool ok = WritePrinter(h, data, data.Length, out written);
      EndPagePrinter(h);
      EndDocPrinter(h);
      if (!ok || written != data.Length) throw new Exception("No se pudo mandar el ticket a la impresora (error " + Marshal.GetLastWin32Error() + ")");
      return job;
    } finally { ClosePrinter(h); }
  }
}
'@
try {
  $id = [OficinaRaw]::Send($env:OF_IMPRESORA, [IO.File]::ReadAllBytes($env:OF_ARCHIVO))
  $limite = (Get-Date).AddSeconds([int]$env:OF_ATORADO)
  while ($true) {
    $j = Get-PrintJob -PrinterName $env:OF_IMPRESORA -ID $id -ErrorAction SilentlyContinue
    if (-not $j) { 'OK'; break }
    $s = [string]$j.JobStatus
    if ($s -match 'Error|Offline|PaperOut|Blocked|UserIntervention') { Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue; "ERR La impresora de Mostrador no imprimió ($s): revisa que esté encendida y con papel."; break }
    if ((Get-Date) -gt $limite) { Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue; 'ERR La impresora de Mostrador no imprimió a tiempo: revisa que esté encendida y con papel.'; break }
    Start-Sleep -Milliseconds 150
  }
} catch {
  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
  'ERR ' + ($e.Message -replace '\s+', ' ')
}
`;

const codificado = (script) => Buffer.from(script, 'utf16le').toString('base64');

function powershell(script, env = {}) {
  return new Promise((ok, mal) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado(script)],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: (ATORADO_SEG + 40) * 1000, maxBuffer: 4 * 1024 * 1024 },
      (e, salida, err) => (e ? mal(new Error(String(err || e.message).trim().split('\n')[0])) : ok(String(salida))),
    );
  });
}

async function listar() {
  if (process.platform !== 'win32') return [];
  const salida = await powershell('[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName) | ConvertTo-Json -Compress');
  const crudo = salida.trim() ? JSON.parse(salida) : [];
  return (Array.isArray(crudo) ? crudo : [crudo]).map((p) => ({ name: p.Name, isDefault: !!p.Default, port: p.PortName ?? '', driver: p.DriverName ?? '' }));
}

let cola = Promise.resolve();

/** Manda los bytes a la impresora. Los tickets salen uno por uno, en el orden en que llegan. */
function imprimir(impresora, bytes) {
  const trabajo = cola.then(async () => {
    if (process.platform !== 'win32') throw new Error('Sólo en Windows');
    const archivo = path.join(os.tmpdir(), `oficina-ticket-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(archivo, bytes);
    try {
      const r = (await powershell(IMPRIMIR, { OF_IMPRESORA: impresora, OF_ARCHIVO: archivo, OF_ATORADO: String(ATORADO_SEG) })).trim().split(/\r?\n/).pop();
      if (r !== 'OK') throw new Error(r?.replace(/^ERR /, '') || 'No se pudo imprimir');
    } finally {
      fs.rmSync(archivo, { force: true });
    }
  });
  cola = trabajo.catch(() => undefined);
  return trabajo;
}

module.exports = { listar, imprimir };
