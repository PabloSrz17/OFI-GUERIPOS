import * as React from 'react';
import { cn } from '@/lib/utils';

export interface AreaPoint {
  label: string; // etiqueta del eje X ("15 nov")
  value: number;
}

interface AreaChartProps {
  data: AreaPoint[];
  height?: number;
  formatY?: (v: number) => string;
  formatValue?: (v: number) => string;
  className?: string;
  'aria-label': string;
}

// right ≥ media etiqueta ("21 nov") para que la última fecha centrada no se recorte.
const PAD = { top: 12, right: 28, bottom: 28, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 5;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const steps = [1, 2, 2.5, 5, 10];
  const n = steps.find((s) => s * exp >= v)!;
  return n * exp;
}

/** Curva suavizada (monótona) que no se pasa de los datos, como el gráfico de área de Pulpos. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const dy = pts.slice(1).map((p, i) => p[1] - pts[i][1]);
  const m = dx.map((d, i) => dy[i] / d);
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** Gráfico de área de una sola serie (sky-600, 2px) con cuadrícula tenue y tooltip con línea guía al pasar el mouse. */
export function AreaChart({ data, height = 240, formatY = String, formatValue = String, className, ...aria }: AreaChartProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  const [hover, setHover] = React.useState<number | null>(null);
  const gid = React.useId().replace(/:/g, '');

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, 1, 2, 3, 4, 5].map((i) => (max / 5) * i);
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? iw / 2 : (iw * i) / (data.length - 1));
  const y = (v: number) => PAD.top + ih - (ih * v) / max;
  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);
  const line = smoothPath(pts);
  const area = line ? `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px) / rect.width) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  return (
    <div ref={ref} className={cn('relative w-full', className)}>
      <svg width={width} height={height} role="img" aria-label={aria['aria-label']} className="block">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0284C7" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0284C7" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#F3F4F6" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-gray-500 text-xs">
              {formatY(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={d.label}
            x={x(i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-gray-500 text-xs"
          >
            {d.label}
          </text>
        ))}
        {area && <path d={area} fill={`url(#g${gid})`} />}
        {line && <path d={line} fill="none" stroke="#0284C7" strokeWidth={2} strokeLinecap="round" />}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="#9CA3AF" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r={5} fill="#0284C7" stroke="#fff" strokeWidth={2} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: x(hover), top: y(data[hover].value) - 10 }}
        >
          <div className="text-gray-300">{data[hover].label}</div>
          <div className="font-semibold">{formatValue(data[hover].value)}</div>
        </div>
      )}
    </div>
  );
}
