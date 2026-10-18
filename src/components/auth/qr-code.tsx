'use client';

import { useEffect, useState } from 'react';

/**
 * Story 6-1b — the enrolment QR code. `qrcode` is loaded with `import()` in
 * this component only (it never reaches any other bundle), and the matrix is
 * drawn as React `<rect>`s from `QRCode.create(uri).modules` — never inner
 * HTML. The URI never leaves the browser.
 */
export function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const [matrix, setMatrix] = useState<{ value: string; size: number; dark: readonly boolean[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('qrcode')
      .then((module) => {
        const QRCode = (module as unknown as { default?: typeof module }).default ?? module;
        const modules = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;
        const dark: boolean[] = [];
        for (let i = 0; i < modules.size * modules.size; i += 1) dark.push(Boolean(modules.data[i]));
        if (!cancelled) setMatrix({ value, size: modules.size, dark });
      })
      .catch(() => {
        // The secret below is the fallback: type it into the app.
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const current = matrix !== null && matrix.value === value ? matrix : null;
  if (current === null) {
    return (
      <div
        role="img"
        aria-label={label}
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-md border border-(--border) text-xs text-(--muted-foreground)"
      >
        Loading QR code…
      </div>
    );
  }
  const quiet = 2;
  const extent = current.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className="rounded-md border border-(--border) bg-white"
    >
      <rect x={0} y={0} width={extent} height={extent} fill="#ffffff" />
      {current.dark.map((on, index) =>
        on ? (
          <rect
            key={index}
            x={(index % current.size) + quiet}
            y={Math.floor(index / current.size) + quiet}
            width={1}
            height={1}
            fill="#000000"
          />
        ) : null,
      )}
    </svg>
  );
}
