import type { Invoice } from './supabase';

// Cross-cutting utility (not tied to one table) — used to bucket outstanding
// invoices by age for aging reports / customer statements.

export type AgingBucket = '0-30' | '31-60' | '60+';

export function agingBucket(invoiceDate: string, asOf: Date = new Date()): AgingBucket {
  const days = Math.floor((asOf.getTime() - new Date(invoiceDate).getTime()) / 86400000);
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  return '60+';
}

// Sums `balance` per aging bucket. Only invoices with balance > 0 count
// (fully paid invoices don't contribute to outstanding aging).
export function agingSummary(invoices: Invoice[], asOf: Date = new Date()): Record<AgingBucket, number> {
  const summary: Record<AgingBucket, number> = { '0-30': 0, '31-60': 0, '60+': 0 };
  for (const inv of invoices) {
    if ((inv.balance ?? 0) > 0) {
      const bucket = agingBucket(inv.invoice_date, asOf);
      summary[bucket] += inv.balance;
    }
  }
  return summary;
}
