import { useEffect, useRef, useState, useCallback } from 'react';
import { itemService } from '../lib/itemService';
import { variantService } from '../lib/variantService';
import { invoiceService, customerService, stockService } from '../lib/erpServices';
import { orgService } from '../lib/orgService';
import type { ErpItem, ErpItemVariant, Customer, Warehouse, InvoiceItem } from '../lib/supabase';
import { PageHeader, PageBody, RoleGate, fmtCurrency } from '../components/ui';
import { useOrg } from '../lib/orgContext';
import { useLocation } from 'wouter';

interface Row {
  rowId: string;
  item_id: string | null;
  variant_id: string | null;
  baseName: string;       // item name without the variant suffix
  hasVariants: boolean;   // selected item.has_variants
  name: string;
  hsn_code: string | null;
  qty: number;
  rate: number;
  gst_rate: number;
}

const newRow = (): Row => ({ rowId: Math.random().toString(36).slice(2), item_id: null, variant_id: null, baseName: '', hasVariants: false, name: '', hsn_code: null, qty: 1, rate: 0, gst_rate: 0 });

export function Billing() {
  const [, navigate] = useLocation();
  const { role, orgId } = useOrg();
  const canDiscount = !role || role === 'owner' || role === 'admin';
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal'>('a4');
  const [items, setItems] = useState<ErpItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [wh, setWh] = useState('');
  const [payType, setPayType] = useState('Cash');
  const [paid, setPaid] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [showCustList, setShowCustList] = useState(false);
  const [custHi, setCustHi] = useState(0); // highlighted customer-dropdown index
  const [addingCust, setAddingCust] = useState(false);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const printAfterSave = useRef(false);

  useEffect(() => {
    itemService.list().then(setItems);
    stockService.listWarehouses().then(ws => {
      setWarehouses(ws);
      const def = ws.find(w => w.is_default) || ws[0];
      if (def) setWh(def.id);
    });
    invoiceService.nextInvoiceNo().then(setInvoiceNo);
  }, []);

  useEffect(() => {
    if (!orgId) return;
    orgService.getSettings(orgId).then(s => {
      setPrintFormat(s?.print_format === 'thermal' ? 'thermal' : 'a4');
    });
  }, [orgId]);

  const setRow = (rowId: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => r.rowId === rowId ? { ...r, ...patch } : r));

  const removeRow = (rowId: string) =>
    setRows(rs => { const next = rs.filter(r => r.rowId !== rowId); return next.length ? next : [newRow()]; });

  // Totals
  const subtotal = rows.reduce((s, r) => s + r.qty * r.rate, 0);
  const taxable = Math.max(0, subtotal - discount);
  const taxAmount = rows.reduce((s, r) => s + (r.qty * r.rate) * (r.gst_rate / 100), 0);
  const total = taxable + taxAmount;
  const balance = Math.max(0, total - paid);

  function pickItem(rowId: string, item: ErpItem) {
    setRow(rowId, {
      item_id: item.id, variant_id: null, baseName: item.name, hasVariants: !!item.has_variants,
      name: item.name, hsn_code: item.hsn_code, rate: item.sale_price, gst_rate: item.gst_rate
    });
    // For variant items the rate/name finalise once a variant is chosen; skip lastRate prefill here.
    if (item.has_variants) return;
    // Fire-and-forget: if this customer has a last-charged rate for this item, prefill it.
    if (customerId) {
      invoiceService.lastRate(customerId, item.id).then(rate => {
        if (rate != null) {
          setRow(rowId, { rate });
        }
      }).catch(() => {});
    }
  }

  function pickVariant(rowId: string, baseName: string, v: ErpItemVariant) {
    setRow(rowId, {
      variant_id: v.id,
      name: `${baseName} — ${v.variant_name}`,
      rate: v.sale_price || 0
    });
  }

  async function searchCustomer(q: string) {
    setCustomerName(q);
    setCustomerId(null);
    setCustHi(0);
    if (q.trim()) {
      setCustResults(await customerService.list(q));
      setShowCustList(true);
    } else setShowCustList(false);
  }

  function pickCustomer(c: Customer) {
    setCustomerName(c.name);
    setCustomerId(c.id);
    setShowCustList(false);
    // Keyboard-first flow: after choosing the customer, jump to item entry.
    if (rows[0]) setFocusRowId(rows[0].rowId);
  }

  // Keyboard nav for the customer dropdown — mirrors the item rows' pattern.
  // The option list is custResults plus (when the typed name has no exact
  // match) the trailing "+ Add new customer" row.
  const showAddNew = !!customerName.trim() &&
    !custResults.some(c => c.name.toLowerCase() === customerName.trim().toLowerCase());

  function onCustomerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const optionCount = custResults.length + (showAddNew ? 1 : 0);
    if (!showCustList || optionCount === 0) {
      if (e.key === 'ArrowDown' && customerName.trim()) setShowCustList(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCustHi(i => Math.min(i + 1, optionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCustHi(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (custHi < custResults.length) {
        pickCustomer(custResults[custHi]);
      } else if (showAddNew) {
        addNewCustomer(customerName).then(() => {
          if (rows[0]) setFocusRowId(rows[0].rowId);
        });
      }
    } else if (e.key === 'Escape') {
      setShowCustList(false);
    }
  }

  async function addNewCustomer(name: string) {
    if (!name.trim() || addingCust) return;
    setAddingCust(true);
    try {
      const created = await customerService.create({ name: name.trim() });
      if (created) {
        setCustomerName(created.name);
        setCustomerId(created.id);
      }
      setShowCustList(false);
    } catch (e: any) {
      alert(e.message || 'Could not add customer');
    } finally { setAddingCust(false); }
  }

  async function save(): Promise<boolean> {
    if (!customerName.trim()) { alert('Please enter a customer name'); return false; }
    const valid = rows.filter(r => r.name.trim() && r.qty > 0);
    if (valid.length === 0) { alert('Please add at least one item'); return false; }
    const missingVariant = valid.find(r => r.hasVariants && !r.variant_id);
    if (missingVariant) { alert(`Please choose a variant for "${missingVariant.baseName}"`); return false; }
    setBusy(true);
    try {
      const invItems: InvoiceItem[] = valid.map(r => ({
        item_id: r.item_id,
        variant_id: r.variant_id,
        name: r.name,
        hsn_code: r.hsn_code,
        qty: r.qty,
        rate: r.rate,
        gst_rate: r.gst_rate,
        amount: r.qty * r.rate
      }));
      const created = await invoiceService.create({
        invoice_no: invoiceNo,
        customer_id: customerId,
        customer_name: customerName,
        warehouse_id: wh,
        invoice_date: date,
        subtotal, discount, tax_amount: taxAmount, total,
        paid, balance, payment_type: payType, notes, status: 'active'
      }, invItems);
      if (printAfterSave.current) {
        printAfterSave.current = false;
        if (created) {
          navigate(`/invoice/${created.id}/print/${printFormat}?autoprint=1`);
          return true;
        }
      }
      navigate('/sales');
      return true;
    } catch (e: any) {
      alert(e.message || 'Save failed');
      return false;
    } finally { setBusy(false); }
  }

  // Ctrl+S => save. Ctrl+Enter => save + print.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) save();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!busy) { printAfterSave.current = true; save(); }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, customerName, customerId, rows, discount, paid, wh, payType, notes, date, invoiceNo, printFormat]);

  return (
    <>
      <PageHeader title="➕ New Invoice"
        actions={<button className="btn btn-outline btn-sm" onClick={() => navigate('/sales')}>← Sale List</button>} />
      <PageBody>
        <div className="card mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="label">Invoice No</label>
              <input className="input" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} /></div>
            <div><label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label className="label">Warehouse</label>
              <select className="input" value={wh} onChange={e => setWh(e.target.value)}>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
            <div><label className="label">Payment Type</label>
              <select className="input" value={payType} onChange={e => setPayType(e.target.value)}>
                {['Cash', 'Credit', 'UPI', 'NEFT/RTGS', 'Cheque'].map(p => <option key={p}>{p}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="relative">
              <label className="label">Customer *</label>
              <input className="input" value={customerName}
                onChange={e => searchCustomer(e.target.value)}
                onKeyDown={onCustomerKeyDown}
                onBlur={() => setTimeout(() => setShowCustList(false), 180)}
                placeholder="Type customer name..." />
              {showCustList && (custResults.length > 0 || customerName.trim()) && (
                <div className="absolute z-20 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {custResults.map((c, i) => (
                    <div key={c.id}
                      className={`px-3 py-2 text-sm cursor-pointer ${i === custHi ? 'bg-brand-light' : 'hover:bg-brand-light'}`}
                      onMouseEnter={() => setCustHi(i)}
                      onMouseDown={() => pickCustomer(c)}>
                      {c.name} {c.phone && <span className="text-slate-400 text-xs">· {c.phone}</span>}
                    </div>
                  ))}
                  {showAddNew && (
                    <div
                      className={`px-3 py-2 text-sm text-brand-dark font-semibold cursor-pointer border-t border-slate-100 ${custHi === custResults.length ? 'bg-brand-light' : 'hover:bg-brand-light'}`}
                      onMouseEnter={() => setCustHi(custResults.length)}
                      onMouseDown={() => addNewCustomer(customerName)}>
                      {addingCust ? 'Adding…' : `+ Add new customer "${customerName.trim()}"`}
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
            <div className="hidden md:grid grid-cols-[1fr_70px_90px_60px_90px_32px] gap-2 text-xs font-bold text-slate-400 uppercase px-1 min-w-[640px]">
              <div>Item</div><div className="text-center">Qty</div><div className="text-right">Rate</div>
              <div className="text-center">GST</div><div className="text-right">Amount</div><div></div>
            </div>
            {rows.map(r => (
              <ItemRow key={r.rowId} row={r} items={items}
                canDelete={canDiscount}
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
              <RoleGate allow={['owner', 'admin']}>
                <div><label className="label">Discount (₹)</label>
                  <input className="input" type="number" value={discount || ''} onChange={e => setDiscount(+e.target.value)} /></div>
              </RoleGate>
              <div><label className="label">Amount Received (₹)</label>
                <input className="input" type="number" value={paid || ''} onChange={e => setPaid(+e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="text-xs font-bold text-slate-600 uppercase mb-3">Totals</div>
            <div className="space-y-1.5 text-sm">
              <Row2 label="Subtotal" value={fmtCurrency(subtotal)} />
              <Row2 label="Discount" value={'-' + fmtCurrency(discount)} red />
              <Row2 label="Tax" value={fmtCurrency(taxAmount)} />
              <div className="flex justify-between border-t-2 border-slate-300 pt-2 mt-1 font-extrabold text-base">
                <span>TOTAL</span><span className="text-brand-dark">{fmtCurrency(total)}</span>
              </div>
              <Row2 label="Balance Due" value={fmtCurrency(balance)} red={balance > 0} bold />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            {busy ? '…' : '💾 Save Invoice'}
          </button>
        </div>
      </PageBody>
    </>
  );
}

function ItemRow({ row, items, canDelete, autoFocus, onFocused, onPick, onPickVariant, onChange, onRemove, onAppendRow }: {
  row: Row; items: ErpItem[];
  canDelete: boolean;
  autoFocus?: boolean;
  onFocused?: () => void;
  onPick: (it: ErpItem) => void;
  onPickVariant: (v: ErpItemVariant) => void;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onAppendRow: () => void;
}) {
  const [show, setShow] = useState(false);
  const [hi, setHi] = useState(0); // highlighted dropdown index
  const [variants, setVariants] = useState<ErpItemVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const gstRef = useRef<HTMLInputElement>(null);

  // When a has_variants item is selected for this row, load its variants for the picker.
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
    // Variant items need a variant chosen next; the variant <select> handles focus to Qty after.
    if (it.has_variants) return;
    // Move to Qty after picking via keyboard or mouse
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
      else {
        // Last field of the row: append a new row and focus its item-name input
        onAppendRow();
      }
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-[1fr_70px_90px_60px_90px_32px] gap-2 items-center min-w-[640px] md:min-w-0 border-b border-slate-100 md:border-0 pb-2 md:pb-0">
      <div className="relative col-span-2 md:col-span-1">
        <input ref={nameRef} className="input input-sm" value={row.name}
          onChange={e => onChange({ name: e.target.value })}
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
                <span className="text-slate-400 text-xs">{fmtCurrency(it.sale_price)}</span>
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
                    {v.variant_name} · {fmtCurrency(v.sale_price)}
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
          onKeyDown={e => onFieldKeyDown(e, () => gstRef.current?.focus())} />
      </div>
      <div>
        <label className="label md:hidden">GST %</label>
        <input ref={gstRef} className="input input-sm text-center" type="number" value={row.gst_rate}
          onChange={e => onChange({ gst_rate: +e.target.value })}
          onKeyDown={e => onFieldKeyDown(e)} />
      </div>
      <div>
        <label className="label md:hidden">Amount</label>
        <input className="input input-sm text-right bg-slate-50 font-bold" readOnly tabIndex={-1}
          value={(row.qty * row.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} />
      </div>
      {canDelete ? (
        <button className="text-red-500 hover:bg-red-50 rounded w-7 h-7 justify-self-end md:justify-self-auto" onClick={onRemove} tabIndex={-1}>✕</button>
      ) : <div />}
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
