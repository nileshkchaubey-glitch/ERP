import { useEffect, useState } from 'react';
import { itemService } from '../lib/itemService';
import { stockService, customerService } from '../lib/erpServices';
import { orgService } from '../lib/orgService';
import { useOrg } from '../lib/orgContext';
import type { Warehouse, CustomFieldDef, Customer, OrgSettings, OrgMember } from '../lib/supabase';
import { PageHeader, PageBody, RoleGate, Button, Input, Select, Field, Badge, Loading } from '../components/ui';

export function Settings() {
  return (
    <>
      <PageHeader title="⚙️ Settings" subtitle="Business profile, team, and catalogue configuration" />
      <PageBody>
        <div className="grid md:grid-cols-2 gap-4">
          <RoleGate allow={['owner', 'admin']}>
            <BusinessProfile />
          </RoleGate>
          <RoleGate allow={['owner', 'admin']}>
            <TeamMembers />
          </RoleGate>
          <WarehouseSettings />
          <CustomFieldSettings />
          <CustomerSettings />
        </div>
      </PageBody>
    </>
  );
}

// ─── Business profile (org_settings) ───
function BusinessProfile() {
  const { orgId } = useOrg();
  const [s, setS] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (orgId) orgService.getSettings(orgId).then(setS);
  }, [orgId]);

  function set<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setS(prev => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!orgId || !s) return;
    setSaving(true);
    try {
      await orgService.updateSettings(orgId, {
        shop_name: s.shop_name,
        owner_name: s.owner_name,
        phone: s.phone,
        address: s.address,
        state: s.state,
        gstin: s.gstin,
        invoice_prefix: s.invoice_prefix,
        print_format: s.print_format,
        terms: s.terms,
        logo_url: s.logo_url
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!s) {
    return <div className="card"><Loading msg="Loading business profile…" /></div>;
  }

  return (
    <div className="card md:col-span-2">
      <div className="text-xs font-bold text-slate-600 uppercase mb-3">🏢 Business Profile</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Shop name"><Input value={s.shop_name ?? ''} onChange={e => set('shop_name', e.target.value)} /></Field>
        <Field label="Owner name"><Input value={s.owner_name ?? ''} onChange={e => set('owner_name', e.target.value)} /></Field>
        <Field label="Phone"><Input value={s.phone ?? ''} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="GSTIN"><Input value={s.gstin ?? ''} onChange={e => set('gstin', e.target.value)} /></Field>
        <Field label="State"><Input value={s.state ?? ''} onChange={e => set('state', e.target.value)} /></Field>
        <Field label="Invoice prefix"><Input value={s.invoice_prefix ?? ''} onChange={e => set('invoice_prefix', e.target.value)} /></Field>
        <Field label="Print format">
          <Select value={s.print_format} onChange={e => set('print_format', e.target.value as OrgSettings['print_format'])}>
            <option value="a4">A4</option>
            <option value="thermal">Thermal</option>
            <option value="both">Both</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address"><Input value={s.address ?? ''} onChange={e => set('address', e.target.value)} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Invoice terms"><Input value={s.terms ?? ''} onChange={e => set('terms', e.target.value)} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Logo URL">
            <Input
              placeholder="https://example.com/logo.png"
              value={s.logo_url ?? ''}
              onChange={e => set('logo_url', e.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
        {saved && <span className="text-xs text-emerald-600 font-semibold">Saved ✓</span>}
      </div>
    </div>
  );
}

// ─── Team members ───
const ROLE_TONE = { owner: 'brand', admin: 'blue', staff: 'slate' } as const;

function TeamMembers() {
  const { role: myRole } = useOrg();
  const [list, setList] = useState<OrgMember[] | null>(null);

  const load = () => orgService.listMembers().then(setList);
  useEffect(() => { load(); }, []);

  async function changeRole(m: OrgMember, role: 'owner' | 'admin' | 'staff') {
    await orgService.setRole(m.id, role);
    load();
  }
  async function toggleActive(m: OrgMember) {
    await orgService.setActive(m.id, !m.is_active);
    load();
  }

  // Only the owner can change owner/admin assignments; admins manage staff.
  const canManage = myRole === 'owner';

  return (
    <div className="card md:col-span-2">
      <div className="text-xs font-bold text-slate-600 uppercase mb-1">👤 Team Members</div>
      <p className="text-xs text-slate-400 mb-3">
        Email invites arrive in a later phase. For now, users who sign up and join this org appear here.
      </p>
      {!list ? (
        <Loading msg="Loading members…" />
      ) : (
        <div className="space-y-2">
          {list.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-slate-100">
              <div className="min-w-0">
                <span className="font-mono text-xs text-slate-500 truncate block">{m.user_id}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!m.is_active && <Badge tone="red">Inactive</Badge>}
                {canManage && m.role !== 'owner' ? (
                  <Select
                    className="w-28 text-xs py-1"
                    value={m.role}
                    onChange={e => changeRole(m, e.target.value as 'admin' | 'staff')}
                  >
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </Select>
                ) : (
                  <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                )}
                {canManage && m.role !== 'owner' && (
                  <Button size="sm" variant="outline" onClick={() => toggleActive(m)}>
                    {m.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WarehouseSettings() {
  const [list, setList] = useState<Warehouse[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const load = () => stockService.listWarehouses().then(setList);
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim()) return;
    await stockService.createWarehouse(name.trim(), code.trim() || name.trim().slice(0, 4).toUpperCase());
    setName(''); setCode(''); load();
  }

  return (
    <div className="card">
      <div className="text-xs font-bold text-slate-600 uppercase mb-3">🏬 Warehouses</div>
      <div className="space-y-2 mb-3">
        {list.map(w => (
          <div key={w.id} className="flex justify-between items-center text-sm py-1.5 border-b border-slate-100">
            <span className="font-semibold">{w.name} <span className="text-slate-400 text-xs">({w.code})</span></span>
            {w.is_default && <Badge tone="brand">Default</Badge>}
          </div>
        ))}
      </div>
      <RoleGate allow={['owner', 'admin']}>
        <div className="flex gap-2">
          <Input className="flex-1" placeholder="Warehouse name" value={name} onChange={e => setName(e.target.value)} />
          <Input className="w-24" placeholder="Code" value={code} onChange={e => setCode(e.target.value)} />
          <Button size="sm" onClick={add}>Add</Button>
        </div>
      </RoleGate>
    </div>
  );
}

function CustomFieldSettings() {
  const [list, setList] = useState<CustomFieldDef[]>([]);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'text' | 'number' | 'select' | 'date'>('text');

  const load = () => itemService.listCustomFields().then(setList);
  useEffect(() => { load(); }, []);

  async function add() {
    if (!label.trim()) return;
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    await itemService.addCustomField({ field_key: key, field_label: label.trim(), field_type: type, options: null, sort_order: list.length });
    setLabel(''); load();
  }
  async function remove(id: string) {
    if (!confirm('Remove this field?')) return;
    await itemService.removeCustomField(id); load();
  }

  return (
    <div className="card">
      <div className="text-xs font-bold text-slate-600 uppercase mb-1">🧩 Custom Item Fields</div>
      <p className="text-xs text-slate-400 mb-3">Create your own fields — they appear automatically on the Item form.</p>
      <div className="space-y-2 mb-3">
        {list.length === 0 && <p className="text-xs text-slate-400">No custom fields yet.</p>}
        {list.map(f => (
          <div key={f.id} className="flex justify-between items-center text-sm py-1.5 border-b border-slate-100">
            <span className="font-semibold">{f.field_label} <span className="text-slate-400 text-xs">({f.field_type})</span></span>
            <RoleGate allow={['owner', 'admin']}>
              <Button size="sm" variant="danger" onClick={() => remove(f.id)}>Remove</Button>
            </RoleGate>
          </div>
        ))}
      </div>
      <RoleGate allow={['owner', 'admin']}>
        <div className="flex gap-2">
          <Input className="flex-1" placeholder="Field name (e.g. Material)" value={label} onChange={e => setLabel(e.target.value)} />
          <Select className="w-24" value={type} onChange={e => setType(e.target.value as any)}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Select</option>
            <option value="date">Date</option>
          </Select>
          <Button size="sm" onClick={add}>Add</Button>
        </div>
      </RoleGate>
    </div>
  );
}

function CustomerSettings() {
  const [list, setList] = useState<Customer[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const load = () => customerService.list().then(setList);
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim()) return;
    await customerService.create({ name: name.trim(), phone: phone.trim() || null });
    setName(''); setPhone(''); load();
  }

  return (
    <div className="card">
      <div className="text-xs font-bold text-slate-600 uppercase mb-3">👥 Customers ({list.length})</div>
      <div className="space-y-1.5 mb-3 max-h-48 overflow-y-auto">
        {list.map(c => (
          <div key={c.id} className="flex justify-between text-sm py-1 border-b border-slate-100">
            <span className="font-semibold">{c.name}</span>
            <span className="text-slate-400 text-xs">{c.phone || '-'}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input className="flex-1" placeholder="Customer name" value={name} onChange={e => setName(e.target.value)} />
        <Input className="w-32" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
        <Button size="sm" onClick={add}>Add</Button>
      </div>
    </div>
  );
}
