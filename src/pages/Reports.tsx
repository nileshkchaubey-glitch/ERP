import { useEffect, useState } from 'react';
import {
  reportService,
  type SalesByDay, type SalesByMonth, type SalesByCustomer,
  type SalesByItem, type GstSummaryRow, type LowStockRow, type DeadStockRow
} from '../lib/reportService';
import { toCsv, downloadCsv } from '../lib/csv';
import { PageHeader, PageBody, RoleGate, Empty, Loading, ErrorState, Button, Input, Select, Field, fmtCurrency, fmtDate } from '../components/ui';

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function Reports() {
  return (
    <RoleGate allow={['owner', 'admin']} fallback={
      <>
        <PageHeader title="📈 Reports" />
        <PageBody>
          <div className="card text-center text-slate-500 py-10">
            Reports are only visible to an owner or admin.
          </div>
        </PageBody>
      </>
    }>
      <ReportsInner />
    </RoleGate>
  );
}

function ReportsInner() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));

  return (
    <>
      <PageHeader title="📈 Reports" subtitle="Sales, GST and stock insight" />
      <PageBody>
        <div className="card mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              {[
                { label: '7D', days: 7 },
                { label: '30D', days: 30 },
                { label: '90D', days: 90 }
              ].map(p => (
                <Button key={p.label} size="sm" variant="outline" onClick={() => { setFrom(isoDaysAgo(p.days)); setTo(isoDaysAgo(0)); }}>
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <SalesSummarySection from={from} to={to} />
          <SalesByCustomerSection from={from} to={to} />
          <SalesByItemSection from={from} to={to} />
          <GstSummarySection from={from} to={to} />
          <LowStockSection />
          <DeadStockSection />
        </div>
      </PageBody>
    </>
  );
}

