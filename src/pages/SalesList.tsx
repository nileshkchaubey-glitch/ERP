import { useEffect, useState, useCallback, useRef } from 'react';
import { invoiceService } from '../lib/erpServices';
import { paymentService } from '../lib/paymentService';
import { orgService } from '../lib/orgService';
import { useOrg } from '../lib/orgContext';
import { agingSummary } from '../lib/aging';
import type { Invoice, InvoiceItem } from '../lib/supabase';
import { PageHeader, PageBody, Empty, Loading, ErrorState, Stat, Button, Pagination, fmtCurrency, fmtDate } from '../components/ui';
import { toCsv, downloadCsv } from '../lib/csv';
import { Link } from 'wouter';

const PAGE_SIZE = 50;

export function SalesList() {
  const { orgId } = useOrg();
  const [invoices, setInvoices] = useState<Invoice[]>([]);      // current page (for the table)
  const [total, setTotal] = useState(0);                        // total invoice count (for pagination)
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statRows, setStatRows] = useState<Pick<Invoice, 'total' | 'balance' | 'invoice_date'>[]>([]); // all invoices, slim, for stats
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState(''); // search, debounced (drives the fetch)
  const [viewing, setViewing] = useState<{ invoice: Invoice; items: InvoiceItem[] } | null>(null);
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal'>('a4');
  const [received, setReceived] = useState(0);
  const loadSeq = useRef(0);

  // Table: only the current page of full rows (keeps the DOM bounded at scale).
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr('');
    try {
      const { rows, total } = await invoiceService.listPaged(debSearch, page, PAGE_SIZE);
      if (seq !== loadSeq.current) return; // stale response — a newer request is in flight
      setInvoices(rows);
      setTotal(total);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setErr(e.message || 'Failed to load invoices');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [debSearch, page]);

  useEffect(() => { load(); }, [load]);
  // Debounce typing, then reset to the first page for the new search term
  // (both updates batch, so the fetch fires once with the new term + page 0).
  useEffect(() => {
    const t = setTimeout(() => { setDebSearch(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  // Clamp to the last valid page when total shrinks (delete / filter change).
  useEffect(() => {
    if (page > 0 && page * PAGE_SIZE >= total) setPage(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  }, [total, page]);

  // Summary stats: slim all-rows fetch, deliberately UNFILTERED — the stat
  // cards show whole-business totals/aging regardless of the search box.
  // (Filtering them by search while payments stay global would make
  // Outstanding = filteredSale − allPayments, which is meaningless.)
  useEffect(() => {
    invoiceService.statsRows().then(setStatRows)
      .catch(() => { /* stats are non-critical; table load surfaces errors */ });
  }, []);

  // Fetched once — total customer payments, needed to derive Outstanding correctly.
  useEffect(() => { paymentService.totalReceivedFromCustomers().then(setReceived); }, []);

  useEffect(() => {
    if (!orgId) return;
    orgService.getSettings(orgId).then(s => {
      if (s?.print_format === 'thermal') setPrintFormat('thermal');
      else setPrintFormat('a4'); // default for 'a4' or 'both'
    });
  }, [orgId]);

  const totalSale = statRows.reduce((s, i) => s + i.total, 0);
  // NOT sum(invoice.balance) — that misses on-account/unapplied payments and
  // clamps at 0 per-invoice on overpayment, silently understating what's
  // actually still owed to be collected. Same fix as customer/supplier
  // outstanding: total billed minus total actually received.
  const totalDue = Math.max(0, totalSale - received);
  const aging = agingSummary(statRows as Invoice[]);

  async function view(id: string) {
    const data = await invoiceService.getWithItems(id);
    if (data) setViewing(data);
  }

  async function exportCsv() {
    // Export the full matching set, not just the current page.
    const all = await invoiceService.list(search);
    downloadCsv('sales.csv', toCsv(all, [
      { key: 'invoice_no', label: 'Invoice No' },
      { key: 'invoice_date', label: 'Date' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'total', label: 'Total' },
      { key: 'paid', label: 'Paid' },
      { key: 'balance', label: 'Balance' }
    ]));
  }

  return (
    <>
      <PageHeader title="📋 Sale List"
        actions={<>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={total === 0}>⬇ Export CSV</Button>
          <Link href="/billing" className="btn btn-primary btn-sm">➕ New Invoice</Link>
        </>} />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Stat label="Invoices" value={total} color="blue" />
          <Stat label="Total Sale" value={fmtCurrency(totalSale)} color="teal" />
          <div className="card border-l-4 border-red-500 text-red-600">
            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Outstanding</div>
            <div className="text-2xl font-extrabold mt-1 tabular-nums" style={{ color: totalDue > 0 ? '#dc2626' : '#10b981' }}>
              {fmtCurrency(totalDue)}
            </div>
            {totalDue > 0 && (
              <div className="text-[11px] text-slate-400 mt-1 font-medium">
                0-30: {fmtCurrency(aging['0-30'])} · 31-60: {fmtCurrency(aging['31-60'])} · 60+: {fmtCurrency(aging['60+'])}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4 max-w-md">
          <input className="input" placeholder="🔍 Search invoice or customer..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading && total === 0 ? (
          <Loading msg="Loading invoices…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : total === 0 ? (
          <Empty icon="🧾" title="No invoices yet" msg="Get started with New Invoice" />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-3 py-2.5">Invoice</th>
                  <th className="text-left px-3 py-2.5">Date</th>
                  <th className="text-left px-3 py-2.5">Customer</th>
                  <th className="text-right px-3 py-2.5">Total</th>
                  <th className="text-right px-3 py-2.5">Paid</th>
                  <th className="text-right px-3 py-2.5">Balance</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => view(i.id)}>
                    <td className="px-3 py-2.5 font-semibold text-brand-dark">{i.invoice_no}</td>
                    <td className="px-3 py-2.5">{fmtDate(i.invoice_date)}</td>
                    <td className="px-3 py-2.5">{i.customer_name || 'Cash'}</td>
                    <td className="px-3 py-2.5 text-right font-bold">{fmtCurrency(i.total)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600">{fmtCurrency(i.paid)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: i.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                      {fmtCurrency(i.balance)}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button className="btn btn-outline btn-sm mr-1.5" onClick={e => { e.stopPropagation(); view(i.id); }}>View</button>
                      <Link href={`/invoice/${i.id}/print/${printFormat}`} className="btn btn-outline btn-sm" onClick={e => e.stopPropagation()}>🖨️ Print</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </PageBody>

      {viewing && <InvoiceView data={viewing} printFormat={printFormat} onClose={() => setViewing(null)} />}
    </>
  );
}

function InvoiceView({ data, printFormat, onClose }: { data: { invoice: Invoice; items: InvoiceItem[] }; printFormat: 'a4' | 'thermal'; onClose: () => void }) {
  const { invoice: inv, items } = data;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold">🧾 {inv.invoice_no}</h2>
          <button className="text-slate-400 text-xl px-2" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 overflow-y-auto">
          <div className="flex justify-between text-sm mb-4">
            <div>
              <div className="text-slate-400 text-xs">Customer</div>
              <div className="font-semibold">{inv.customer_name}</div>
              <div className="text-slate-400 text-xs mt-2">Date</div>
              <div>{fmtDate(inv.invoice_date)}</div>
            </div>
            <div className="text-right">
              <div className="text-slate-400 text-xs">Total</div>
              <div className="text-xl font-extrabold text-brand-dark">{fmtCurrency(inv.total)}</div>
              <div className="text-xs mt-1" style={{ color: inv.balance > 0 ? '#dc2626' : '#10b981' }}>
                Balance: {fmtCurrency(inv.balance)}
              </div>
            </div>
          </div>
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
              <th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Qty</th>
              <th className="text-right px-2 py-2">Rate</th><th className="text-right px-2 py-2">Amount</th>
            </tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-2">{it.name}</td>
                  <td className="px-2 py-2 text-right">{it.qty}</td>
                  <td className="px-2 py-2 text-right">{fmtCurrency(it.rate)}</td>
                  <td className="px-2 py-2 text-right font-semibold">{fmtCurrency(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.notes && <div className="mt-3 text-sm bg-slate-50 rounded-lg p-3"><strong>Notes:</strong> {inv.notes}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <Link href={`/invoice/${inv.id}/print/${printFormat}`} className="btn btn-outline">🖨 Print</Link>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
