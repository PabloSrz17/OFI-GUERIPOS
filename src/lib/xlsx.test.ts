// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnWidths, xlsxFile } from './xlsx';
// @ts-expect-error módulo .mjs sin tipos (lector usado para importar de Pulpos)
import { readXlsx } from '../../tools/import/xlsx.mjs';
import { SALES_REPORT_COLUMNS } from '@/repos/sales';


describe('Excel (.xlsx)', () => {
  const rows = [
    ['N1309', 'MATERIALES & ACABADOS "EL GÜERO"', 'Deuda pendiente', 123456.5, 0.5],
    ['#117', 'Público General', 'Pagada', 180, 0],
  ];
  const bytes = xlsxFile('Ventas', SALES_REPORT_COLUMNS, rows);

  it('se lee de vuelta: una hoja, encabezados y cada dato en su columna (números como números)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xlsx-')), 'reporte.xlsx');
    writeFileSync(file, bytes);
    const sheets = readXlsx(file) as Record<string, unknown[][]>;
    expect(Object.keys(sheets)).toEqual(['Ventas']);
    expect(sheets.Ventas).toEqual([['NUMERO DE VENTA #TICKET', 'CLIENTE', 'ESTADO', 'TOTAL', 'DEUDA ACTIVA'], ...rows]);
  });

  it('encabezados en negrita, dinero con formato $0.00 y anchos que no cortan', () => {
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<font><b/>');
    expect(text).toContain('formatCode="&quot;$&quot;#,##0.00"');
    expect(text).toMatch(/<c r="A1" t="inlineStr" s="1">/);
    expect(text).toContain('<c r="D2" s="2"><v>123456.5</v></c>');
    expect(text).toContain('state="frozen"');
    const widths = columnWidths(SALES_REPORT_COLUMNS, rows);
    expect(widths[0]).toBeGreaterThanOrEqual('NUMERO DE VENTA #TICKET'.length + 4);
    expect(widths[1]).toBeGreaterThanOrEqual(rows[0][1].toString().length);
    expect(widths[3]).toBeGreaterThanOrEqual('$123,456.50'.length);
  });
});
