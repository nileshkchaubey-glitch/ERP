import { useEffect, useState, useCallback, useRef } from 'react';
import { itemService } from '../lib/itemService';
import { useOrg } from '../lib/orgContext';
import type { ErpItem, CustomFieldDef } from '../lib/supabase';
import { PageHeader, PageBody, Empty, Loading, ErrorState, RoleGate, Button, Pagination, fmtCurrency } from '../components/ui';
import { VariantEditor } from '../components/VariantEditor';
import { toCsv, downloadCsv } from '../lib/csv';

const UNITS = ['Pcs', 'Box', 'Kg', 'Gms', 'Ltr', 'Mtr', 'Set', 'Dozen', 'Pkt'];
const GST_RATES = [0, 5, 12, 18, 28];
const PAGE_SIZE = 50;

export function Items() {
  const { role } = useOrg();
  const canSeeCost = role === 'owner' || role === 'admin';
  const [items, setItems] = useState<ErpItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState(''); // search, debounced (drives the fetch)
  const [editing, setEditing] = useState<ErpItem | 'new' | null>(null);
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr('');
    try {
      const { rows, total } = await itemService.listPaged(debSearch, page, PAGE_SIZE);
      if (seq !== loadSeq.current) return; // stale response — a newer request is in flight
      setItems(rows);
      setTotal(total);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setErr(e.message || 'Failed to load items');
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
  useEffect(() => { itemService.listCustomFields().then(setCustomDefs); }, []);

  async function exportCsv() {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'sku', label: 'SKU' },
      { key: 'category', label: 'Category' },
      { key: 'sale_price', label: 'Sale Price' },
      ...(canSeeCost ? [{ key: 'purchase_price', label: 'Purchase Price' }] : []),
      { key: 'reorder_level', label: 'Reorder Level' }
    ];
    // Export the full matching set, not just the current page.
    const all = await itemService.list(search);
    downloadCsv('items.csv', toCsv(all, columns));
  }

  return (
    <>
      <PageHeader
        title="📦 Items"
        actions={<>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>⬇ Export CSV</Button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>➕ New Item</button>
        </>}
      />
      <PageBody>
        <div className="mb-4 max-w-md">
          <input
            className="input"
            placeholder="🔍 Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading && items.length === 0 ? (
          <Loading msg="Loading items…" />
        ) : err ? (
          <ErrorState msg={err} onRetry={load} />
        ) : items.length === 0 ? (
          <Empty icon="📦" title="No items yet" msg="Use the New Item button to add one" />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-3 py-2.5">SKU</th>
                  <th className="text-left px-3 py-2.5">Name</th>
                  <th className="text-left px-3 py-2.5">Category</th>
                  <th className="text-left px-3 py-2.5">Unit</th>
                  <th className="text-right px-3 py-2.5">Sale Rate</th>
                  <th className="text-right px-3 py-2.5">GST</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setEditing(it)}>
                    <td className="px-3 py-2.5 text-xs text-slate-400 font-mono">{it.sku || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold">{it.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{it.category || '-'}</td>
                    <td className="px-3 py-2.5">{it.unit}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-brand-dark">{fmtCurrency(it.sale_price)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">{it.gst_rate}%</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        it.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                      }`}>{it.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </PageBody>

      {editing && (
        <ItemEditor
          item={editing === 'new' ? null : editing}
          customDefs={customDefs}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

// ─── Item Editor Modal (4 groups + custom fields) ───
function ItemEditor({ item, customDefs, onClose, onSaved }: {
  item: ErpItem | null;
  customDefs: CustomFieldDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<ErpItem>>(
    item || { unit: 'Pcs', gst_rate: 0, status: 'active', pack_size: 1, custom_fields: {} }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof ErpItem, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setCustom = (key: string, v: string) =>
    setForm(f => ({ ...f, custom_fields: { ...(f.custom_fields || {}), [key]: v } }));

  async function save() {
    if (!form.name?.trim()) { setErr('Please enter an item name'); return; }
    setBusy(true); setErr('');
    try {
      if (item) await itemService.update(item.id, form);
      else await itemService.create(form);
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Save failed');
    } finally { setBusy(false); }
  }

  async function del() {
    if (!item || !confirm(`Delete "${item.name}"?`)) return;
    await itemService.remove(item.id);
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold">{item ? '✏️ Edit Item' : '➕ New Item'}</h2>
          <button className="text-slate-400 text-xl px-2" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Group A: Identity */}
          <Section title="Identity">
            <Field label="Item Name *">
              <input className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU (auto if blank)">
                <input className="input" value={form.sku || ''} onChange={e => set('sku', e.target.value)} placeholder="XLT-auto" />
              </Field>
              <Field label="Category">
                <input className="input" value={form.category || ''} onChange={e => set('category', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Brand">
                <input className="input" value={form.brand || ''} onChange={e => set('brand', e.target.value)} />
              </Field>
              <Field label="Unit">
                <select className="input" value={form.unit} onChange={e => set('unit', e.target.value)}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="HSN Code">
                <input className="input" value={form.hsn_code || ''} onChange={e => set('hsn_code', e.target.value)} />
              </Field>
            </div>
          </Section>

          {/* Group B: Pricing */}
          <Section title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <RoleGate allow={['owner', 'admin']}>
                <Field label="Purchase Price (₹)">
                  <input className="input" type="number" value={form.purchase_price ?? ''} onChange={e => set('purchase_price', +e.target.value)} />
                </Field>
              </RoleGate>
              <Field label="Sale Price (₹)">
                <input className="input" type="number" value={form.sale_price ?? ''} onChange={e => set('sale_price', +e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="MRP (₹)">
                <input className="input" type="number" value={form.mrp ?? ''} onChange={e => set('mrp', +e.target.value)} />
              </Field>
              <Field label="GST %">
                <select className="input" value={form.gst_rate} onChange={e => set('gst_rate', +e.target.value)}>
                  {GST_RATES.map(g => <option key={g} value={g}>{g === 0 ? 'No Tax' : g + '%'}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          {/* Group C: Inventory */}
          <Section title="Inventory">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reorder Level">
                <input className="input" type="number" value={form.reorder_level ?? ''} onChange={e => set('reorder_level', +e.target.value)} />
              </Field>
              <Field label="Status">
                <select className="input" value={form.status} onChange={e => set('status', e.target.value as any)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="discontinued">Discontinued</option>
                </select>
              </Field>
            </div>
            <p className="text-xs text-slate-400">Add opening stock from the Inventory page (per warehouse).</p>
          </Section>

          {/* Group C2: Variants */}
          <RoleGate allow={['owner', 'admin']}>
            <Section title="Variants">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-brand"
                  checked={!!form.has_variants}
                  onChange={e => set('has_variants', e.target.checked)} />
                <span className="text-sm font-medium">This item has variants (e.g. size / colour)</span>
              </label>
              {form.has_variants && (
                item ? (
                  <VariantEditor itemId={item.id} />
                ) : (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                    Save the item first, then reopen it to add variants.
                  </p>
                )
              )}
            </Section>
          </RoleGate>

          {/* Group D: Custom fields (operator-defined) */}
          {customDefs.length > 0 && (
            <Section title="Custom">
              <div className="grid grid-cols-2 gap-3">
                {customDefs.map(def => (
                  <Field key={def.id} label={def.field_label}>
                    {def.field_type === 'select' ? (
                      <select className="input"
                        value={form.custom_fields?.[def.field_key] || ''}
                        onChange={e => setCustom(def.field_key, e.target.value)}>
                        <option value="">—</option>
                        {(def.options || []).map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="input" type={def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'}
                        value={form.custom_fields?.[def.field_key] || ''}
                        onChange={e => setCustom(def.field_key, e.target.value)} />
                    )}
                  </Field>
                ))}
              </div>
            </Section>
          )}

          {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          {item && (
            <RoleGate allow={['owner', 'admin']}>
              <button className="btn btn-danger btn-sm mr-auto" onClick={del}>🗑 Delete</button>
            </RoleGate>
          )}
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : '💾 Save'}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-brand-dark uppercase tracking-wide mb-2.5">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
