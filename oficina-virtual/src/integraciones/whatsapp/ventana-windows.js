// Esconder y mostrar la ventana de Chrome de WhatsApp (Windows). Escondida no sale ni en la barra de
// tareas, pero sigue abierta: Chatito trabaja igual. Sólo toca la ventana de nuestro propio Chrome.
const { execFile } = require('node:child_process');

const CODIGO = `
using System;
using System.Text;
using System.Runtime.InteropServices;
public class VentanaOficina {
  delegate bool Recorrer(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Recorrer f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int modo);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  public static long Buscar(uint pid) {
    IntPtr hallada = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      var clase = new StringBuilder(64); GetClassName(h, clase, 64);
      if (clase.ToString() != "Chrome_WidgetWin_1") return true;
      hallada = h; return false;
    }, IntPtr.Zero);
    return hallada.ToInt64();
  }
  public static void Esconder(long h) { ShowWindow(new IntPtr(h), 0); }
  public static void Mostrar(long h) { ShowWindow(new IntPtr(h), 9); SetForegroundWindow(new IntPtr(h)); }
}`;

function powershell(orden) {
  const comando = `Add-Type -TypeDefinition @'\n${CODIGO}\n'@\n${orden}`;
  return new Promise((ok, mal) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], { timeout: 20_000, windowsHide: true },
      (err, salida) => (err ? mal(err) : ok(String(salida).trim())));
  });
}

const esWindows = process.platform === 'win32';
// Número de la ventana visible del Chrome con ese proceso (0 si no hay).
const buscar = async (pid) => (esWindows ? Number(await powershell(`[VentanaOficina]::Buscar(${Number(pid)})`)) || 0 : 0);
const esconder = (ventana) => (esWindows ? powershell(`[VentanaOficina]::Esconder(${Number(ventana)})`) : Promise.resolve());
const mostrar = (ventana) => (esWindows ? powershell(`[VentanaOficina]::Mostrar(${Number(ventana)})`) : Promise.resolve());

module.exports = { buscar, esconder, mostrar };
