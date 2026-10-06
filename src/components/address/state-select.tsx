'use client';

import { STATE_OPTIONS } from '@/lib/gst-states';

/**
 * The address State input (story 8-1d): a select over the OFFICIAL GST state
 * names instead of free text, so a web-entered address always resolves to a
 * state code (invoices then never warn "State not recognised" for it, and an
 * e-way bill is never blocked as `state-unresolved`). The value sent is the
 * official name.
 *
 * Options: a blank placeholder (the form starts unchosen, and `required`
 * refuses it natively), then the names for codes 01–38 and 97 — never 99.
 * The backend still accepts free text (channel and API orders); only this
 * form narrows it.
 */
export function StateSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Pick a state…</option>
      {STATE_OPTIONS.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}
