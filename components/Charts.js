'use client';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Sankey,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { colorOf } from '../lib/categories.js';
import { eur, monthLabel } from '../lib/format.js';

const TIP = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ink)' };
const TICK = { fontSize: 12, fill: 'var(--muted)' };
const Empty = () => <p className="muted pad">Aucune donnée sur cette sélection.</p>;
const short = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.0', '')} k` : v);

export function CategoryPie({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty />;
  return (
    <div className="pie">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="92%" paddingAngle={1} stroke="none" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={colorOf(d.name)} />)}
          </Pie>
          <Tooltip formatter={(v) => eur(v)} contentStyle={TIP} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.name}>
            <i style={{ background: colorOf(d.name) }} />
            <span>{d.name}</span>
            <b>{eur(d.value)}</b>
            <em>{Math.round((d.value / total) * 100)} %</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SankeyNode({ x, y, width, height, payload }) {
  const left = payload.depth === 0;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={colorOf(payload.name)} rx={2} />
      <text
        x={left ? x - 6 : x + width + 6} y={y + height / 2} dy="0.35em" fontSize={12}
        textAnchor={left ? 'end' : 'start'} fill="var(--ink)"
        stroke="var(--surface)" strokeWidth={3} paintOrder="stroke"
      >
        {payload.name} {eur(payload.value)}
      </text>
    </g>
  );
}

export function FlowSankey({ data }) {
  if (!data) return <Empty />;
  return (
    <div className="scroll-x">
      <div style={{ minWidth: 620 }}>
        <ResponsiveContainer width="100%" height={Math.max(320, data.nodes.length * 34)}>
          <Sankey
            data={data} nodePadding={18} nodeWidth={10} iterations={64}
            margin={{ top: 8, right: 170, bottom: 8, left: 130 }}
            link={{ stroke: '#7f908a', strokeOpacity: 0.3 }}
            node={<SankeyNode />}
          >
            <Tooltip formatter={(v) => eur(v)} contentStyle={TIP} />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendLines({ data, series }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={TICK} />
        <YAxis width={48} tickFormatter={short} tick={TICK} />
        <Tooltip labelFormatter={monthLabel} formatter={(v) => eur(v)} contentStyle={TIP} />
        <Legend />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
            strokeWidth={2} strokeDasharray={s.dash} dot={{ r: 3 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PivotTable({ data }) {
  const { months, income, expense, tot, grand } = data;
  if (!months.length) return <Empty />;
  const cell = (v) => (v ? eur(v) : '–');
  const lines = (list) => list.map((o) => (
    <tr key={o.name}>
      <td>{o.name}</td>
      {months.map((m) => <td key={m}>{cell(o.values[m])}</td>)}
      <td><b>{eur(o.total)}</b></td>
    </tr>
  ));
  const sumRow = (label, key, cls) => (
    <tr className={cls}>
      <td>{label}</td>
      {months.map((m) => <td key={m}>{eur(tot[key][m])}</td>)}
      <td>{eur(grand[key])}</td>
    </tr>
  );
  const sec = (t) => <tr className="sec"><td colSpan={months.length + 2}>{t}</td></tr>;
  return (
    <div className="scroll-x">
      <table className="pivot">
        <thead>
          <tr><th>Catégorie</th>{months.map((m) => <th key={m}>{monthLabel(m)}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {income.length > 0 && sec('Revenus')}{lines(income)}
          {expense.length > 0 && sec('Dépenses')}{lines(expense)}
          {sumRow('Total revenus', 'income', 'sum')}
          {sumRow('Total dépenses', 'expense', 'sum')}
          {sumRow('Solde', 'net', 'sum')}
        </tbody>
      </table>
    </div>
  );
}
