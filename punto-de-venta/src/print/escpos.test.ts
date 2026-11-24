import { describe, expect, it } from 'vitest';
import { encodeText, escpos, rowText, ticketMarkup, ticketText, wrap } from './escpos';
import { htmlToLines } from './output';
import { clampCopies, mostradorLauncher } from './local';
import { ticketHtml, DEFAULT_TICKET } from '@/sales/ticket';
import type { SaleDetail } from '@/repos/sales';

describe('tickets para impresora térmica', () => {
  it('acentos y eñes en PC850; lo demás se aproxima', () => {
    expect(encodeText('Añó ¿?')).toEqual([0x41, 0xa4, 0xa2, 0x20, 0xa8, 0x3f]);
    expect(encodeText('“x”—ç')).toEqual([0x22, 0x78, 0x22, 0x2d, 0x63]);
  });

  it('parte renglones sin cortar palabras y alinea importes a la derecha', () => {
    expect(wrap('CEMENTO GRIS 50 KG MARCA TOLTECA', 16)).toEqual(['CEMENTO GRIS 50', 'KG MARCA TOLTECA']);
    expect(rowText('Total', '$10.00', 16)).toEqual(['Total     $10.00']);
    expect(rowText('2 x $1,250.00 cada uno', '$2,500.00', 16)).toEqual(['2 x $1,250.00', 'cada uno', '       $2,500.00']);
  });

  it('arma los bytes: inicio, alineación con espacios, negrita por tramos y corte', () => {
    const b = Array.from(
      escpos([{ type: 'row', left: 'Venta', right: 'N12', rightParts: [{ text: 'N12', bold: true }] }, { type: 'rule' }], { columns: 32, cut: true }),
    );
    expect(b.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
    // La negrita abre justo antes del folio y cierra justo después, sin mover el renglón.
    const row = [0x20, ...encodeText('Venta'), ...Array(22).fill(0x20), 0x1b, 0x45, 1, ...encodeText('N12'), 0x1b, 0x45, 0, 0x0a];
    expect(b.join(',')).toContain(row.join(','));
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0]);
    expect(Array.from(escpos([], { columns: 32, cut: false })).slice(-5)).toEqual([0x1b, 0x32, 0x1b, 0x64, 4]);
  });

  it('ticket de venta como el de referencia (D41): margen, orden y negrita solo en folio, cliente, celular, dirección, materiales y TOTAL', () => {
    const sale = {
      folio: 1316, mode: 'sale', created_at: new Date(2026, 10, 24, 10, 0, 13).toISOString(), user_name: 'Administrador',
      client_name: 'ROBERTO MOO MOLINA', client_phone: '+529811236972', client_address: 'PROL PEDRO MORENO ENTRE C 6 Y PRIV CRISANTO, SAN RAFAEL',
      items: [
        { name: 'CEMENTO MAYA 25 KG CEMEX', quantity: 8, unit: 'piece', unit_price_cents: 15000, gross_cents: 120000, discount_cents: 0, discount_label: '' },
        { name: 'POLVO POR METRO', quantity: 1, unit: 'm', unit_price_cents: 55000, gross_cents: 55000, discount_cents: 0, discount_label: '' },
      ],
      subtotal_cents: 175000, discount_cents: 0, taxes_removed_cents: 0, total_cents: 175000, tax_cents: 24138,
      payment_method: 'cash', received_cents: 175000, change_cents: 0, balance_cents: 0, credit_cents: 0, due_date: null, delivery_status: 'pending', note: '',
    } as unknown as SaleDetail;
    const lines = htmlToLines(ticketHtml(sale, { ...DEFAULT_TICKET, footer: '¡Gracias por su compra!' }));
    const marked = ticketMarkup(lines, 48);
    const rule = `  ${'-'.repeat(44)}`;
    // Margen de 2 a cada lado (renglón útil de 44); la letra grande lleva 1 carácter grande de margen.
    expect(marked.split('\n')).toEqual([
      '  24 NOV 2026                    10:00:13 a.m.',
      ' Venta            **N1316**',
      rule,
      '  Cliente:                  **ROBERTO MOO MOLINA**',
      '  Celular:                          **9811236972**',
      '  Forma de Entrega:          Envío a Domicilio',
      '',
      '  Dirección de Entrega:',
      '  **PROL PEDRO MORENO ENTRE C 6 Y PRIV CRISANTO,**',
      '  **SAN RAFAEL**',
      rule,
      '  ITEM                                  PRECIO',
      rule,
      '  **CEMENTO MAYA 25 KG CEMEX**',
      '  **8 x $150.00**                        $1,200.00',
      '',
      '  **POLVO POR METRO**',
      '  **1 Metro. x $550.00/Metro.**            $550.00',
      rule,
      '  Número de artículos: 9   Subtotal: $1,750.00',
      rule,
      ' **TOTAL        $1,750.00**',
      '                   IVA 16% (incluido): $241.38',
      rule,
      '               Entrega Pendiente',
      rule,
      '  Efectivo:                          $1,750.00',
      '  Cambio:                                $0.00',
      rule,
      '            ¡Gracias por su compra!',
    ]);
    expect(ticketText(lines, 48).split('\n').every((l) => l.length <= 46)).toBe(true);
  });

  it('letra más grande: folio a doble ancho y alto, materiales a doble alto (mismo ancho)', () => {
    const tall = Array.from(escpos([{ type: 'text', text: 'BLOCK', tall: true }], { columns: 48, cut: false }));
    expect(tall.join(',')).toContain([0x1d, 0x21, 0x01].join(','));
    expect(ticketText([{ type: 'row', left: '8 x $150.00', right: '$1,200.00', tall: true }], 48)).toHaveLength(46);
    expect(ticketText([{ type: 'row', left: 'Venta', right: 'N1301', big: true }], 48)).toHaveLength(23);
    expect([clampCopies(0), clampCopies(3), clampCopies(9), clampCopies('x')]).toEqual([1, 3, 5, 1]);
  });

  it('acceso de mostrador: impresora predeterminada y navegador con impresión directa', () => {
    const cmd = mostradorLauncher('http://192.168.1.141:3000/pos/', 'WL88S');
    expect(cmd).toContain('PrintUIEntry /y /n "WL88S"');
    expect(cmd).toContain('--kiosk-printing');
    expect(cmd).toContain('--app="http://192.168.1.141:3000/pos/"');
    expect(cmd.split('\r\n').length).toBeGreaterThan(5);
    expect(mostradorLauncher('http://x/', 'A"&B')).toContain('"AB"');
  });
});
