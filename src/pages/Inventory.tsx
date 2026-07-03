import { Fragment, useEffect, useState, useCallback } from 'react';
import { itemService } from '../lib/itemService';
import { stockService } from '../lib/erpServices';
import type { ErpItem, Warehouse } from '../lib/supabase';
import { PageHeader, PageBody, Empty, Button, fmtCurrency } from '../components/ui';
import { toCsv, downloadCsv } from '../lib/csv';

interface VariantStock { variant_id: string; variant_name: string; qty: number; }
interface RawStockRow { item_id: string; item_name?: string; warehouse_id: string; quantity: number; }

export function Inventory() {
  const [items, setItems] = useState<ErpItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // item_id -> total quantity (across all variants + base) in the active warehouse filter
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  // item_id -> per-variant stock breakdown (only variants that hold stock)
  const [variantStock, setVariantStock] = useState<Record<string, VariantStock[]>>({});
  // Raw stock rows (item + warehouse + qty) kept for CSV export.
  const [rawStock, setRawStock] = useState<RawStockRow[]>([]);
  const [wh, setWh] = useState<string>('');
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState<ErpItem | null>(null);

  const load = useCallback(async () => {
    const its = await itemService.list(search);
    setItems(its);
    const allStock = await stockService.allStock();
    setRawStock(allStock.map(s => ({ item_id: s.item_id, item_name: s.item_name, warehouse_id: s.warehouse_id, quantity: s.quantity })));
    const map: Record<string, number> = {};
    // item_id -> variant_id -> { name, qty }
    const vAgg: Record<string, Record<string, VariantStock>> = {};
    allStock.forEach(s => {
      if (!wh || s.warehouse_id === wh) {
        map[s.item_id] = (map[s.item_id] || 0) + s.quantity;
        if (s.variant_id) {
          const byVar = (vAgg[s.item_id] ||= {});
          const existing = byVar[s.variant_id];
          if (existing) existing.qty += s.quantity;
          else byVar[s.variant_id] = { variant_id: s.variant_id, variant_name: s.variant_name || 'Variant', qty: s.quantity };
        }
      }
    });
    const vStock: Record<string, VariantStock[]> = {};
    Object.entries(vAgg).forEach(([id, byVar]) => {
      vStock[id] = Object.values(byVar).sort((a, b) => a.variant_name.localeCompare(b.variant_name));
    });
    setStockMap(map);
    setVariantStock(vStock);
  }, [search, wh]);

  useEffect(() => {
    stockService.listWarehouses().then(ws => {
      setWarehouses(ws);
      const def = ws.find(w => w.is_default) || ws[0];
      if (def) setWh(def.id);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const whName: Record<string, string> = {};
    warehouses.forEach(w => { whName[w.id] = w.name; });
    const rows = rawStock
      .filter(s => !wh || s.warehouse_id === wh)
      .map(s => ({
        item_name: s.item_name || 'Unknown',
        warehouse_name: whName[s.warehouse_id] || 'Unknown',
        quantity: s.quantity
      }));
    downloadCsv('inventory.csv', toCsv(rows, [
      { key: 'item_name', label: 'Item' },
      { key: 'warehouse_name', label: 'Warehouse' },
      { key: 'quantity', label: 'Quantity' }
    ]));
  }

  return (
    <>
      <PageHeader title="🏬 Inventory"
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={rawStock.length === 0}>⬇ Export CSV</Button>} />
      <PageBody>
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <input className="input max-w-xs" placeholder="🔍 Search items..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input max-w-[200px]" value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All Warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>

        {items.length === 0 ? (
          <Empty icon="🏬" title="No items" msg="Add items from the Items page first" />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left px-3 py-2.5">SKU</th>
                  <th className="text-left px-3 py-2.5">Item</th>
                  <th className="text-right px-3 py-2.5">In Stock</th>
                  <th className="text-right px-3 py-2.5">Reorder</th>
                  <th className="text-center px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const qty = stockMap[it.id] || 0;
                  const low = it.reorder_level > 0 && qty <= it.reorder_level;
                  const vRows = variantStock[it.id] || [];
                  return (
                    <Fragment key={it.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-xs text-slate-400 font-mono">{it.sku || '-'}</td>
                        <td className="px-3 py-2.5 font-semibold">{it.name}</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: low ? '#dc2626' : '#4f46e5' }}>
                          {qty} {it.unit}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-400">{it.reorder_level || '-'}</td>
                        <td className="px-3 py-2.5 text-center">
                          {low
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">Low</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">OK</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button className="btn btn-outline btn-sm" onClick={() => setAdjusting(it)}>Adjust</button>
                        </td>
                      </tr>
                      {vRows.map(v => (
                        <tr key={v.variant_id} className="bg-slate-50/40 hover:bg-slate-50">
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5 pl-6 text-sm text-slate-600">
                            <span className="text-slate-300 mr-1">└</span>
                            {v.variant_name}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-brand-dark">
                            {v.qty} {it.unit}
                          </td>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5"></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      {adjusting && (
        <AdjustModal
          item={adjusting}
          warehouses={warehouses}
          defaultWh={wh}
          onClose={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); load(); }}
        />
      )}
    </>
  );
}

function AdjustModal({ item, warehouses, defaultWh, onClose, onDone }: {
  item: ErpItem; warehouses: Warehouse[]; defaultWh: string;
  onClose: () => void; onDone: () => void;
}) {
  const [wh, setWh] = useState(defaultWh || warehouses[0]?.id || '');
  const [mode, setMode] = useState<'set' | 'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply() {
    const n = parseFloat(qty);
    if (!wh) { alert('Please select a warehouse'); return; }
    if (!n || n <= 0) { alert('Please enter a valid quantity'); return; }
    setBusy(true);
    try {
      let change = n;
      let reason = 'adjustment';
      if (mode === 'remove') change = -n;
      if (mode === 'set') {
        // Get current, compute delta
        const stock = await stockService.stockByItem(item.id);
        const current = stock.find(s => s.warehouse_id === wh)?.quantity || 0;
        change = n - current;
        reason = 'adjustment';
      }
      if (mode === 'add' && !note) reason = 'opening';
      await stockService.applyMovement({
        itemId: item.id, warehouseId: wh, change, reason,
        refType: 'adjustment', note: note || mode
      });
      onDone();
    } catch (e: any) {
      alert(e.message || 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold">Adjust Stock — {item.name}</h2>
          <button className="text-slate-400 text-xl px-2" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="label">Warehouse</label>
            <select className="input" value={wh} onChange={e => setWh(e.target.value)}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Action</label>
            <div className="flex gap-2">
              {(['add', 'remove', 'set'] as const).map(m => (
                <button key={m}
                  className={`btn btn-sm flex-1 ${mode === m ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setMode(m)}>
                  {m === 'add' ? '➕ Add' : m === 'remove' ? '➖ Remove' : '= Set'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" value={qty} onChange={e => setQty(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Opening stock, damage, count correction..." />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={apply} disabled={busy}>{busy ? '…' : 'Apply'}</button>
        </div>
      </div>
    </div>
  );
}
