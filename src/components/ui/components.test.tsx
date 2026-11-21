import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { Button } from './button';
import { StockBadge } from './badge';
import { Pagination, pageItems } from './pagination';
import { Segmented } from './segmented';

describe('pageItems', () => {
  it('muestra todas si son pocas', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('1 2 3 … N como en Pulpos', () => {
    expect(pageItems(1, 29)).toEqual([1, 2, 3, 'gap', 29]);
    expect(pageItems(15, 29)).toEqual([1, 2, 3, 'gap', 14, 15, 16, 'gap', 29]);
  });
});

describe('Pagination', () => {
  it('deshabilita Anterior en la primera página y avanza', async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} totalPages={3} onPageChange={onChange} />);
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

describe('Button', () => {
  it('es type="button" por defecto para no enviar formularios por accidente', () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'button');
  });
});

describe('StockBadge', () => {
  it('verde con stock, rojo con 0 o negativo', () => {
    render(
      <>
        <StockBadge quantity={3} label="3 unidades" />
        <StockBadge quantity={0} label="0 unidades" />
        <StockBadge quantity={-4} label="-4 unidades" />
      </>,
    );
    expect(screen.getByText('3 unidades').className).toContain('bg-green-100');
    expect(screen.getByText('0 unidades').className).toContain('bg-red-100');
    expect(screen.getByText('-4 unidades').className).toContain('bg-red-100');
  });
});

describe('Segmented', () => {
  it('marca la opción activa y cambia al hacer clic', async () => {
    function Demo() {
      const [v, setV] = React.useState<'a' | 'b'>('a');
      return <Segmented aria-label="modo" value={v} onChange={setV} options={[{ value: 'a', label: 'Venta' }, { value: 'b', label: 'Pedido' }]} />;
    }
    render(<Demo />);
    expect(screen.getByRole('radio', { name: 'Venta' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Pedido' }));
    expect(screen.getByRole('radio', { name: 'Pedido' })).toHaveAttribute('aria-checked', 'true');
  });
});
