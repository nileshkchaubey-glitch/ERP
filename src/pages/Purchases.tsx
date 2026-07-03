import { useEffect, useRef, useState } from 'react';
import { itemService } from '../lib/itemService';
import { variantService } from '../lib/variantService';
import { stockService } from '../lib/erpServices';
import { purchaseService } from '../lib/purchaseService';
import { supplierService } from '../lib/supplierService';
import type { ErpItem, ErpItemVariant, Supplier, Warehouse, PurchaseItem } from '../lib/supabase';
import { PageHeader, PageBody, RoleGate, fmtCurrency } from '../components/ui';
import { useLocation } from 'wouter';

interface Row {
  rowId: string;
  item_id: string | null;
  variant_id: string | null;
  baseName: string;       // item name without the variant suffix
  hasVariants: boolean;   // selected item.has_variants
  name: string;
  qty: number;
  rate: number;
}

const newRow = (): Row => ({ rowId: Math.random().toString(36).slice(2), item_id: null, variant_id: null, baseName: '', hasVariants: false, name: '', qty: 1, rate: 0 });

export function Purchases() {
  return (
    <RoleGate allow={['owner', 'admin']} fallback={
      <>
        <PageHeader title="➕ New Purchase" />
        <PageBody>
          <div className="card text-center text-slate-500 py-10">
            Purchases can only be created by an owner or admin.
          </div>
        </PageBody>
      </>
    }>
      <PurchaseForm />
    </RoleGate>
  );
}

