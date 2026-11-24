/**
 * Impresión en la impresora de tickets conectada a la PC servidor (D35). Los bytes ESC/POS se mandan en crudo (RAW)
 * a la cola de impresión de Windows, así funciona con cualquier impresora instalada en Windows (USB, red o
 * compartida) sin controladores especiales. Con POS_PRINT_DRYRUN=<carpeta> no imprime: guarda los tickets como .bin
 * (para pruebas).
 *
 * Rapidez: un solo proceso de PowerShell queda abierto con el código de impresión ya compilado; cada ticket solo le
 * manda una línea. Que no se atore: después de mandar un ticket se vigila en la cola; si queda en error o no sale en
 * unos segundos, se quita de la cola y la PC que imprimió ve el aviso (así nunca se juntan tickets detrás de uno
 * atorado).
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  port: string;
  driver: string;
}

const DRYRUN = process.env.POS_PRINT_DRYRUN;
/** Segundos que un ticket puede tardar en salir de la cola antes de darlo por atorado. */
const STUCK_SECONDS = 20;

/**
 * Impresora en otra PC (D40): dentro de la Oficina Virtual, la impresora de tickets está en la PC de Mostrador.
 * Con POS_PRINT_RELAY (p. ej. http://192.168.1.67:3000/api/sync) y POS_PRINT_RELAY_TOKEN, la lista de impresoras y los
 * tickets van a la Oficina de esa PC, que los manda en crudo a su impresora. Se leen en cada uso.
 */
function relay() {
  const url = process.env.POS_PRINT_RELAY?.trim().replace(/\/+$/, '');
  return url ? { url, token: process.env.POS_PRINT_RELAY_TOKEN ?? '' } : null;
}

async function askRelay(r: { url: string; token: string }, path: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) {
  let res: Response;
  try {
    res = await fetch(r.url + path, { ...init, headers: { ...init.headers, 'X-Sync-Token': r.token }, signal: AbortSignal.timeout((STUCK_SECONDS + 40) * 1000) });
  } catch {
    throw new Error('La PC de la impresora (Mostrador) no contesta: revisa que esté encendida.');
  }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `La PC de la impresora respondió ${res.status}`);
  return data;
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr.toString().includes('CLIXML') ? '' : stderr.toString().trim()) || err.message));
        else resolve(stdout.toString());
      },
    );
  });
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  const r = relay();
  if (r) return (await askRelay(r, '/impresoras')) as PrinterInfo[];
  if (DRYRUN) return [{ name: 'Impresora de prueba', isDefault: true, port: 'USB001', driver: 'Prueba' }];
  const out = await powershell(
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName) | ConvertTo-Json -Compress',
  );
  const raw = out.trim() ? JSON.parse(out) : [];
  const list = (Array.isArray(raw) ? raw : [raw]) as { Name: string; Default: boolean; PortName: string; DriverName: string }[];
  return list.map((p) => ({ name: p.Name, isDefault: !!p.Default, port: p.PortName ?? '', driver: p.DriverName ?? '' }));
}

// Proceso fijo: lee una línea JSON {printer, file} por ticket y contesta una línea "OK" o "ERR <mensaje>".
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
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
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No se encontró la impresora " + printer + " (error " + Marshal.GetLastWin32Error() + ")");
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
Import-Module PrintManagement -ErrorAction SilentlyContinue
[Console]::Out.WriteLine('READY')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $req = $line | ConvertFrom-Json
    $id = [PosRawPrinter]::Send($req.printer, [IO.File]::ReadAllBytes($req.file))
    $limit = (Get-Date).AddSeconds([int]$req.stuck)
    $result = 'OK'
    while ($true) {
      $j = Get-PrintJob -PrinterName $req.printer -ID $id -ErrorAction SilentlyContinue
      if (-not $j) { break }
      $status = [string]$j.JobStatus
      if ($status -match 'Error|Offline|PaperOut|Blocked|UserIntervention') {
        Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue
        $result = "ERR La impresora no imprimió el ticket ($status). Se quitó de la cola: revisa que esté encendida, conectada y con papel."
        break
      }
      if ((Get-Date) -gt $limit) {
        Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue
        $result = "ERR La impresora no imprimió el ticket en $($req.stuck) segundos. Se quitó de la cola: revisa que esté encendida, conectada y con papel."
        break
      }
      Start-Sleep -Milliseconds 150
    }
    [Console]::Out.WriteLine($result)
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    [Console]::Out.WriteLine('ERR ' + ($e.Message -replace '\\s+', ' '))
  }
}
`;

let worker: { proc: ChildProcessWithoutNullStreams; ready: Promise<void>; waiting: ((line: string) => void)[] } | null = null;

function startWorker() {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true });
  const waiting: ((line: string) => void)[] = [];
  let buf = '';
  let markReady!: () => void;
  let failReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => ((markReady = res), (failReady = rej)));
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'READY') markReady();
      else if (line) waiting.shift()?.(line);
    }
  });
  proc.stderr.resume();
  const gone = () => {
    if (worker?.proc === proc) worker = null;
    failReady(new Error('No se pudo preparar la impresión en esta PC'));
    for (const w of waiting.splice(0)) w('ERR Se cerró el proceso de impresión; vuelve a intentar.');
  };
  proc.on('exit', gone);
  proc.on('error', gone);
  ready.catch(() => undefined);
  worker = { proc, ready, waiting };
  return worker;
}

/** Deja listo el proceso de impresión (el primer ticket sale sin esperar a que se prepare). */
export function warmUpPrinter() {
  if (!relay() && !DRYRUN && process.platform === 'win32' && !worker) startWorker();
}

async function sendToWorker(printer: string, file: string): Promise<void> {
  const w = worker ?? startWorker();
  await w.ready;
  const answer = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      resolve('ERR La impresión tardó demasiado; vuelve a intentar.');
      w.proc.kill(); // el siguiente ticket abre un proceso nuevo
    }, (STUCK_SECONDS + 30) * 1000);
    w.waiting.push((line) => (clearTimeout(timer), resolve(line)));
    w.proc.stdin.write(JSON.stringify({ printer, file, stuck: STUCK_SECONDS }) + '\n');
  });
  if (answer.startsWith('ERR')) throw new Error(answer.slice(4));
}

let counter = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Manda los bytes a la impresora. Los tickets se imprimen uno por uno, en el orden en que llegan. */
export function printRaw(printer: string, bytes: Uint8Array): Promise<void> {
  const job = queue.then(async () => {
    const r = relay();
    if (r) {
      await askRelay(r, `/imprimir?impresora=${encodeURIComponent(printer)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
      return;
    }
    const name = `ticket-${Date.now()}-${++counter}.bin`;
    if (DRYRUN) {
      mkdirSync(DRYRUN, { recursive: true });
      writeFileSync(join(DRYRUN, name), bytes);
      return;
    }
    const file = join(tmpdir(), `pos-${process.pid}-${name}`);
    writeFileSync(file, bytes);
    try {
      await sendToWorker(printer, file);
    } finally {
      try {
        unlinkSync(file);
      } catch {
        /* ya no existe */
      }
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
