/**
 * Impresión de ESTA PC (D39): se guarda en el navegador, no en la base, porque cada PC decide. Así la PC de mostrador
 * puede sacar 3 tickets solos al cobrar sin que las demás PCs abran 3 diálogos de impresión.
 */
export interface LocalPrint {
  /** Al cobrar, el ticket sale solo, sin apretar "Imprimir Ticket". */
  autoPrint: boolean;
  /** Copias del ticket de venta al cobrar; cada una es un trabajo aparte (la impresora corta cada una). */
  copies: number;
}

export const MAX_COPIES = 5;
export const DEFAULT_LOCAL_PRINT: LocalPrint = { autoPrint: false, copies: 1 };
const KEY = 'pos.print.local';

export const clampCopies = (n: unknown) => Math.max(1, Math.min(MAX_COPIES, Math.round(Number(n)) || 1));

export function getLocalPrint(): LocalPrint {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalPrint>;
    return { autoPrint: raw.autoPrint === true, copies: clampCopies(raw.copies) };
  } catch {
    return { ...DEFAULT_LOCAL_PRINT };
  }
}

export function saveLocalPrint(p: LocalPrint) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ autoPrint: p.autoPrint, copies: clampCopies(p.copies) }));
  } catch {
    // Sin almacenamiento del navegador (ventana privada): se queda con lo predeterminado.
  }
}

/**
 * Archivo para la PC de mostrador: abre el POS en una ventana propia de Chrome (o Edge) con impresión directa
 * (`--kiosk-printing`): los tickets salen en la impresora predeterminada de Windows sin diálogo.
 * Usa un perfil aparte para que la opción funcione aunque el navegador ya esté abierto.
 */
export function mostradorLauncher(url: string, printer: string) {
  const p = printer.replace(/["%&|<>^]/g, '').trim();
  const u = url.replace(/["%&|<>^]/g, '');
  return [
    '@echo off',
    'rem Punto de Venta en mostrador: imprime los tickets sin preguntar (D39).',
    p ? `rem Deja "${p}" como impresora predeterminada de Windows (ahi salen los tickets).` : '',
    p ? `rundll32 printui.dll,PrintUIEntry /y /n "${p}" || echo No se encontro la impresora "${p}" en esta PC.` : '',
    'set "B="',
    'for %%F in ("%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe") do if not defined B if exist %%F set "B=%%~F"',
    'if not defined B (echo No se encontro Chrome ni Edge en esta PC. & pause & exit /b 1)',
    `start "" "%B%" --kiosk-printing --user-data-dir="%LocalAppData%\\PuntoDeVentaMostrador" --app="${u}"`,
    '',
  ]
    .filter((l, i, a) => l !== '' || i === a.length - 1)
    .join('\r\n');
}
