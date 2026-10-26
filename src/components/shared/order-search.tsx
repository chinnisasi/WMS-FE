'use client';

import { useState } from 'react';

import { parseOrderSearch } from '@/lib/orders';

import { Field } from '@/components/shared/field';
import { buttonClass, inputClass } from '@/components/shared/surface';

/**
 * Story 4-1b — the order list's exact-match search box, shared by the staff
 * Outbound orders table and the portal's Orders list (it holds only its own
 * typed text, so it crosses the portal boundary). Nothing is searched until
 * Search (or Enter): the applied value is the caller's, which keys its table
 * and its cursor on it, so a new search starts on page one. Blank is no
 * search; over 200 characters is refused here (the server would answer 400)
 * and nothing is sent. Clear drops the search.
 */
export function OrderSearch({
  applied,
  onSearch,
  label,
  placeholder,
}: {
  /** The search in force (null: none) — Clear shows only while one is. */
  applied: string | null;
  onSearch: (reference: string | null) => void;
  label: string;
  placeholder: string;
}) {
  const [text, setText] = useState(applied ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseOrderSearch(text);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    onSearch(parsed.reference);
  }

  return (
    <form role="search" aria-label={label} onSubmit={submit} className="flex flex-col gap-1">
      {/* Story UI-2 (W9) — the shared Field contract: the label, and the
          problem in text below, tied to the input by aria-describedby. */}
      <Field label={label} error={problem} className="flex flex-col gap-1 text-xs [&>label]:text-xs [&>label]:font-normal [&>label]:text-(--muted-foreground)">
        {(control) => (
          <div className="flex flex-wrap items-center gap-2">
            <input
              {...control}
              className={`${inputClass} w-56 py-1`}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setProblem(null);
              }}
              placeholder={placeholder}
            />
            <button type="submit" className={`${buttonClass} py-1`}>
              Search
            </button>
            {applied !== null && (
              <button
                type="button"
                className={`${buttonClass} py-1`}
                onClick={() => {
                  setText('');
                  setProblem(null);
                  onSearch(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </Field>
    </form>
  );
}
