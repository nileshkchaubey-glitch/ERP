import { useEffect, useState } from 'react';
import { supplierService } from '../lib/supplierService';
import { paymentService } from '../lib/paymentService';
import type { Supplier, Purchase, Payment } from '../lib/supabase';
import {
  PageHeader, PageBody, RoleGate, Empty, Loading, ErrorState,
  Button, Input, Select, Field, Modal, fmtCurrency, fmtDate
} from '../components/ui';

export function Suppliers() {
  return (
    <RoleGate allow={['owner', 'admin']} fallback={
      <>
        <PageHeader title="🏭 Suppliers" />
        <PageBody>
          <div className="card text-center text-slate-500 py-10">
            Suppliers are only visible to an owner or admin.
          </div>
        </PageBody>
      </>
    }>
      <SuppliersInner />
    </RoleGate>
  );
}

function SuppliersInner() {
  const [list, setList] = useState<Supplier[] | null>(null);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [outstanding, setOutstanding] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);

  async function load() {
    setErr('');
    try {
      const data = await supplierService.list(search);
      setList(data);
      // Fetch outstanding per supplier (N+1, acceptable at small scale).
      const entries = await Promise.all(
        data.map(async s => [s.id, await supplierService.outstanding(s.id)] as const)
      );
      setOutstanding(Object.fromEntries(entries));
    } catch (e: any) {
      setErr(e.message || 'Failed to load suppliers');
      setList([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search]);

  async function add() {
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      await supplierService.create({ name: name.trim(), phone: phone.trim() || null });
      setName(''); setPhone('');
      await load();
    } catch (e: any) {
      alert(e.message || 'Could not add supplier');
    } finally { setAdding(false); }
  }

  return (
    <>
      <PageHeader title="🏭 Suppliers" subtitle="Vendors, balances and payments" />
      <PageBody>
        <div className="mb-4 max-w-md">
          <input className="input" placeholder="🔍 Search supplier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="card mb-4">
          <div className="text-xs font-bold text-slate-600 uppercase mb-3">➕ Add Supplier</div>
          <div className="flex gap-2 flex-wrap">
            <Input className="flex-1 min-w-[160px]" placeholder="Supplier name" value={name} onChange={e => setName(e.target.value)} />
            <Input className="w-36" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <Button size="sm" onClick={add} disabled={adding}>{adding ? 'Adding…' : 'Add'}</Button>
          </div>
        </div>

        {list === null ? (
          <Loading msg="Loading suppliers…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : list.length === 0 ? (
          <Empty icon="🏭" title="No suppliers yet" msg="Add a supplier above to get started" />
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
                {list.map(s => {
                  const out = outstanding[s.id] ?? 0;
                  return (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(s)}>
                      <td className="px-3 py-2.5 font-semibold text-brand-dark">{s.name}</td>
                      <td className="px-3 py-2.5">{s.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: out > 0 ? '#dc2626' : '#94a3b8' }}>
                        {fmtCurrency(out)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); setSelected(s); }}>Ledger</button>
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
        <SupplierLedger
          supplier={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function SupplierLedger({ supplier, onClose, onChanged }: { supplier: Supplier; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ purchases: Purchase[]; payments: Payment[] } | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  const [err, setErr] = useState('');
  const [paying, setPaying] = useState(false);

  async function load() {
    setErr('');
    try {
      const [ledger, out] = await Promise.all([
        supplierService.ledger(supplier.id),
        supplierService.outstanding(supplier.id)
      ]);
      setData(ledger);
      setOutstanding(out);
    } catch (e: any) {
      setErr(e.message || 'Failed to load ledger');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplier.id]);

  async function afterPayment() {
    setPaying(false);
    await load();
    onChanged();
  }

  return (
    <Modal open onClose={onClose} wide title={`🏭 ${supplier.name}`}
      footer={
        <>
          <Button variant="primary" onClick={() => setPaying(true)} disabled={!data}>💵 Record Payment</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </>
      }>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-slate-500">
          {supplier.phone && <span>📞 {supplier.phone}</span>}
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
          <div>
            <div className="text-xs font-bold text-slate-600 uppercase mb-2">Purchases</div>
            {data.purchases.length === 0 ? (
              <p className="text-sm text-slate-400">No purchases recorded.</p>
            ) : (
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead><tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-2 py-2">Bill No</th><th className="text-left px-2 py-2">Date</th>
                  <th className="text-right px-2 py-2">Total</th><th className="text-right px-2 py-2">Balance</th>
                </tr></thead>
                <tbody>
                  {data.purchases.map(p => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">{p.bill_no || '—'}</td>
                      <td className="px-2 py-2">{fmtDate(p.bill_date)}</td>
                      <td className="px-2 py-2 text-right">{fmtCurrency(p.total)}</td>
                      <td className="px-2 py-2 text-right font-semibold" style={{ color: p.balance > 0 ? '#dc2626' : '#94a3b8' }}>
                        {fmtCurrency(p.balance)}
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
        <RecordPayment
          supplier={supplier}
          purchases={data.purchases}
          suggestedAmount={outstanding}
          onClose={() => setPaying(false)}
          onDone={afterPayment}
        />
      )}
    </Modal>
  );
}

function RecordPayment({ supplier, purchases, suggestedAmount, onClose, onDone }: {
  supplier: Supplier;
  purchases: Purchase[];
  suggestedAmount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number>(suggestedAmount > 0 ? suggestedAmount : 0);
  const [mode, setMode] = useState('Cash');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseId, setPurchaseId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const unpaid = purchases.filter(p => p.balance > 0);

  async function submit() {
    if (!amount || amount <= 0) { alert('Enter a payment amount'); return; }
    setBusy(true);
    try {
      await paymentService.recordOut({
        supplierId: supplier.id,
        purchaseId: purchaseId || null,
        amount,
        mode,
        payDate,
        note: note.trim() || undefined
      });
      onDone();
    } catch (e: any) {
      alert(e.message || 'Could not record payment');
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`💵 Pay ${supplier.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Record Payment'}</Button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)">
          <Input type="number" value={amount || ''} onChange={e => setAmount(+e.target.value)} autoFocus />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={e => setMode(e.target.value)}>
            {['Cash', 'UPI', 'NEFT/RTGS', 'Cheque'].map(m => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
        </Field>
        <Field label="Apply to bill (optional)">
          <Select value={purchaseId} onChange={e => setPurchaseId(e.target.value)}>
            <option value="">General (no specific bill)</option>
            {unpaid.map(p => (
              <option key={p.id} value={p.id}>
                {(p.bill_no || 'Bill')} · {fmtDate(p.bill_date)} · bal {fmtCurrency(p.balance)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Note">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
