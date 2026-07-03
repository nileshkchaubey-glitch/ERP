import { useEffect, useState } from 'react';
import { itemService } from '../lib/itemService';
import { invoiceService } from '../lib/erpServices';
import { paymentService } from '../lib/paymentService';
import { PageHeader, PageBody, Stat, Loading, ErrorState, fmtCurrency, fmtDate } from '../components/ui';
import type { Invoice } from '../lib/supabase';
import { Link } from 'wouter';

export function Dashboard() {
  const [stats, setStats] = useState({ items: 0, todaySale: 0, monthSale: 0, pending: 0 });
  const [recent, setRecent] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      // Slim queries only — this is the landing page, it must stay light at
      // 5,000+ items / unbounded invoices. Item count via a 1-row paged fetch
      // (count: exact), sums via 3-column statsRows, recent via one 8-row page.
      const [itemPage, statRows, recentPage, received] = await Promise.all([
        itemService.listPaged('', 0, 1),
        invoiceService.statsRows(),
        invoiceService.listPaged('', 0, 8),
        paymentService.totalReceivedFromCustomers()
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const todaySale = statRows.filter(i => i.invoice_date === today).reduce((s, i) => s + i.total, 0);
      const monthSale = statRows.filter(i => i.invoice_date.startsWith(month)).reduce((s, i) => s + i.total, 0);
      // Pending = total billed - total received. NOT sum(invoice.balance), which
      // misses on-account/unapplied payments and clamps per-invoice on overpayment
      // (same fix applied to SalesList/customer/supplier outstanding).
      const totalBilled = statRows.reduce((s, i) => s + i.total, 0);
      const pending = Math.max(0, totalBilled - received);
      setStats({ items: itemPage.total, todaySale, monthSale, pending });
      setRecent(recentPage.rows);
    } catch (e: any) {
      setErr(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title="📊 Dashboard"
        actions={<Link href="/billing" className="btn btn-primary btn-sm">➕ New Invoice</Link>}
      />
      <PageBody>
        {loading ? (
          <Loading msg="Loading dashboard…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Today Sale" value={fmtCurrency(stats.todaySale)} color="teal" />
          <Stat label="This Month" value={fmtCurrency(stats.monthSale)} color="blue" />
          <Stat label="Pending Due" value={fmtCurrency(stats.pending)} color={stats.pending > 0 ? 'red' : 'green'} />
          <Stat label="Items" value={stats.items} color="slate" />
        </div>

        <div className="card">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">Recent Invoices</div>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No invoices yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-400 text-left">
                  <th className="py-2">Invoice</th><th>Date</th><th>Customer</th>
                  <th className="text-right">Total</th><th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(i => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="py-2 font-semibold text-brand-dark">{i.invoice_no}</td>
                    <td>{fmtDate(i.invoice_date)}</td>
                    <td>{i.customer_name || 'Cash'}</td>
                    <td className="text-right font-bold">{fmtCurrency(i.total)}</td>
                    <td className="text-right" style={{ color: i.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                      {fmtCurrency(i.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
        )}
      </PageBody>
    </>
  );
}
