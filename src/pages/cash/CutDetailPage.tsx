import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Printer } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/feedback';
import { DifferenceBadge, ExpectedDialog, MethodIcon, MovementsDialog, money } from '@/components/cash/CashDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import type { CashMethod } from '@/domain/sale';
import { paymentMethodLabel } from '@/domain/sale';
import { cutRegisterId, getCut, periodMovements } from '@/repos/cash';
import { printCutTicket } from '@/cash/cut-ticket';
import { FlowsCard, SideCard, SideRow } from './CashPage';

/** "20 de noviembre de 2026 a las 5:07:58 p.m." */
const longDate = (iso: string) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  return `${date} a las ${time}`;
};

/** Detalle de Corte de Caja (H-cash-cut-detail.png). Sin "Más Acciones": un corte no se edita ni se elimina. */
export function CutDetailPage() {
  const db = useDb();
  const toast = useToast();
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const cut = useLiveQuery((tx) => getCut(tx, id), [id]);
  const [detail, setDetail] = React.useState<CashMethod | null>(null);
  const [all, setAll] = React.useState(false);
  const movements = useLiveQuery(
    (tx) => {
      const reg = detail || all ? cutRegisterId(tx, id) : null;
      return reg ? periodMovements(tx, reg, id, detail ?? undefined) : [];
    },
    [id, detail, all],
  );

  if (cut === undefined) return null;
  if (cut === null)
    return (
      <Page width="narrow">
        <PageHeader back="/cash/history" title="Detalle de Corte de Caja" />
        <Card>
          <EmptyState title="Corte no encontrado" />
        </Card>
      </Page>
    );
  const imported = cut.source === 'pulpos';

  return (
    <Page width="narrow">
      <PageHeader
        back="/cash/history"
        title="Detalle de Corte de Caja"
        actions={
          <>
            {!imported && (
              <Button onClick={() => setAll(true)}>
                <ArrowDownUp />
                Ver Movimientos
              </Button>
            )}
            <Button variant="primary" onClick={() => printCutTicket(db.read.bind(db), cut.id).catch((e) => toast.error(e))}>
              <Printer />
              Imprimir Ticket
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <Card className="p-6">
            <Table>
              <THead>
                <tr>
                  <TH>
                    <span className="sr-only">Método</span>
                  </TH>
                  <TH align="center">Recuento Manual</TH>
                  <TH align="center">Total Esperado</TH>
                  <TH align="center">Diferencia</TH>
                </tr>
              </THead>
              <TBody>
                {cut.lines.map((l) => (
                  <TR key={l.method}>
                    <TD>
                      <span className="flex items-center gap-4 text-gray-900">
                        <MethodIcon method={l.method} />
                        {paymentMethodLabel(l.method)}
                      </span>
                    </TD>
                    <TD align="center" className="text-gray-900">
                      {money(l.counted_cents)}
                    </TD>
                    <TD align="center">
                      {imported ? (
                        <span className="font-medium text-gray-900">{money(l.expected_cents)}</span>
                      ) : (
                        <button type="button" aria-label={`Ver desglose de ${paymentMethodLabel(l.method)}`} onClick={() => setDetail(l.method)} className="rounded px-1 font-medium text-gray-900 hover:text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                          {money(l.expected_cents)}
                        </button>
                      )}
                    </TD>
                    <TD align="center">{l.counted_cents !== l.expected_cents && <DifferenceBadge cents={l.counted_cents - l.expected_cents} />}</TD>
                  </TR>
                ))}
                <tr className="bg-gray-50">
                  <TD>
                    <span className="flex items-center gap-4 font-semibold text-gray-900">
                      <MethodIcon method="total" />
                      Total
                    </span>
                  </TD>
                  <TD align="center" className="font-semibold text-gray-900">
                    {money(cut.counted_cents)}
                  </TD>
                  <TD align="center" className="font-semibold text-gray-900">
                    {money(cut.expected_cents)}
                  </TD>
                  <TD align="center" data-testid="cut-difference">
                    <DifferenceBadge cents={cut.difference_cents} />
                  </TD>
                </tr>
              </TBody>
            </Table>
          </Card>
          {!imported && <FlowsCard flows={cut.flows} />}
        </div>
        <div className="w-full shrink-0 space-y-4 lg:w-[288px]">
          <SideCard title="Información">
            <p>{cut.register_name}</p>
            <p>{longDate(cut.created_at)}</p>
            <p className="text-gray-600">
              Corte #{cut.folio} · {cut.user_name}
            </p>
          </SideCard>
          <SideCard title="Efectivo">
            <SideRow label="Al inicio" value={money(cut.start_cents)} />
            <SideRow label="Retiro por corte" value={money(cut.withdrawn_cents)} testId="withdrawn" />
            <SideRow label="Restante en caja" value={money(cut.remaining_cents)} />
          </SideCard>
          {imported && (
            <SideCard title="Importado de Pulpos">
              <p className="text-gray-600">Este corte se hizo en Pulpos. Se conservan lo esperado y lo contado por método; sus movimientos se quedaron en Pulpos.</p>
            </SideCard>
          )}
          {cut.comments && (
            <SideCard title="Comentarios">
              <p className="whitespace-pre-line text-gray-700">{cut.comments}</p>
            </SideCard>
          )}
        </div>
      </div>
      <ExpectedDialog breakdown={cut.breakdown.find((b) => b.method === detail) ?? null} movements={movements ?? []} open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} />
      <MovementsDialog movements={movements ?? []} open={all} onOpenChange={setAll} />
    </Page>
  );
}
