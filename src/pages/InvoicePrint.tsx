import { useEffect, useState } from 'react';
import { useRoute, useSearch, Link } from 'wouter';
import { invoiceService } from '../lib/erpServices';
import { orgService } from '../lib/orgService';
import { useOrg } from '../lib/orgContext';
import type { Invoice, InvoiceItem, OrgSettings } from '../lib/supabase';
import { Loading, Empty, ErrorState, fmtCurrency, fmtDate } from '../components/ui';

type Format = 'a4' | 'thermal';

export function InvoicePrint() {
  const [match, params] = useRoute('/invoice/:id/print/:format');
  const search = useSearch();
  const { orgId } = useOrg();
  const [data, setData] = useState<{ invoice: Invoice; items: InvoiceItem[] } | null | undefined>(undefined);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);

  const id = params?.id;
  const format: Format = params?.format === 'thermal' ? 'thermal' : 'a4';
  const autoprint = new URLSearchParams(search).get('autoprint') === '1';

  async function load() {
    if (!id || !orgId) return;
    setError(null);
    setData(undefined);
    try {
      const [inv, s] = await Promise.all([
        invoiceService.getWithItems(id),
        orgService.getSettings(orgId)
      ]);
      setData(inv);
      setSettings(s);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoice');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId]);

  useEffect(() => {
    if (!autoprint || !data || printed) return;
    setPrinted(true);
    // Let layout paint before invoking print dialog. Not cleared on cleanup: React 18
    // StrictMode (dev only) mounts/cleans up/remounts effects once, and since `printed`
    // is already true on the second mount, a cleared timer here would silently swallow
    // the print call. Letting it fire is safe — `printed` guards against ever scheduling twice.
    setTimeout(() => window.print(), 250);
  }, [autoprint, data, printed]);

  if (!match) return null;

  if (error) {
    return (
      <div className="p-6">
        <ErrorState msg={error} onRetry={load} />
      </div>
    );
  }

  if (data === undefined) {
    return (
      <div className="p-6">
        <Loading msg="Loading invoice…" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="p-6">
        <Empty icon="🧾" title="Invoice not found" msg="This invoice may have been removed." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Toolbar — hidden when printing */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <Link href="/sales" className="btn btn-outline btn-sm">← Sale List</Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Format:</span>
          <Link href={`/invoice/${id}/print/a4`} className={`btn btn-sm ${format === 'a4' ? 'btn-primary' : 'btn-outline'}`}>A4</Link>
          <Link href={`/invoice/${id}/print/thermal`} className={`btn btn-sm ${format === 'thermal' ? 'btn-primary' : 'btn-outline'}`}>Thermal</Link>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      <style>{`
        @media print {
          @page { ${format === 'a4' ? 'size: A4; margin: 12mm;' : 'size: 80mm auto; margin: 2mm;'} }
        }
      `}</style>

      {format === 'a4'
        ? <A4Invoice invoice={data.invoice} items={data.items} settings={settings} />
        : <ThermalInvoice invoice={data.invoice} items={data.items} settings={settings} />}
    </div>
  );
}

function A4Invoice({ invoice, items, settings }: { invoice: Invoice; items: InvoiceItem[]; settings: OrgSettings | null }) {
  return (
    <div className="max-w-[210mm] mx-auto bg-white shadow-card print:shadow-none my-4 print:my-0 p-10 print:p-0 text-slate-800 text-sm">
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-3">
          {settings?.logo_url ? (
            <img src={settings.logo_url} alt="Logo" className="h-14 w-14 object-contain" />
          ) : null}
          <div>
            <div className="text-xl font-extrabold">{settings?.shop_name || 'Your Business'}</div>
            {settings?.address && <div className="text-xs text-slate-600">{settings.address}</div>}
            <div className="text-xs text-slate-600">
              {settings?.state ? `${settings.state} ` : ''}
              {settings?.phone ? `· Ph: ${settings.phone}` : ''}
            </div>
            {settings?.gstin && <div className="text-xs text-slate-600">GSTIN: {settings.gstin}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold tracking-wide">TAX INVOICE</div>
          <div className="text-xs text-slate-600 mt-1">Invoice No: <strong>{invoice.invoice_no}</strong></div>
          <div className="text-xs text-slate-600">Date: {fmtDate(invoice.invoice_date)}</div>
        </div>
      </div>

      {/* Bill to */}
      <div className="mb-4">
        <div className="text-xs font-bold uppercase text-slate-500 mb-1">Bill To</div>
        <div className="font-semibold">{invoice.customer_name || 'Cash Customer'}</div>
      </div>

      {/* Items table */}
      <table className="w-full text-xs border border-slate-300 border-collapse mb-4">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-2 py-1.5 text-left">#</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Item</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">HSN</th>
            <th className="border border-slate-300 px-2 py-1.5 text-right">Qty</th>
            <th className="border border-slate-300 px-2 py-1.5 text-right">Rate</th>
            <th className="border border-slate-300 px-2 py-1.5 text-right">GST%</th>
            <th className="border border-slate-300 px-2 py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="border border-slate-300 px-2 py-1.5">{i + 1}</td>
              <td className="border border-slate-300 px-2 py-1.5">{it.name}</td>
              <td className="border border-slate-300 px-2 py-1.5">{it.hsn_code || '-'}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{it.qty}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{fmtCurrency(it.rate)}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{it.gst_rate}%</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right font-semibold">{fmtCurrency(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-4">
        <div className="w-64 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{fmtCurrency(invoice.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Discount</span><span>-{fmtCurrency(invoice.discount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">GST</span><span>{fmtCurrency(invoice.tax_amount)}</span></div>
          <div className="flex justify-between border-t-2 border-slate-800 pt-1 font-extrabold text-base">
            <span>Total</span><span>{fmtCurrency(invoice.total)}</span>
          </div>
          <div className="flex justify-between"><span className="text-slate-500">Paid</span><span>{fmtCurrency(invoice.paid)}</span></div>
          <div className="flex justify-between font-bold"><span>Balance Due</span><span>{fmtCurrency(invoice.balance)}</span></div>
        </div>
      </div>

      {invoice.notes && (
        <div className="text-xs text-slate-600 mb-3"><strong>Notes:</strong> {invoice.notes}</div>
      )}

      {settings?.terms && (
        <div className="border-t border-slate-300 pt-3 mt-6 text-xs text-slate-500 whitespace-pre-wrap">{settings.terms}</div>
      )}
    </div>
  );
}

function ThermalInvoice({ invoice, items, settings }: { invoice: Invoice; items: InvoiceItem[]; settings: OrgSettings | null }) {
  return (
    <div className="max-w-[80mm] mx-auto bg-white shadow-card print:shadow-none my-4 print:my-0 p-3 print:p-0 text-[11px] leading-tight text-slate-800 font-mono">
      <div className="text-center mb-2">
        <div className="text-sm font-extrabold">{settings?.shop_name || 'Your Business'}</div>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Ph: {settings.phone}</div>}
        {settings?.gstin && <div>GSTIN: {settings.gstin}</div>}
      </div>
      <div className="border-t border-dashed border-slate-400 my-1.5" />
      <div className="flex justify-between"><span>Inv: {invoice.invoice_no}</span><span>{fmtDate(invoice.invoice_date)}</span></div>
      <div>Customer: {invoice.customer_name || 'Cash'}</div>
      <div className="border-t border-dashed border-slate-400 my-1.5" />

      <table className="w-full">
        <thead>
          <tr className="border-b border-dashed border-slate-400">
            <th className="text-left py-0.5">Item</th>
            <th className="text-right py-0.5">Qty</th>
            <th className="text-right py-0.5">Rate</th>
            <th className="text-right py-0.5">Amt</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="py-0.5 align-top">{it.name}</td>
              <td className="py-0.5 text-right align-top">{it.qty}</td>
              <td className="py-0.5 text-right align-top">{fmtCurrency(it.rate)}</td>
              <td className="py-0.5 text-right align-top">{fmtCurrency(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed border-slate-400 my-1.5" />

      <div className="flex justify-between"><span>Subtotal</span><span>{fmtCurrency(invoice.subtotal)}</span></div>
      <div className="flex justify-between"><span>Discount</span><span>-{fmtCurrency(invoice.discount)}</span></div>
      <div className="flex justify-between"><span>GST</span><span>{fmtCurrency(invoice.tax_amount)}</span></div>
      <div className="flex justify-between font-extrabold text-sm border-t border-slate-800 pt-1 mt-1">
        <span>TOTAL</span><span>{fmtCurrency(invoice.total)}</span>
      </div>
      <div className="flex justify-between"><span>Paid</span><span>{fmtCurrency(invoice.paid)}</span></div>
      <div className="flex justify-between font-bold"><span>Balance</span><span>{fmtCurrency(invoice.balance)}</span></div>

      {settings?.terms && (
        <>
          <div className="border-t border-dashed border-slate-400 my-1.5" />
          <div className="whitespace-pre-wrap">{settings.terms}</div>
        </>
      )}
      <div className="text-center mt-2">— Thank you —</div>
    </div>
  );
}
