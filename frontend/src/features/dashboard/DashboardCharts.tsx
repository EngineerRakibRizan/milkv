import { useTranslation } from 'react-i18next'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '@/components/ui'
import { money, num } from '@/lib/format'
import type { Dashboard } from './DashboardPage'

export const PALETTE = ['#166534', '#22c55e', '#0ea5e9', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b']
const axis = { fontSize: 11, fill: 'var(--muted)' }
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }

export default function DashboardCharts({ data }: { data: Dashboard }) {
  const { t } = useTranslation()
  const trend = data.milk.trend.map((d) => ({ day: d.date.slice(8), produced: Number(d.produced), delivered: Number(d.delivered) }))
  const f = data.finance
  const monthly = f?.monthly.map((m) => ({ month: m.month.slice(5), revenue: Number(m.revenue), expenses: Number(m.expenses), profit: Number(m.profit) })) ?? []
  const mix = f?.expense_mix.map((e) => ({ name: e.name, value: Number(e.amount) })).sort((a, b) => b.value - a.value) ?? []
  const population = data.population.filter((p) => p.value > 0).map((p) => ({ ...p, label: t(`dashboard.${p.name}`, p.name) }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('dashboard.milkTrend')}>
        <div className="h-64 p-2 pr-4">
          <ResponsiveContainer>
            <AreaChart data={trend} margin={{ top: 10, left: -10 }}>
              <defs>
                <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} interval={4} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v as number, 1)} L`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="produced" name={t('milk.produced', 'Produced')} stroke="#166534" fill="url(#gp)" strokeWidth={2} />
              <Area type="monotone" dataKey="delivered" name={t('milk.delivered', 'Delivered')} stroke="#0ea5e9" fill="transparent" strokeWidth={2} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {f ? (
        <Card title={t('dashboard.revVsExp')}>
          <div className="h-64 p-2 pr-4">
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 10, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => num(v / 1000, 0) + 'k'} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name={t('reports.revenue', 'Revenue')} fill="#166534" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name={t('reports.expenses', 'Expenses')} fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : (
        <PopulationChart data={population} title={t('dashboard.population')} />
      )}

      {f && mix.length > 0 && (
        <Card title={t('dashboard.expenseMix')}>
          <div className="flex h-64 items-center p-2">
            <ResponsiveContainer width="55%">
              <PieChart>
                <Pie data={mix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                  {mix.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v as number)} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="w-[45%] space-y-1.5 text-xs">
              {mix.slice(0, 7).map((m, i) => (
                <li key={m.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="truncate">{m.name}</span>
                  <span className="tabular ml-auto text-muted">{money(m.value, { compact: true })}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
      {f && <PopulationChart data={population} title={t('dashboard.population')} />}
    </div>
  )
}

function PopulationChart({ data, title }: { data: Array<{ label: string; value: number }>; title: string }) {
  return (
    <Card title={title}>
      <div className="h-64 p-2 pr-4">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={70} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
