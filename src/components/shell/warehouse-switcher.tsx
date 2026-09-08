'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function WarehouseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 9l9-6 9 9v11H3z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

/**
 * Warehouse switcher (mockup `.wh` block): code+name, "Warehouse N of M",
 * chevron disclosure listing the tenant's warehouses. Data comes from the
 * shared `useTenantWarehouses` hook (session-identity-scoped, full cursor
 * chain); the picked warehouse persists in localStorage scoped per tenant —
 * there is no server-side active warehouse yet (Epic 2).
 *
 * `className` decides visibility per mount: the desktop sidebar passes the
 * ≥lg-only classes, the mobile header menu mounts it always-visible
 * (review loop 2 — mobile users pick warehouses too). `onPicked` runs after
 * the pick so the mobile mount can close the surrounding `<details>` menu —
 * the desktop sidebar omits it.
 */
export function WarehouseSwitcher({
  className = '',
  onPicked,
}: {
  className?: string;
  onPicked?: () => void;
}) {
  const { tenantId, items } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc closes the disclosure (⌘K palette convention); a click outside
  // closes it too — the absolute list overlays surrounding controls, so
  // leaving it open strands a floating panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (tenantId === null) return null;

  if (items.length === 0) {
    return (
      <div className={`border-b border-(--border) px-3 py-2 lg:px-4 ${className}`}>
        <Link href="/settings" className="text-xs text-(--muted-foreground) underline underline-offset-2">
          No warehouse yet — create one in Settings
        </Link>
      </div>
    );
  }

  const index = Math.max(
    items.findIndex((w) => w.id === (activeId ?? items[0]?.id)),
    0,
  );
  const active = items[index];
  if (active === undefined) return null;

  function pick(id: string) {
    writeActiveWarehouseId(tenantId!, id);
    setOpen(false);
    onPicked?.();
  }

  return (
    <div ref={rootRef} className={`relative border-b border-(--border) px-3 py-2 lg:px-4 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-xs hover:bg-(--muted)"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-(--border)" aria-hidden>
          <WarehouseGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate">
            {active.code} {active.name}
          </b>
          <span className="block text-(--muted-foreground)">Warehouse {index + 1} of {items.length}</span>
        </span>
        <ChevronDown />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Warehouses"
          className="absolute inset-x-3 top-full z-10 mt-1 flex flex-col rounded-md border border-(--border) bg-(--card) p-1 shadow-md lg:inset-x-4"
        >
          {items.map((warehouse, i) => (
            <li key={warehouse.id}>
              <button
                type="button"
                role="option"
                aria-selected={warehouse.id === active.id}
                onClick={() => pick(warehouse.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs ${
                  warehouse.id === active.id ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
                }`}
              >
                <span className="truncate">
                  {warehouse.code} {warehouse.name}
                </span>
                <span className="shrink-0 text-(--muted-foreground)">{i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}