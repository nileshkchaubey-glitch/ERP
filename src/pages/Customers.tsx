import { useEffect, useState } from 'react';
import { customerService } from '../lib/erpServices';
import { paymentService } from '../lib/paymentService';
import { agingSummary } from '../lib/aging';
import type { Customer, Invoice, Payment } from '../lib/supabase';
import {
  PageHeader, PageBody, Empty, Loading, ErrorState,
  Button, Input, Select, Field, Modal, fmtCurrency, fmtDate
} from '../components/ui';

export function Customers() {
  return <CustomersInner />;
}

function CustomersInner() {
  const [list, setList] = useState<Customer[] | null>(null);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [outstanding, setOutstanding] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);

  async function load() {
    setErr('');
    try {
      const data = await customerService.list(search);
      setList(data);
      // Fetch outstanding per customer (N+1, acceptable at small scale).
      const entries = await Promise.all(
        data.map(async c => [c.id, await customerService.outstanding(c.id)] as const)
      );
      setOutstanding(Object.fromEntries(entries));
    } catch (e: any) {
      setErr(e.message || 'Failed to load customers');
      setList([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search]);

  async function add() {
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      await customerService.create({ name: name.trim(), phone: phone.trim() || null });
      setName(''); setPhone('');
      await load();
    } catch (e: any) {
      alert(e.message || 'Could not add customer');
    } finally { setAdding(false); }
  }

  return (
    <>
      <PageHeader title="🧑‍🤝‍🧑 Customers" subtitle="Balances, ledgers and payments received" />
      <PageBody>
        <div className="mb-4 max-w-md">
          <input className="input" placeholder="🔍 Search customer..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="card mb-4">
          <div className="text-xs font-bold text-slate-600 uppercase mb-3">➕ Add Customer</div>
          <div className="flex gap-2 flex-wrap">
            <Input className="flex-1 min-w-[160px]" placeholder="Customer name" value={name} onChange={e => setName(e.target.value)} />
            <Input className="w-36" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <Button size="sm" onClick={add} disabled={adding}>{adding ? 'Adding…' : 'Add'}</Button>
          </div>
        </div>

        {list === null ? (
          <Loading msg="Loading customers…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : list.length === 0 ? (
          <Empty icon="🧑‍🤝‍🧑" title="No customers yet" msg="Add a customer above to get started" />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-3 py-2.5">Name</th>
                  <th className="text-left px-3 py-2.5">Phone</th>
                  <th className="text-right px-3 py-2.5">Outstanding</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(c => {
                  const out = outstanding[c.id] ?? 0;
                  return (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(c)}>
                      <td className="px-3 py-2.5 font-semibold text-brand-dark">{c.name}</td>
                      <td className="px-3 py-2.5">{c.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: out > 0 ? '#dc2626' : '#94a3b8' }}>
                        {fmtCurrency(out)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); setSelected(c); }}>Ledger</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      {selected && (
        <CustomerLedger
          customer={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function CustomerLedger({ customer, onClose, onChanged }: { customer: Customer; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ invoices: Invoice[]; payments: Payment[] } | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  const [err, setErr] = useState('');
  const [paying, setPaying] = useState(false);

  async function load() {
    setErr('');
    try {
      const [ledger, out] = await Promise.all([
        customerService.ledger(customer.id),
        customerService.outstanding(customer.id)
      ]);
      setData(ledger);
      setOutstanding(out);
    } catch (e: any) {
      setErr(e.message || 'Failed to load ledger');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [customer.id]);

  async function afterPayment() {
    setPaying(false);
    await load();
    onChanged();
  }

  const aging = data ? agingSummary(data.invoices) : null;

  return (
    <Modal open onClose={onClose} wide title={`🧑‍🤝‍🧑 ${customer.name}`}
      footer={
        <>
          <Button variant="primary" onClick={() => setPaying(true)} disabled={!data}>💵 Record Payment</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </>
      }>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-slate-500">
          {customer.phone && <span>📞 {customer.phone}</span>}
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400 uppercase font-semibold">Outstanding</div>
          <div className="text-xl font-extrabold" style={{ color: outstanding > 0 ? '#dc2626' : '#10b981' }}>
            {fmtCurrency(outstanding)}
          </div>
        </div>
      </div>

      {err ? (
        <ErrorState msg={err} onRetry={load} />
      ) : !data ? (
        <Loading msg="Loading ledger…" />
      ) : (
        <div className="space-y-5">
          {aging && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">
                0-30: {fmtCurrency(aging['0-30'])}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">
                31-60: {fmtCurrency(aging['31-60'])}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-semibold">
                60+: {fmtCurrency(aging['60+'])}
              </span>
            </div>
          )}

          <div>
            <div className="text-xs font-bold text-slate-600 uppercase mb-2">Invoices</div>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-slate-400">No invoices recorded.</p>
            ) : (
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-2 py-2">Invoice No</th><th className="text-left px-2 py-2">Date</th>
                  <th className="text-right px-2 py-2">Total</th><th className="text-right px-2 py-2">Balance</th>
                </tr></thead>
                <tbody>
                  {data.invoices.map(i => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">{i.invoice_no || '—'}</td>
                      <td className="px-2 py-2">{fmtDate(i.invoice_date)}</td>
                      <td className="px-2 py-2 text-right">{fmtCurrency(i.total)}</td>
                      <td className="px-2 py-2 text-right font-semibold" style={{ color: i.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                        {fmtCurrency(i.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <div className="text-xs font-bold text-slate-600 uppercase mb-2">Payments</div>
            {data.payments.length === 0 ? (
              <p className="text-sm text-slate-400">No payments recorded.</p>
            ) : (
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Mode</th>
                  <th className="text-left px-2 py-2">Note</th><th className="text-right px-2 py-2">Amount</th>
                </tr></thead>
                <tbody>
                  {data.payments.map(pmt => (
                    <tr key={pmt.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">{fmtDate(pmt.pay_date)}</td>
                      <td className="px-2 py-2">{pmt.mode}</td>
                      <td className="px-2 py-2 text-slate-500">{pmt.note || '—'}</td>
                      <td className="px-2 py-2 text-right font-semibold text-emerald-600">{fmtCurrency(pmt.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {paying && data && (
        <RecordPaymentIn
          customer={customer}
          invoices={data.invoices}
          suggestedAmount={outstanding}
          onClose={() => setPaying(false)}
          onDone={afterPayment}
        />
      )}
    </Modal>
  );
}

function RecordPaymentIn({ customer, invoices, suggestedAmount, onClose, onDone }: {
  customer: Customer;
  invoices: Invoice[];
  suggestedAmount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const unpaid = invoices
    .filter(i => i.balance > 0)
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date)); // oldest first

  const [amount, setAmount] = useState<number>(suggestedAmount > 0 ? suggestedAmount : 0);
  const [mode, setMode] = useState('Cash');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>(
    () => autoDistribute(unpaid, suggestedAmount > 0 ? suggestedAmount : 0)
  );

  // Auto-distribute a given amount across unpaid invoices, oldest-first,
  // fully paying each off until the amount is exhausted.
  function autoDistribute(list: Invoice[], amt: number): Record<string, number> {
    let remaining = amt;
    const result: Record<string, number> = {};
    for (const inv of list) {
      if (remaining <= 0) { result[inv.id] = 0; continue; }
      const apply = Math.min(inv.balance, remaining);
      result[inv.id] = apply;
      remaining -= apply;
    }
    return result;
  }

  function onAmountChange(v: number) {
    setAmount(v);
    setAllocations(autoDistribute(unpaid, v));
  }

  function onAllocChange(invoiceId: string, v: number) {
    // Clamp to this invoice's own remaining balance — allocating more than an
    // invoice owes doesn't make sense (the excess belongs on-account or on
    // another invoice, not silently overpaying one bill).
    const inv = unpaid.find(i => i.id === invoiceId);
    const capped = Math.min(Math.max(v, 0), inv?.balance ?? v);
    setAllocations(prev => ({ ...prev, [invoiceId]: capped }));
  }

  const allocatedTotal = Object.values(allocations).reduce((s, v) => s + (v || 0), 0);
  const overAllocated = allocatedTotal > amount;

  async function submit() {
    if (!amount || amount <= 0) { alert('Enter a payment amount'); return; }
    if (overAllocated) { alert('Allocated amount cannot exceed the payment amount.'); return; }
    setBusy(true);
    try {
      const allocationList = Object.entries(allocations)
        .filter(([, amt]) => amt > 0)
        .map(([invoiceId, amt]) => ({ invoiceId, amount: amt }));
      await paymentService.recordCustomerPayment({
        customerId: customer.id,
        amount,
        mode,
        payDate,
        note: note.trim() || undefined,
        allocations: allocationList
      });
      onDone();
    } catch (e: any) {
      alert(e.message || 'Could not record payment');
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} wide title={`💵 Receive Payment — ${customer.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || overAllocated}>{busy ? 'Saving…' : 'Record Payment'}</Button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Field label="Amount (₹)">
          <Input type="number" value={amount || ''} onChange={e => onAmountChange(+e.target.value)} autoFocus />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={e => setMode(e.target.value)}>
            {['Cash', 'UPI', 'NEFT/RTGS', 'Cheque'].map(m => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" />
        </Field>
      </div>

      <div className="text-xs font-bold text-slate-600 uppercase mb-2">
        Apply to invoices <span className="font-normal normal-case text-slate-400">(auto-suggested oldest-first, editable)</span>
      </div>

      {unpaid.length === 0 ? (
        <p className="text-sm text-slate-400 mb-2">No unpaid invoices — this will be recorded as an on-account payment.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-2">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
              <th className="text-left px-2 py-2">Invoice No</th><th className="text-left px-2 py-2">Date</th>
              <th className="text-right px-2 py-2">Balance</th><th className="text-right px-2 py-2 w-32">Apply Amount</th>
            </tr></thead>
            <tbody>
              {unpaid.map(inv => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">{inv.invoice_no || '—'}</td>
                  <td className="px-2 py-2">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-2 py-2 text-right" style={{ color: '#dc2626' }}>{fmtCurrency(inv.balance)}</td>
                  <td className="px-2 py-2 text-right">
                    <Input
                      type="number"
                      max={inv.balance}
                      className="text-right w-28"
                      value={allocations[inv.id] || ''}
                      onChange={e => onAllocChange(inv.id, +e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between text-sm px-1">
        <span className="text-slate-500">Allocated total</span>
        <span className={`font-semibold ${overAllocated ? 'text-red-600' : 'text-slate-700'}`}>
          {fmtCurrency(allocatedTotal)} / {fmtCurrency(amount)}
        </span>
      </div>
      {overAllocated && (
        <p className="text-xs text-red-600 mt-1">Allocated amount cannot exceed the payment amount.</p>
      )}
    </Modal>
  );
}
