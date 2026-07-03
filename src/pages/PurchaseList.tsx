import { useEffect, useState, useCallback, useRef } from 'react';
import { purchaseService } from '../lib/purchaseService';
import { supplierService } from '../lib/supplierService';
import type { Purchase, PurchaseItem, Supplier } from '../lib/supabase';
import { paymentService } from '../lib/paymentService';
import { PageHeader, PageBody, RoleGate, Empty, Loading, ErrorState, Stat, Button, Pagination, fmtCurrency, fmtDate } from '../components/ui';
import { toCsv, downloadCsv } from '../lib/csv';
import { Link } from 'wouter';

const PAGE_SIZE = 50;

export function PurchaseList() {
  return (
    <RoleGate allow={['owner', 'admin']} fallback={
      <>
        <PageHeader title="📥 Purchase List" />
        <PageBody>
          <div className="card text-center text-slate-500 py-10">
            Purchases are only visible to an owner or admin.
          </div>
        </PageBody>
      </>
    }>
      <PurchaseListInner />
    </RoleGate>
  );
}

function PurchaseListInner() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);   // current page (for the table)
  const [total, setTotal] = useState(0);                        // total purchase count (for pagination)
  const [page, setPage] = useState(0);
  const [totalPurchase, setTotalPurchase] = useState(0);        // sum of all purchase totals (stats)
  const [paidOut, setPaidOut] = useState(0);                    // sum of all supplier payments (stats)
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState(''); // search, debounced (drives the fetch)
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState<{ purchase: Purchase; items: PurchaseItem[] } | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr('');
    try {
      const [paged, suppliers] = await Promise.all([
        purchaseService.listPaged(debSearch, page, PAGE_SIZE),
        supplierService.list()
      ]);
      if (seq !== loadSeq.current) return; // stale response — a newer request is in flight
      setPurchases(paged.rows);
      setTotal(paged.total);
      const map: Record<string, string> = {};
      suppliers.forEach((s: Supplier) => { map[s.id] = s.name; });
      setSupplierNames(map);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setErr(e.message || 'Failed to load purchases');
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

  // Summary stats: deliberately UNFILTERED whole-business figures, fetched once
  // — Payable = all purchases − all supplier payments; filtering one side by
  // search while payments stay global would produce a meaningless number.
  useEffect(() => {
    Promise.all([purchaseService.statsRows(), paymentService.totalPaidToSuppliers()])
      .then(([statRows, paid]) => {
        setTotalPurchase(statRows.reduce((s, p) => s + p.total, 0));
        setPaidOut(paid);
      })
      .catch(() => { /* stats are non-critical; table load handles errors */ });
  }, []);

  // Payable = total purchased - total paid to suppliers (NOT sum(purchase.balance),
  // which misses unapplied/general supplier payments — same fix as customer side).
  const totalDue = Math.max(0, totalPurchase - paidOut);

  async function view(id: string) {
    const data = await purchaseService.getWithItems(id);
    if (data) setViewing(data);
  }

  async function exportCsv() {
    const all = await purchaseService.list(search);
    const rows = all.map(p => ({
      bill_no: p.bill_no || '',
      bill_date: p.bill_date,
      supplier_name: p.supplier_id ? (supplierNames[p.supplier_id] || '') : '',
      total: p.total,
      paid: p.paid,
      balance: p.balance
    }));
    downloadCsv('purchases.csv', toCsv(rows, [
      { key: 'bill_no', label: 'Bill No' },
      { key: 'bill_date', label: 'Date' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'total', label: 'Total' },
      { key: 'paid', label: 'Paid' },
      { key: 'balance', label: 'Balance' }
    ]));
  }

  return (
    <>
      <PageHeader title="📥 Purchase List"
        actions={<>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={total === 0}>⬇ Export CSV</Button>
          <Link href="/purchases/new" className="btn btn-primary btn-sm">➕ New Purchase</Link>
        </>} />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Stat label="Purchases" value={total} color="blue" />
          <Stat label="Total Purchase" value={fmtCurrency(totalPurchase)} color="teal" />
          <Stat label="Payable" value={fmtCurrency(totalDue)} color={totalDue > 0 ? 'red' : 'green'} />
        </div>

        <div className="mb-4 max-w-md">
          <input className="input" placeholder="🔍 Search by bill no..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading && total === 0 ? (
          <Loading msg="Loading purchases…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : total === 0 ? (
          <Empty icon="📥" title="No purchases yet" msg="Record a purchase to stock in goods"
            action={<Link href="/purchases/new" className="btn btn-primary btn-sm">➕ New Purchase</Link>} />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-3 py-2.5">Bill No</th>
                  <th className="text-left px-3 py-2.5">Date</th>
                  <th className="text-left px-3 py-2.5">Supplier</th>
                  <th className="text-right px-3 py-2.5">Total</th>
                  <th className="text-right px-3 py-2.5">Paid</th>
                  <th className="text-right px-3 py-2.5">Balance</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => view(p.id)}>
                    <td className="px-3 py-2.5 font-semibold text-brand-dark">{p.bill_no || '—'}</td>
                    <td className="px-3 py-2.5">{fmtDate(p.bill_date)}</td>
                    <td className="px-3 py-2.5">{p.supplier_id ? (supplierNames[p.supplier_id] || '—') : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-bold">{fmtCurrency(p.total)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600">{fmtCurrency(p.paid)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: p.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                      {fmtCurrency(p.balance)}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); view(p.id); }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </PageBody>

      {viewing && (
        <PurchaseView
          data={viewing}
          supplierName={viewing.purchase.supplier_id ? supplierNames[viewing.purchase.supplier_id] : undefined}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function PurchaseView({ data, supplierName, onClose }: { data: { purchase: Purchase; items: PurchaseItem[] }; supplierName?: string; onClose: () => void }) {
  const { purchase: p, items } = data;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold">📥 {p.bill_no || 'Purchase'}</h2>
          <button className="text-slate-400 text-xl px-2" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 overflow-y-auto">
          <div className="flex justify-between text-sm mb-4">
            <div>
              <div className="text-slate-400 text-xs">Supplier</div>
              <div className="font-semibold">{supplierName || '—'}</div>
              <div className="text-slate-400 text-xs mt-2">Bill Date</div>
              <div>{fmtDate(p.bill_date)}</div>
            </div>
            <div className="text-right">
              <div className="text-slate-400 text-xs">Total</div>
              <div className="text-xl font-extrabold text-brand-dark">{fmtCurrency(p.total)}</div>
              <div className="text-xs mt-1" style={{ color: p.balance > 0 ? '#dc2626' : '#10b981' }}>
                Balance: {fmtCurrency(p.balance)}
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
                  <td className="px-2 py-2 font-mono text-xs">{it.item_id || '—'}{it.variant_id ? ' (variant)' : ''}</td>
                  <td className="px-2 py-2 text-right">{it.qty}</td>
                  <td className="px-2 py-2 text-right">{fmtCurrency(it.rate)}</td>
                  <td className="px-2 py-2 text-right font-semibold">{fmtCurrency(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.notes && <div className="mt-3 text-sm bg-slate-50 rounded-lg p-3"><strong>Notes:</strong> {p.notes}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
