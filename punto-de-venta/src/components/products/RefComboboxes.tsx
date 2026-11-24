import * as React from 'react';
import { Archive, Award } from 'lucide-react';
import { CreatableCombobox, type ComboValue } from '@/components/ui/combobox';
import { useLiveQuery } from '@/db/hooks';
import { listBrands, listCategories } from '@/repos/categories';
import { CategoryDialog } from './CategoryDialog';

/** "Buscar o crear categoría": con texto, la categoría se crea al guardar el producto; sin texto, abre el modal. */
export function CategoryCombobox({ id, value, onChange }: { id: string; value: ComboValue; onChange: (v: ComboValue) => void }) {
  const categories = useLiveQuery(listCategories, []) ?? [];
  const [dialog, setDialog] = React.useState(false);
  return (
    <>
      <CreatableCombobox
        id={id}
        items={categories}
        value={value}
        onChange={onChange}
        placeholder="Buscar o crear categoría"
        createLabel="Crear categoría"
        itemIcon={<Archive />}
        onCreateEmpty={() => setDialog(true)}
      />
      <CategoryDialog open={dialog} onOpenChange={setDialog} onSaved={(cid, name) => onChange({ id: cid, name })} />
    </>
  );
}

export function BrandCombobox({ id, value, onChange }: { id: string; value: ComboValue; onChange: (v: ComboValue) => void }) {
  const brands = useLiveQuery(listBrands, []) ?? [];
  return <CreatableCombobox id={id} items={brands} value={value} onChange={onChange} placeholder="Buscar o crear marca" createLabel="Crear marca" itemIcon={<Award />} />;
}
