import { useEffect, useState, useCallback } from 'react';
import { variantService } from '../lib/variantService';
import type { ErpItemVariant } from '../lib/supabase';
import { Loading, ErrorState, RoleGate, fmtCurrency } from './ui';

// Sub-editor for an item's variants. Requires a saved item (needs item_id).
export function VariantEditor({ itemId }: { itemId: string }) {
  const [variants, setVariants] = useState<ErpItemVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<ErpItemVariant | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      setVariants(await variantService.listByItem(itemId));
    } catch (e: any) {
      setErr(e.message || 'Could not load variants');
    } finally { setLoading(false); }
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  async function remove(v: ErpItemVariant) {
    if (!confirm(`Delete variant "${v.variant_name}"?`)) return;
    try {
      await variantService.remove(v.id);
      load();
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    }
  }

  if (loading) return <Loading msg="Loading variants…" />;
  if (err) return <ErrorState msg={err} onRetry={load} />;

  return (
    <div className="space-y-2">
      {variants.length === 0 ? (
        <p className="text-xs text-slate-400">No variants yet. Add one below (e.g. "Red / Large").</p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {variants.map(v => (
            <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{v.variant_name}</div>
                <div className="text-xs text-slate-400 truncate">
                  {v.sku ? <span className="font-mono">{v.sku}</span> : 'No SKU'}
                  {Object.keys(v.attributes || {}).length > 0 && (
                    <span> · {Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(', ')}</span>
                  )}
                </div>
              </div>
              <div className="text-right text-brand-dark font-bold">{fmtCurrency(v.sale_price)}</div>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(v)}>Edit</button>
              <RoleGate allow={['owner', 'admin']}>
                <button className="text-red-500 hover:bg-red-50 rounded w-7 h-7" type="button" onClick={() => remove(v)}>✕</button>
              </RoleGate>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing('new')}>➕ Add Variant</button>

      {editing && (
        <VariantRowEditor
          itemId={itemId}
          variant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// Inline add/edit form for a single variant.
function VariantRowEditor({ itemId, variant, onClose, onSaved }: {
  itemId: string;
  variant: ErpItemVariant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialAttrs = Object.entries(variant?.attributes || {});
  const [form, setForm] = useState<Partial<ErpItemVariant>>(
    variant || { variant_name: '', sku: '', sale_price: 0, purchase_price: 0, mrp: 0, status: 'active' }
  );
  // Up to two simple key/value attribute pairs (minimal UI).
  const [attrs, setAttrs] = useState<{ k: string; v: string }[]>(
    initialAttrs.length ? initialAttrs.map(([k, v]) => ({ k, v })) : [{ k: '', v: '' }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof ErpItemVariant, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setAttr = (i: number, field: 'k' | 'v', val: string) =>
    setAttrs(a => a.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  async function save() {
    if (!form.variant_name?.trim()) { setErr('Variant name is required'); return; }
    setBusy(true); setErr('');
    const attributes: Record<string, string> = {};
    attrs.forEach(({ k, v }) => { if (k.trim()) attributes[k.trim()] = v.trim(); });
    const payload: Partial<ErpItemVariant> = {
      item_id: itemId,
      variant_name: form.variant_name.trim(),
      sku: form.sku?.trim() || null,
      sale_price: form.sale_price || 0,
      purchase_price: form.purchase_price || 0,
      mrp: form.mrp || 0,
      status: form.status || 'active',
      attributes
    };
    try {
      if (variant) await variantService.update(variant.id, payload);
      else await variantService.create(payload);
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Save failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="border border-brand/40 bg-brand-light/30 rounded-lg p-3 space-y-3">
      <div>
        <label className="label">Variant Name *</label>
        <input className="input" value={form.variant_name || ''} autoFocus
          placeholder="e.g. Red / Large"
          onChange={e => set('variant_name', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">SKU (optional)</label>
          <input className="input" value={form.sku || ''} onChange={e => set('sku', e.target.value)} />
        </div>
        <div>
          <label className="label">Sale Price (₹)</label>
          <input className="input" type="number" value={form.sale_price ?? ''} onChange={e => set('sale_price', +e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <RoleGate allow={['owner', 'admin']}>
          <div>
            <label className="label">Purchase Price (₹)</label>
            <input className="input" type="number" value={form.purchase_price ?? ''} onChange={e => set('purchase_price', +e.target.value)} />
          </div>
        </RoleGate>
        <div>
          <label className="label">MRP (₹)</label>
          <input className="input" type="number" value={form.mrp ?? ''} onChange={e => set('mrp', +e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Attributes (optional)</label>
        <div className="space-y-2">
          {attrs.map((row, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input className="input input-sm" placeholder="e.g. Color" value={row.k} onChange={e => setAttr(i, 'k', e.target.value)} />
              <input className="input input-sm" placeholder="e.g. Red" value={row.v} onChange={e => setAttr(i, 'v', e.target.value)} />
            </div>
          ))}
          {attrs.length < 4 && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAttrs(a => [...a, { k: '', v: '' }])}>
              + attribute
            </button>
          )}
        </div>
      </div>

      {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{err}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={busy}>{busy ? '…' : '💾 Save Variant'}</button>
      </div>
    </div>
  );
}
