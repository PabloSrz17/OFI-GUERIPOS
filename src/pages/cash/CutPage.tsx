import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { InputGroup, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { DifferenceBadge, MethodIcon, money, parsePesos } from '@/components/cash/CashDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import type { CashMethod } from '@/domain/sale';
import { paymentMethodLabel } from '@/domain/sale';
import { uuid } from '@/lib/uuid';
import { createCut, currentCash } from '@/repos/cash';
import { printCutTicket } from '@/cash/cut-ticket';
import { SideCard, SideRow } from './CashPage';

const centsToText = (c: number) => (c / 100).toFixed(2);

/**
 * Hacer Corte de Caja: diseño propio (D1, D21). El usuario no autorizó abrir este formulario en Pulpos; los
 * campos salen del detalle de un corte (H-cash-cut-detail.png): Recuento Manual por método, retiro y restante.
 */
export function CutPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const data = useLiveQuery(currentCash, []);
  // El efectivo se cuenta a mano; los demás métodos empiezan con lo esperado y solo se corrigen si no cuadran (D19).
  const [counted, setCounted] = React.useState<Partial<Record<CashMethod, string>>>({});
  const [comments, setComments] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idRef = React.useRef(uuid());

  if (!data) return null;
  const valueOf = (m: CashMethod, expected: number) => {
    const text = counted[m];
    if (text === undefined) return m === 'cash' ? null : expected;
    return parsePesos(text);
  };
  const lines = data.breakdown.map((b) => {
    const c = valueOf(b.method, b.expected);
    return { ...b, counted: c, difference: c === null ? null : c - b.expected };
  });
  const cashCounted = lines[0].counted;
  const ready = lines.every((l) => l.counted !== null && l.counted >= 0);
  const totalCounted = lines.reduce((a, l) => a + (l.counted ?? 0), 0);
  const totalDiff = totalCounted - data.total;

  const submit = async () => {
    try {
      const r = await db.write((tx) =>
        createCut(tx, { id: idRef.current, counted: Object.fromEntries(lines.map((l) => [l.method, l.counted ?? 0])), comments }),
      );
      toast.success(`Corte de caja #${r.folio} realizado`);
      navigate(`/cash/history/detail?id=${r.id}`, { replace: true });
      printCutTicket(db.read.bind(db), r.id).catch((e) => toast.error(e));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Page width="narrow">
      <PageHeader back="/cash" title="Hacer Corte de Caja" />
      {data.movementCount === 0 ? (
        <Card>
          <EmptyState title="No hay movimientos desde el último corte" description="Cuando registres ventas, ingresos o retiros, aquí podrás hacer el corte." actions={<Button onClick={() => navigate('/cash/history')}>Ver Cortes Históricos</Button>} />
        </Card>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <Card className="p-6">
              <p className="mb-4 text-sm text-gray-600">Cuenta el efectivo de la caja y revisa los comprobantes de tarjeta y transferencias. Captura lo que contaste en cada método.</p>
              <Table>
                <THead>
                  <tr>
                    <TH>
                      <span className="sr-only">Método</span>
                    </TH>
                    <TH align="right">Total Esperado</TH>
                    <TH align="right">Recuento Manual</TH>
                    <TH align="center">Diferencia</TH>
                  </tr>
                </THead>
                <TBody>
                  {lines.map((l) => (
                    <TR key={l.method}>
                      <TD>
                        <span className="flex items-center gap-3 text-gray-900">
                          <MethodIcon method={l.method} />
                          {paymentMethodLabel(l.method)}
                        </span>
                      </TD>
                      <TD align="right" className="text-gray-900">
                        {money(l.expected)}
                      </TD>
                      <TD align="right" className="w-44 py-2">
                        <InputGroup
                          aria-label={`Recuento de ${paymentMethodLabel(l.method)}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          prefix="$"
                          placeholder="0.00"
                          className="text-right"
                          value={counted[l.method] ?? (l.method === 'cash' ? '' : centsToText(l.expected))}
                          onChange={(e) => setCounted({ ...counted, [l.method]: e.target.value })}
                          autoFocus={l.method === 'cash'}
                        />
                      </TD>
                      <TD align="center" data-testid={`diff-${l.method}`}>
                        {l.difference === null ? <span className="text-gray-400">—</span> : <DifferenceBadge cents={l.difference} />}
                      </TD>
                    </TR>
                  ))}
                  <tr className="bg-gray-50">
                    <TD>
                      <span className="flex items-center gap-3 font-semibold text-gray-900">
                        <MethodIcon method="total" />
                        Total
                      </span>
                    </TD>
                    <TD align="right" className="font-semibold text-gray-900">
                      {money(data.total)}
                    </TD>
                    <TD align="right" className="pr-4 font-semibold text-gray-900" data-testid="counted-total">
                      {ready ? money(totalCounted) : '—'}
                    </TD>
                    <TD align="center">{ready && <DifferenceBadge cents={totalDiff} />}</TD>
                  </tr>
                </TBody>
              </Table>
            </Card>
            <Card className="p-6">
              <Field label={<>Comentarios<span className="font-normal text-gray-400">(opcional)</span></>} htmlFor="cut-comments">
                <Textarea id="cut-comments" rows={3} maxLength={500} placeholder="Ej: Faltó cambio de $50" value={comments} onChange={(e) => setComments(e.target.value)} />
              </Field>
            </Card>
          </div>
          <div className="w-full shrink-0 space-y-4 lg:w-[288px]">
            <SideCard title="Efectivo">
              <SideRow label="Al inicio" value={money(data.breakdown[0].start)} />
              <SideRow label="Retiro por corte" value={cashCounted === null ? '—' : money(Math.max(cashCounted, 0))} testId="withdrawn" />
              <SideRow label="Restante en caja" value={money(0)} />
              <p className="pt-1 text-xs text-gray-500">Se retira todo el efectivo contado; el siguiente periodo empieza en $0.00.</p>
            </SideCard>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              variant="primary"
              className="w-full"
              disabled={!ready}
              onClick={() => {
                setError(null);
                if (!ready) return setError('Captura el recuento de cada método');
                setConfirm(true);
              }}
            >
              <Calculator />
              Confirmar Corte
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="primary"
        title="Confirmar corte de caja"
        description={`${totalDiff === 0 ? 'El recuento cuadra con lo esperado.' : `${totalDiff < 0 ? 'Faltan' : 'Sobran'} ${money(Math.abs(totalDiff))} contra lo esperado.`} Se retirarán ${money(cashCounted ?? 0)} en efectivo y el corte ya no se podrá modificar.`}
        confirmLabel="Hacer Corte"
        onConfirm={submit}
      />
    </Page>
  );
}
