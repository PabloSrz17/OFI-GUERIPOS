import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Calculator, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { CashFlowDialog, ExpectedDialog, FlowBadge, MethodIcon, money } from '@/components/cash/CashDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import type { CashMethod } from '@/domain/sale';
import { paymentMethodLabel } from '@/domain/sale';
import { currentCash, periodMovements, voidCashFlow, type CashMovementRow, type ExpectedBreakdown } from '@/repos/cash';

/** Tabla "Total Esperado" (G-cash-current.png) y su variante con recuento (H-cash-cut-detail.png). */
export function ExpectedCard({ breakdown, onOpen }: { breakdown: ExpectedBreakdown[]; onOpen: (m: CashMethod) => void }) {
  const total = breakdown.reduce((a, b) => a + b.expected, 0);
  return (
    <Card className="p-6">
      <Table>
        <THead>
          <tr>
            <TH>
              <span className="sr-only">Método</span>
            </TH>
            <TH align="right" className="pr-6">
              Total Esperado
            </TH>
          </tr>
        </THead>
        <TBody>
          {breakdown.map((b) => (
            <TR key={b.method}>
              <TD className="py-4">
                <span className="flex items-center gap-4 text-gray-900">
                  <MethodIcon method={b.method} />
                  {paymentMethodLabel(b.method)}
                </span>
              </TD>
              <TD align="right" className="pr-6">
                <button
                  type="button"
                  aria-label={`Ver desglose de ${paymentMethodLabel(b.method)}`}
                  onClick={() => onOpen(b.method)}
                  className="rounded px-1 font-medium text-gray-900 hover:text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {money(b.expected)}
                </button>
              </TD>
            </TR>
          ))}
          <tr className="bg-gray-50">
            <TD className="py-3.5">
              <span className="flex items-center gap-4 font-semibold text-gray-900">
                <MethodIcon method="total" />
                Total
              </span>
            </TD>
            <TD align="right" className="pr-6 font-semibold text-gray-900" data-testid="cash-total">
              {money(total)}
            </TD>
          </tr>
        </TBody>
      </Table>
    </Card>
  );
}

/** Tabla "Ingresos y Retiros de Efectivo". */
export function FlowsCard({ flows, onDelete }: { flows: CashMovementRow[]; onDelete?: (m: CashMovementRow) => void }) {
  return (
    <Card className="p-6">
      <h3 className="mb-4 text-base font-semibold text-gray-900">Ingresos y Retiros de Efectivo</h3>
      {flows.length === 0 ? (
        <p className="text-sm text-gray-500">No hay ingresos ni retiros de efectivo en este periodo.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Vendedor</TH>
              <TH align="center">Movimiento</TH>
              <TH align="center">Valor</TH>
              <TH align="center">Detalles</TH>
              {onDelete && (
                <TH>
                  <span className="sr-only">Eliminar</span>
                </TH>
              )}
            </tr>
          </THead>
          <TBody>
            {flows.map((f) => (
              <TR key={f.id} data-testid="cash-flow">
                <TD>{f.user_name}</TD>
                <TD align="center">
                  <FlowBadge type={f.type} />
                </TD>
                <TD align="center" className="whitespace-nowrap">
                  {money(f.amount_cents, true)}
                </TD>
                <TD align="center" className="max-w-[180px] break-words">
                  {f.description}
                </TD>
                {onDelete && (
                  <TD align="right">
                    <button type="button" aria-label={`Eliminar ${f.type === 'cash_in' ? 'ingreso' : 'retiro'} de ${money(Math.abs(f.amount_cents))}`} onClick={() => onDelete(f)} className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                      <Trash2 className="size-5" />
                    </button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

export function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-gray-900">{children}</div>
    </Card>
  );
}

export function SideRow({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
}

/** Caja actual (G-cash-current.png). */
export function CashPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const data = useLiveQuery(currentCash, []);
  const [flow, setFlow] = React.useState<'cash_in' | 'cash_out' | null>(null);
  const [lastFlow, setLastFlow] = React.useState<'cash_in' | 'cash_out'>('cash_in');
  const [detail, setDetail] = React.useState<CashMethod | null>(null);
  const [toVoid, setToVoid] = React.useState<CashMovementRow | null>(null);
  const movements = useLiveQuery((tx) => (data && detail ? periodMovements(tx, data.registerId, null, detail) : []), [data?.registerId, detail]);

  if (!data) return null;
  const openFlow = (t: 'cash_in' | 'cash_out') => {
    setLastFlow(t);
    setFlow(t);
  };

  return (
    <Page width="narrow">
      <PageHeader
        className="flex-nowrap items-start pt-12"
        title={data.registerName}
        description={<span className="block max-w-[310px]">Registra ingresos y egresos en efectivo de tu caja chica</span>}
        actions={
          <>
            <Button onClick={() => openFlow('cash_in')}>
              <ArrowUp />
              Ingresar Efectivo
            </Button>
            <Button onClick={() => openFlow('cash_out')}>
              <ArrowDown />
              Retirar Efectivo
            </Button>
            <Button variant="primary" onClick={() => navigate('/cash/cut')}>
              <Calculator />
              Hacer Corte de Caja
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <ExpectedCard breakdown={data.breakdown} onOpen={setDetail} />
          <FlowsCard flows={data.flows} onDelete={setToVoid} />
        </div>
        <div className="w-full shrink-0 lg:w-[288px]">
          <SideCard title="Efectivo">
            <SideRow label="Al inicio" value={money(data.breakdown[0].start)} />
          </SideCard>
        </div>
      </div>

      <CashFlowDialog type={flow ?? lastFlow} open={flow !== null} onOpenChange={(o) => !o && setFlow(null)} cashExpected={data.breakdown[0].expected} />
      <ExpectedDialog breakdown={data.breakdown.find((b) => b.method === detail) ?? null} movements={movements ?? []} open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} />
      <ConfirmDialog
        open={!!toVoid}
        onOpenChange={(o) => !o && setToVoid(null)}
        title={toVoid?.type === 'cash_in' ? 'Eliminar ingreso' : 'Eliminar retiro'}
        description={toVoid && `Se anulará ${toVoid.type === 'cash_in' ? 'el ingreso' : 'el retiro'} de ${money(Math.abs(toVoid.amount_cents))} (${toVoid.description}). Queda registrado en los movimientos de la caja.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!toVoid) return;
          try {
            await db.write((tx) => voidCashFlow(tx, toVoid.id));
            toast.success(toVoid.type === 'cash_in' ? 'Ingreso eliminado' : 'Retiro eliminado');
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Page>
  );
}
