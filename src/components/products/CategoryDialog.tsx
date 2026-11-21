import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ImagePicker } from '@/components/ui/image-picker';
import { useToast } from '@/components/ui/feedback';
import { useDb } from '@/db/hooks';
import { createCategory, updateCategory, type Category } from '@/repos/categories';

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Con categoría: "Editar Categoría" / Guardar Cambios. Sin ella: "Crear Categoría". */
  category?: Pick<Category, 'id' | 'name' | 'image'> | null;
  initialName?: string;
  onSaved?: (id: string, name: string) => void;
}

/**
 * Modal Crear / Editar Categoría (E-category-add-modal.png, E-category-edit-modal.png).
 * Se omite "Mostrar en el Catálogo en Línea": esta app no tiene catálogo en línea (decisions.md D6).
 */
export function CategoryDialog({ open, onOpenChange, category, initialName = '', onSaved }: CategoryDialogProps) {
  const db = useDb();
  const toast = useToast();
  const [name, setName] = React.useState('');
  const [image, setImage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setName(category?.name ?? initialName);
      setImage(category?.image ?? null);
      setError(null);
    }
  }, [open, category, initialName]);

  const editing = !!category;
  const changed = editing ? name.trim() !== category!.name || image !== category!.image : true;
  const canSave = name.trim() !== '' && changed && !busy;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSave) return;
    setBusy(true);
    try {
      const id = await db.write((tx) => {
        if (editing) {
          updateCategory(tx, category!.id, { name, image });
          return category!.id;
        }
        return createCategory(tx, { name, image });
      });
      toast.success(editing ? 'Categoría actualizada' : 'Categoría creada');
      onSaved?.(id, name.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Editar Categoría' : 'Crear Categoría'}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!canSave} onClick={() => save()}>
              {editing ? 'Guardar Cambios' : 'Crear Categoría'}
            </Button>
          </>
        }
      >
        <form className="space-y-5" onSubmit={save}>
          <ImagePicker className="h-[120px]" value={image} onChange={setImage} label="Añadir Imagen" onError={toast.error} />
          <Field label="Nombre de la Categoría" htmlFor="category-name" error={error}>
            <Input
              id="category-name"
              ref={nameRef}
              placeholder="Indicar nombre"
              value={name}
              aria-invalid={!!error}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
