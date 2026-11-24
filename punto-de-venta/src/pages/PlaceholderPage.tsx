import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { Page, PageHeader } from '@/components/layout/Page';

/** Página reservada para un módulo de una etapa posterior. */
export function PlaceholderPage({ title, stage }: { title: string; stage: number }) {
  return (
    <Page>
      <PageHeader title={title} />
      <Card>
        <EmptyState title={`${title} llega en la Etapa ${stage}`} description="La navegación y el diseño ya están listos; el contenido se construye en su etapa." />
      </Card>
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold text-gray-900">Página no encontrada</h1>
      <p className="mt-3 text-sm text-gray-500">Lo sentimos, no hemos encontrado la página que buscas</p>
    </div>
  );
}