// ─── Shared section shell ───
function Section({ title, icon, action, children }: { title: string; icon: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-bold text-sm flex items-center gap-2">{icon} {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function daysBetween(from: string, to: string) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

// ─── Sales Summary (day or month granularity) ───
function SalesSummarySection({ from, to }: { from: string; to: string }) {
  const [dayRows, setDayRows] = useState<SalesByDay[] | null>(null);
  const [monthRows, setMonthRows] = useState<SalesByMonth[] | null>(null);
  const [err, setErr] = useState('');
  const monthly = daysBetween(from, to) > 60;

  async function load() {
    setErr('');
    setDayRows(null);
    setMonthRows(null);
    try {
      if (monthly) {
        setMonthRows(await reportService.salesByMonth(from, to));
      } else {
        setDayRows(await reportService.salesByDay(from, to));
      }
    } catch (e: any) {
      setErr(e.message || 'Failed to load sales summary');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const rows = monthly ? monthRows : dayRows;
  const totalAmount = (rows || []).reduce((s: number, r: any) => s + r.total, 0);
  const totalCount = (rows || []).reduce((s: number, r: any) => s + r.count, 0);
  const maxTotal = Math.max(1, ...(rows || []).map((r: any) => r.total));

  function exportCsv() {
    if (!rows) return;
    const columns = monthly
      ? [{ key: 'month', label: 'Month' }, { key: 'total', label: 'Total' }, { key: 'count', label: 'Invoices' }]
      : [{ key: 'date', label: 'Date' }, { key: 'total', label: 'Total' }, { key: 'count', label: 'Invoices' }];
    downloadCsv(`sales-summary-${from}-to-${to}.csv`, toCsv(rows, columns));
  }

  return (
    <Section title={`Sales Summary (${monthly ? 'monthly' : 'daily'})`} icon="💰"
      action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>}>
      {rows === null ? (
        <Loading msg="Loading sales summary…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="💰" title="No sales in this range" msg="Try widening the date range" />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">{monthly ? 'Month' : 'Date'}</th>
                <th className="text-right px-3 py-2.5">Invoices</th>
                <th className="text-right px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5 w-1/3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={monthly ? r.month : r.date} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{monthly ? r.month : fmtDate(r.date)}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-dark">{fmtCurrency(r.total)}</td>
                  <td className="px-3 py-2">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(r.total / maxTotal) * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right">{totalCount}</td>
                <td className="px-3 py-2.5 text-right text-brand-dark">{fmtCurrency(totalAmount)}</td>
                <td className="px-3 py-2.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Sales by Customer ───
function SalesByCustomerSection({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<SalesByCustomer[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    setRows(null);
    try {
      setRows(await reportService.salesByCustomer(from, to));
    } catch (e: any) {
      setErr(e.message || 'Failed to load sales by customer');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`sales-by-customer-${from}-to-${to}.csv`, toCsv(rows, [
      { key: 'customerName', label: 'Customer' },
      { key: 'total', label: 'Total' },
      { key: 'count', label: 'Invoices' }
    ]));
  }

  return (
    <Section title="Sales by Customer" icon="🧑‍🤝‍🧑"
      action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>}>
      {rows === null ? (
        <Loading msg="Loading sales by customer…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="🧑‍🤝‍🧑" title="No sales in this range" msg="Try widening the date range" />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">Customer</th>
                <th className="text-right px-3 py-2.5">Invoices</th>
                <th className="text-right px-3 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.customerId ?? r.customerName} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-brand-dark">{r.customerName}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtCurrency(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Sales by Item ───
function SalesByItemSection({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<SalesByItem[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    setRows(null);
    try {
      setRows(await reportService.salesByItem(from, to));
    } catch (e: any) {
      setErr(e.message || 'Failed to load sales by item');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`sales-by-item-${from}-to-${to}.csv`, toCsv(rows, [
      { key: 'itemName', label: 'Item' },
      { key: 'qty', label: 'Qty Sold' },
      { key: 'amount', label: 'Amount' }
    ]));
  }

  return (
    <Section title="Sales by Item" icon="📦"
      action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>}>
      {rows === null ? (
        <Loading msg="Loading sales by item…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="📦" title="No sales in this range" msg="Try widening the date range" />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">Item</th>
                <th className="text-right px-3 py-2.5">Qty Sold</th>
                <th className="text-right px-3 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.itemId ?? r.itemName} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{r.itemName}</td>
                  <td className="px-3 py-2 text-right">{r.qty}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-dark">{fmtCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── GST Summary ───
function GstSummarySection({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<GstSummaryRow[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    setRows(null);
    try {
      setRows(await reportService.gstSummary(from, to));
    } catch (e: any) {
      setErr(e.message || 'Failed to load GST summary');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const totalTaxable = (rows || []).reduce((s, r) => s + r.taxableAmount, 0);
  const totalTax = (rows || []).reduce((s, r) => s + r.taxAmount, 0);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`gst-summary-${from}-to-${to}.csv`, toCsv(rows, [
      { key: 'gstRate', label: 'GST Rate %' },
      { key: 'taxableAmount', label: 'Taxable Amount' },
      { key: 'taxAmount', label: 'Tax Amount' }
    ]));
  }

  return (
    <Section title="GST Summary" icon="🧾"
      action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>}>
      {rows === null ? (
        <Loading msg="Loading GST summary…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="🧾" title="No GST data in this range" msg="Try widening the date range" />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">GST Rate</th>
                <th className="text-right px-3 py-2.5">Taxable Amount</th>
                <th className="text-right px-3 py-2.5">Tax Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.gstRate} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{r.gstRate}%</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.taxableAmount)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-dark">{fmtCurrency(r.taxAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right">{fmtCurrency(totalTaxable)}</td>
                <td className="px-3 py-2.5 text-right text-brand-dark">{fmtCurrency(totalTax)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Low Stock (live, no date range) ───
function LowStockSection() {
  const [rows, setRows] = useState<LowStockRow[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    setRows(null);
    try {
      setRows(await reportService.lowStock());
    } catch (e: any) {
      setErr(e.message || 'Failed to load low stock');
    }
  }

  useEffect(() => { load(); }, []);

  function exportCsv() {
    if (!rows) return;
    downloadCsv('low-stock.csv', toCsv(rows, [
      { key: 'itemName', label: 'Item' },
      { key: 'quantity', label: 'Current Qty' },
      { key: 'reorderLevel', label: 'Reorder Level' }
    ]));
  }

  return (
    <Section title="Low Stock" icon="⚠️"
      action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>}>
      {rows === null ? (
        <Loading msg="Loading low stock…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="✅" title="Nothing low on stock" msg="All items are above their reorder level" />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">Item</th>
                <th className="text-right px-3 py-2.5">Current Qty</th>
                <th className="text-right px-3 py-2.5">Reorder Level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.itemId} className="border-t border-slate-100 bg-red-50/40">
                  <td className="px-3 py-2 font-semibold">{r.itemName}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{r.quantity}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{r.reorderLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Dead Stock (live, adjustable threshold) ───
function DeadStockSection() {
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState<DeadStockRow[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    setRows(null);
    try {
      setRows(await reportService.deadStock(days));
    } catch (e: any) {
      setErr(e.message || 'Failed to load dead stock');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`dead-stock-${days}d.csv`, toCsv(
      rows.map(r => ({ ...r, lastMovementDate: r.lastMovementDate ? r.lastMovementDate.slice(0, 10) : 'Never moved' })),
      [
        { key: 'itemName', label: 'Item' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'lastMovementDate', label: 'Last Movement' }
      ]
    ));
  }

  return (
    <Section title="Dead Stock" icon="📦"
      action={
        <div className="flex items-center gap-2">
          <Select value={days} onChange={e => setDays(+e.target.value)} className="w-auto">
            {[30, 60, 90, 120].map(d => <option key={d} value={d}>{d} days</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>⬇ Export CSV</Button>
        </div>
      }>
      {rows === null ? (
        <Loading msg="Loading dead stock…" />
      ) : err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : rows.length === 0 ? (
        <Empty icon="✅" title="No dead stock" msg={`Everything has moved in the last ${days} days`} />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="text-left px-3 py-2.5">Item</th>
                <th className="text-right px-3 py-2.5">Quantity</th>
                <th className="text-right px-3 py-2.5">Last Movement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.itemId} className="border-t border-slate-100 bg-amber-50/40">
                  <td className="px-3 py-2 font-semibold">{r.itemName}</td>
                  <td className="px-3 py-2 text-right font-bold text-amber-600">{r.quantity}</td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {r.lastMovementDate ? fmtDate(r.lastMovementDate.slice(0, 10)) : 'Never moved'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
