import { useState, lazy, Suspense } from 'react';
import { Route, Switch, Link, useLocation } from 'wouter';
import { useAuth } from './hooks/useAuth';
import { useOrg } from './lib/orgContext';
import { supabase } from './lib/supabase';
import { Loading } from './components/ui';
// Login + CreateBusiness are the pre-app gates (shown before routing) — keep
// them eager. Everything behind the sidebar is lazy-loaded so each page ships
// as its own chunk and the initial bundle stays small.
import { Login } from './pages/Login';
import { CreateBusiness } from './pages/CreateBusiness';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Items = lazy(() => import('./pages/Items').then(m => ({ default: m.Items })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const Billing = lazy(() => import('./pages/Billing').then(m => ({ default: m.Billing })));
const SalesList = lazy(() => import('./pages/SalesList').then(m => ({ default: m.SalesList })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const Purchases = lazy(() => import('./pages/Purchases').then(m => ({ default: m.Purchases })));
const PurchaseList = lazy(() => import('./pages/PurchaseList').then(m => ({ default: m.PurchaseList })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const InvoicePrint = lazy(() => import('./pages/InvoicePrint').then(m => ({ default: m.InvoicePrint })));

const NAV_SECTIONS: { heading: string; items: { path: string; label: string; icon: string }[] }[] = [
  {
    heading: 'Overview',
    items: [{ path: '/', label: 'Dashboard', icon: '📊' }]
  },
  {
    heading: 'Catalogue',
    items: [
      { path: '/items', label: 'Items', icon: '📦' },
      { path: '/inventory', label: 'Inventory', icon: '🏬' }
    ]
  },
  {
    heading: 'Sales',
    items: [
      { path: '/billing', label: 'New Invoice', icon: '➕' },
      { path: '/sales', label: 'Sale List', icon: '📋' },
      { path: '/customers', label: 'Customers', icon: '🧑‍🤝‍🧑' }
    ]
  },
  {
    heading: 'Purchases',
    items: [
      { path: '/purchases/new', label: 'New Purchase', icon: '➕' },
      { path: '/purchases', label: 'Purchase List', icon: '📥' },
      { path: '/suppliers', label: 'Suppliers', icon: '🏭' }
    ]
  },
  {
    heading: 'Insights',
    items: [{ path: '/reports', label: 'Reports', icon: '📈' }]
  },
  {
    heading: 'Workspace',
    items: [{ path: '/settings', label: 'Settings', icon: '⚙️' }]
  }
];

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };

export default function App() {
  const { session, loading } = useAuth();
  const { orgId, orgName, role, loading: orgLoading } = useOrg();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading || (session && orgLoading)) {
    return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>;
  }

  if (!session) return <Login />;

  // Signed in but no organization yet -> create one (becomes owner).
  if (!orgId) return <CreateBusiness />;

  // Print view is a clean full-page document — no sidebar/dashboard chrome.
  if (location.startsWith('/invoice/') && location.includes('/print/')) {
    return (
      <Suspense fallback={<Loading />}>
        <Switch>
          <Route path="/invoice/:id/print/:format" component={InvoicePrint} />
        </Switch>
      </Suspense>
    );
  }

  const sidebar = (
    <aside className="w-60 bg-white border-r border-slate-200 flex flex-col h-full">
      <div className="p-4 border-b border-slate-200 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand text-white grid place-items-center text-lg shrink-0">📒</div>
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{orgName || 'XL ERP'}</div>
          <div className="text-xs text-brand-dark font-medium">{role ? ROLE_LABEL[role] : ''}</div>
        </div>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_SECTIONS.map(section => (
          <div key={section.heading} className="mb-1">
            <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {section.heading}
            </div>
            {section.items.map(n => {
              const active = location === n.path;
              return (
                <Link key={n.path} href={n.path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer border-l-[3px] transition ${
                    active
                      ? 'bg-brand-light text-brand-dark border-brand font-semibold'
                      : 'text-slate-600 border-transparent hover:bg-slate-50'
                  }`}
                >
                  <span>{n.icon}</span> {n.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <button onClick={() => supabase.auth.signOut()} className="m-3 btn btn-outline btn-sm">
        Sign Out
      </button>
    </aside>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <div className="hidden md:block sticky top-0 h-screen">{sidebar}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}

      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button>
          <span className="font-bold text-sm truncate">{orgName || 'XL ERP'}</span>
        </div>

        <Suspense fallback={<Loading />}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/items" component={Items} />
            <Route path="/inventory" component={Inventory} />
            <Route path="/billing" component={Billing} />
            <Route path="/sales" component={SalesList} />
            <Route path="/customers" component={Customers} />
            <Route path="/purchases/new" component={Purchases} />
            <Route path="/purchases" component={PurchaseList} />
            <Route path="/suppliers" component={Suppliers} />
            <Route path="/reports" component={Reports} />
            <Route path="/settings" component={Settings} />
            {/* /invoice/:id/print/:format is handled by the chrome-free early
                return above — it never reaches this Switch. */}
            <Route><div className="p-8 text-slate-400">Page not found</div></Route>
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}
