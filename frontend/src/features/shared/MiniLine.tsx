import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { num } from '@/lib/format'

/** Small single-series trend chart, loaded lazily with the charts chunk. */
export default function MiniLine({ data, unit, height = 240 }: { data: Array<{ x: string; y: number }>; unit?: string; height?: number }) {
  return (
    <div style={{ height }} className="p-2 pr-4">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, left: -10 }}>
          <defs><linearGradient id="ml" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} formatter={(v) => `${num(v as number, 1)}${unit ? ' ' + unit : ''}`} />
          <Area type="monotone" dataKey="y" stroke="#166534" fill="url(#ml)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