function PurchaseForm() {
  const [, navigate] = useLocation();
  const [items, setItems] = useState<ErpItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [billNo, setBillNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierName, setSupplierName] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [wh, setWh] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [paid, setPaid] = useState(0);
  const [taxAmount, setTaxAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [supResults, setSupResults] = useState<Supplier[]>([]);
  const [showSupList, setShowSupList] = useState(false);
  const [addingSup, setAddingSup] = useState(false);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);

  useEffect(() => {
    itemService.list().then(setItems).catch(e => setLoadErr(e.message || 'Failed to load items'));
    stockService.listWarehouses().then(ws => {
      setWarehouses(ws);
      const def = ws.find(w => w.is_default) || ws[0];
      if (def) setWh(def.id);
    }).catch(e => setLoadErr(e.message || 'Failed to load warehouses'));
  }, []);

  const setRow = (rowId: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => r.rowId === rowId ? { ...r, ...patch } : r));

  const removeRow = (rowId: string) =>
    setRows(rs => { const next = rs.filter(r => r.rowId !== rowId); return next.length ? next : [newRow()]; });

  // Totals — purchases keep tax pragmatic: one tax amount field, added on top of subtotal.
  const subtotal = rows.reduce((s, r) => s + r.qty * r.rate, 0);
  const total = subtotal + taxAmount;
  const balance = Math.max(0, total - paid);

  function pickItem(rowId: string, item: ErpItem) {
    setRow(rowId, {
      item_id: item.id, variant_id: null, baseName: item.name, hasVariants: !!item.has_variants,
      name: item.name, rate: item.purchase_price
    });
  }

  function pickVariant(rowId: string, baseName: string, v: ErpItemVariant) {
    setRow(rowId, {
      variant_id: v.id,
      name: `${baseName} — ${v.variant_name}`,
      rate: v.purchase_price || 0
    });
  }

  async function searchSupplier(q: string) {
    setSupplierName(q);
    setSupplierId(null);
    if (q.trim()) {
      setSupResults(await supplierService.list(q));
      setShowSupList(true);
    } else setShowSupList(false);
  }

  async function addNewSupplier(name: string) {
    if (!name.trim() || addingSup) return;
    setAddingSup(true);
    try {
      const created = await supplierService.create({ name: name.trim() });
      if (created) {
        setSupplierName(created.name);
        setSupplierId(created.id);
      }
      setShowSupList(false);
    } catch (e: any) {
      alert(e.message || 'Could not add supplier');
    } finally { setAddingSup(false); }
  }

  async function save(): Promise<boolean> {
    if (!wh) { alert('Please select a warehouse'); return false; }
    const valid = rows.filter(r => r.item_id && r.qty > 0);
    if (valid.length === 0) { alert('Please add at least one item'); return false; }
    const missingVariant = valid.find(r => r.hasVariants && !r.variant_id);
    if (missingVariant) { alert(`Please choose a variant for "${missingVariant.baseName}"`); return false; }
    setBusy(true);
    try {
      const purItems: PurchaseItem[] = valid.map(r => ({
        item_id: r.item_id,
        variant_id: r.variant_id,
        qty: r.qty,
        rate: r.rate,
        amount: r.qty * r.rate
      }));
      await purchaseService.create({
        bill_no: billNo.trim() || null,
        supplier_id: supplierId,
        warehouse_id: wh,
        bill_date: date,
        subtotal, tax_amount: taxAmount, total,
        paid, balance, status: 'received', notes: notes.trim() || null
      }, purItems);
      navigate('/purchases');
      return true;
    } catch (e: any) {
      alert(e.message || 'Save failed');
      return false;
    } finally { setBusy(false); }
  }

  // Ctrl+S => save.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) save();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, supplierName, supplierId, rows, paid, taxAmount, wh, payMode, notes, date, billNo]);

  return (
    <>
      <PageHeader title="➕ New Purchase"
        actions={<button className="btn btn-outline btn-sm" onClick={() => navigate('/purchases')}>← Purchase List</button>} />
      <PageBody>
        {loadErr && (
          <div className="card border-l-4 border-red-500 mb-4 text-sm text-red-600">{loadErr}</div>
        )}
        <div className="card mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="label">Supplier Bill No</label>
              <input className="input" value={billNo} onChange={e => setBillNo(e.target.value)} placeholder="optional" /></div>
            <div><label className="label">Bill Date</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label className="label">Warehouse *</label>
              <select className="input" value={wh} onChange={e => setWh(e.target.value)}>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
            <div><label className="label">Payment Mode</label>
              <select className="input" value={payMode} onChange={e => setPayMode(e.target.value)}>
                {['Cash', 'Credit', 'UPI', 'NEFT/RTGS', 'Cheque'].map(p => <option key={p}>{p}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="relative">
              <label className="label">Supplier</label>
              <input className="input" value={supplierName}
                onChange={e => searchSupplier(e.target.value)}
                onBlur={() => setTimeout(() => setShowSupList(false), 180)}
                placeholder="Type supplier name..." />
              {showSupList && (supResults.length > 0 || supplierName.trim()) && (
                <div className="absolute z-20 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {supResults.map(s => (
                    <div key={s.id} className="px-3 py-2 text-sm hover:bg-brand-light cursor-pointer"
                      onMouseDown={() => { setSupplierName(s.name); setSupplierId(s.id); setShowSupList(false); }}>
                      {s.name} {s.phone && <span className="text-slate-400 text-xs">· {s.phone}</span>}
                    </div>
                  ))}
                  {supplierName.trim() && !supResults.some(s => s.name.toLowerCase() === supplierName.trim().toLowerCase()) && (
                    <div className="px-3 py-2 text-sm text-brand-dark font-semibold hover:bg-brand-light cursor-pointer border-t border-slate-100"
                      onMouseDown={() => addNewSupplier(supplierName)}>
                      {addingSup ? 'Adding…' : `+ Add new supplier "${supplierName.trim()}"`}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div><label className="label">Notes</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </div>

        {/* Item rows */}
        <div className="card mb-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs font-bold text-slate-600 uppercase">Items</div>
            <button className="btn btn-primary btn-sm" onClick={() => setRows(rs => [...rs, newRow()])}>➕ Add Item</button>
          </div>
          <div className="space-y-2 overflow-x-auto">
            <div className="hidden md:grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-xs font-bold text-slate-400 uppercase px-1 min-w-[560px]">
              <div>Item</div><div className="text-center">Qty</div><div className="text-right">Rate</div>
              <div className="text-right">Amount</div><div></div>
            </div>
            {rows.map(r => (
              <ItemRow key={r.rowId} row={r} items={items}
                autoFocus={r.rowId === focusRowId}
                onFocused={() => setFocusRowId(null)}
                onPick={it => pickItem(r.rowId, it)}
                onPickVariant={v => pickVariant(r.rowId, r.baseName, v)}
                onChange={patch => setRow(r.rowId, patch)}
                onRemove={() => removeRow(r.rowId)}
                onAppendRow={() => {
                  const nr = newRow();
                  setRows(rs => [...rs, nr]);
                  setFocusRowId(nr.rowId);
                }} />
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <div className="text-xs font-bold text-slate-600 uppercase mb-3">Charges</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Tax (₹)</label>
                <input className="input" type="number" value={taxAmount || ''} onChange={e => setTaxAmount(+e.target.value)} /></div>
              <div><label className="label">Amount Paid (₹)</label>
                <input className="input" type="number" value={paid || ''} onChange={e => setPaid(+e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="text-xs font-bold text-slate-600 uppercase mb-3">Totals</div>
            <div className="space-y-1.5 text-sm">
              <Row2 label="Subtotal" value={fmtCurrency(subtotal)} />
              <Row2 label="Tax" value={fmtCurrency(taxAmount)} />
              <div className="flex justify-between border-t-2 border-slate-300 pt-2 mt-1 font-extrabold text-base">
                <span>TOTAL</span><span className="text-brand-dark">{fmtCurrency(total)}</span>
              </div>
              <Row2 label="Paid" value={fmtCurrency(paid)} />
              <Row2 label="Balance Due" value={fmtCurrency(balance)} red={balance > 0} bold />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            {busy ? '…' : '💾 Save Purchase'}
          </button>
        </div>
      </PageBody>
    </>
  );
}

function ItemRow({ row, items, autoFocus, onFocused, onPick, onPickVariant, onChange, onRemove, onAppendRow }: {
  row: Row; items: ErpItem[];
  autoFocus?: boolean;
  onFocused?: () => void;
  onPick: (it: ErpItem) => void;
  onPickVariant: (v: ErpItemVariant) => void;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onAppendRow: () => void;
}) {
  const [show, setShow] = useState(false);
  const [hi, setHi] = useState(0);
  const [variants, setVariants] = useState<ErpItemVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!row.hasVariants || !row.item_id) { setVariants([]); return; }
    let cancelled = false;
    setLoadingVariants(true);
    variantService.listByItem(row.item_id)
      .then(vs => { if (!cancelled) setVariants(vs.filter(v => v.status === 'active')); })
      .finally(() => { if (!cancelled) setLoadingVariants(false); });
    return () => { cancelled = true; };
  }, [row.item_id, row.hasVariants]);

  const matches = row.name.trim()
    ? items.filter(i => i.name.toLowerCase().includes(row.name.toLowerCase())).slice(0, 6)
    : items.slice(0, 6);

  useEffect(() => { setHi(0); }, [row.name, show]);

  useEffect(() => {
    if (autoFocus) {
      nameRef.current?.focus();
      onFocused?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function selectMatch(it: ErpItem) {
    onPick(it);
    setShow(false);
    if (it.has_variants) return;
    requestAnimationFrame(() => qtyRef.current?.focus());
  }

  function onNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!show || matches.length === 0) {
      if (e.key === 'ArrowDown') { setShow(true); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[hi];
      if (pick) selectMatch(pick);
    } else if (e.key === 'Escape') {
      setShow(false);
    }
  }

  function onFieldKeyDown(e: React.KeyboardEvent<HTMLInputElement>, next?: () => void) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (next) next();
      else onAppendRow();
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center min-w-[560px] md:min-w-0 border-b border-slate-100 md:border-0 pb-2 md:pb-0">
      <div className="relative col-span-2 md:col-span-1">
        <input ref={nameRef} className="input input-sm" value={row.name}
          onChange={e => onChange({ name: e.target.value, item_id: null, variant_id: null, hasVariants: false })}
          onFocus={() => setShow(true)}
          onBlur={() => setTimeout(() => setShow(false), 180)}
          onKeyDown={onNameKeyDown}
          placeholder="Item name..." />
        {show && matches.length > 0 && (
          <div className="absolute z-20 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
            {matches.map((it, i) => (
              <div key={it.id}
                className={`px-3 py-2 text-sm cursor-pointer flex justify-between ${i === hi ? 'bg-brand-light' : 'hover:bg-brand-light'}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={() => selectMatch(it)}>
                <span>{it.name}</span>
                <span className="text-slate-400 text-xs">{fmtCurrency(it.purchase_price)}</span>
              </div>
            ))}
          </div>
        )}
        {row.hasVariants && row.item_id && (
          <div className="mt-1">
            {loadingVariants ? (
              <div className="text-xs text-slate-400 px-1 py-1">Loading variants…</div>
            ) : variants.length === 0 ? (
              <div className="text-xs text-amber-600 px-1 py-1">No active variants — add them on the Items page.</div>
            ) : (
              <select
                className={`input input-sm ${!row.variant_id ? 'border-amber-400' : ''}`}
                value={row.variant_id || ''}
                onChange={e => {
                  const v = variants.find(x => x.id === e.target.value);
                  if (v) { onPickVariant(v); requestAnimationFrame(() => qtyRef.current?.focus()); }
                }}>
                <option value="">Choose variant…</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.variant_name} · {fmtCurrency(v.purchase_price)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
      <div>
        <label className="label md:hidden">Qty</label>
        <input ref={qtyRef} className="input input-sm text-center" type="number" value={row.qty}
          onChange={e => onChange({ qty: +e.target.value })}
          onKeyDown={e => onFieldKeyDown(e, () => rateRef.current?.focus())} />
      </div>
      <div>
        <label className="label md:hidden">Rate</label>
        <input ref={rateRef} className="input input-sm text-right" type="number" value={row.rate}
          onChange={e => onChange({ rate: +e.target.value })}
          onKeyDown={e => onFieldKeyDown(e)} />
      </div>
      <div>
        <label className="label md:hidden">Amount</label>
        <input className="input input-sm text-right bg-slate-50 font-bold" readOnly tabIndex={-1}
          value={(row.qty * row.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} />
      </div>
      <button className="text-red-500 hover:bg-red-50 rounded w-7 h-7 justify-self-end md:justify-self-auto" onClick={onRemove} tabIndex={-1}>✕</button>
    </div>
  );
}

function Row2({ label, value, red, bold }: { label: string; value: string; red?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between" style={{ fontWeight: bold ? 700 : 400 }}>
      <span className="text-slate-500">{label}</span>
      <span style={{ color: red ? '#dc2626' : undefined }} className="tabular-nums">{value}</span>
    </div>
  );
}
