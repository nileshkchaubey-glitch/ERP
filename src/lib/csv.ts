// Pure, framework-agnostic CSV utilities for report exports.
// No React, no Supabase — safe to import from any component or service.

export interface CsvColumn {
  key: string;
  label: string;
}

// Escapes a single CSV field per RFC 4180: wraps in double-quotes and doubles
// any embedded double-quotes whenever the value contains a comma, quote, or
// newline (or is otherwise not safe to leave bare).
function escapeCsvValue(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, any>[], columns: CsvColumn[]): string {
  const header = columns.map(c => escapeCsvValue(c.label)).join(',');
  const body = rows.map(row => columns.map(c => escapeCsvValue(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

// Triggers a browser download of the given CSV content via a temporary <a> element.
export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
