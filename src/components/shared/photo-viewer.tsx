'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { UrlRefresher, ViewablePhoto } from '@/lib/receipt-photos';

/**
 * Story 2-5a — the photo primitives staff and the portal share: the modal
 * frame, a presigned image that survives its URL expiring (A28), a tile
 * and the lightbox stage. Portal-allowed: imports no operator hook or
 * component (`lib/portal-boundary.test.ts`).
 *
 * Layer discipline (guide §5): one modal at most. The lightbox is a STAGE
 * inside the frame, not a second modal — Esc on the stage returns to the
 * grid, Esc on the grid closes the frame.
 */

/** A single-stroke camera glyph (aria-hidden — the count beside it carries the meaning). */
export function CameraGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className={className}>
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.6l1-1.5h3.8l1 1.5h1.6A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
      <circle cx="8" cy="8.3" r="2.4" />
    </svg>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one modal layer: a dimmed backdrop, an 8 px panel (the dialog radius),
 * focus moved in on open, held inside (Tab cycles), and returned to the
 * trigger on close (WCAG 2.4.3). `onEscape` decides what Esc does — the
 * caller closes a lightbox stage first.
 */
export function ModalFrame({
  title,
  subtitle,
  onEscape,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onEscape: () => void;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const previously = document.activeElement;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        escape.current();
        return;
      }
      if (event.key !== 'Tab' || panel.current === null) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previously instanceof HTMLElement) previously.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[6vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} flex-col gap-3 rounded-lg border border-(--border) bg-(--background) p-4 text-sm text-(--foreground) shadow-xl outline-none`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {subtitle !== undefined && <div className="text-(--muted-foreground)">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-(--border) text-base hover:bg-(--muted)"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A presigned image. When it fails, the refresher decides (A28): refetch
 * the list once (the tile reads "Refreshing…" until the new URL lands),
 * join a refetch already running, or call the image broken — then the tile
 * says so with a Retry. A URL that came back unchanged stays broken.
 */
export function PresignedImage({
  photo,
  alt,
  refresher,
  fit = 'cover',
}: {
  photo: ViewablePhoto & { url: string };
  alt: string;
  refresher: UrlRefresher;
  fit?: 'cover' | 'contain';
}) {
  const [failure, setFailure] = useState<{ url: string; phase: 'refreshing' | 'broken' } | null>(null);
  const url = photo.url;
  const phase = failure !== null && failure.url === url ? failure.phase : null;

  const markBrokenIfUnchanged = () => setFailure((current) => (current !== null && current.url === url ? { url, phase: 'broken' } : current));

  if (phase === 'broken') {
    return (
      <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-center text-xs text-(--muted-foreground)">
        <span>Could not load this photo.</span>
        <button
          type="button"
          className="relative z-10 rounded-sm border border-(--border) bg-(--background) px-2 py-0.5 text-xs text-(--foreground) hover:bg-(--muted)"
          onClick={(event) => {
            event.stopPropagation();
            setFailure({ url, phase: 'refreshing' });
            void refresher.retry().then(markBrokenIfUnchanged);
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (phase === 'refreshing') {
    return (
      <div role="status" className="flex h-full w-full items-center justify-center text-xs text-(--muted-foreground)">
        Refreshing…
      </div>
    );
  }
  return (
    // A presigned S3 URL: a plain <img>, never the Next image optimiser.
    <img
      key={url}
      src={url}
      alt={alt}
      width={photo.width ?? undefined}
      height={photo.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
      onError={() => {
        const outcome = refresher.onImageError({ id: photo.id, url, urlExpiresAt: photo.urlExpiresAt });
        if (outcome === 'broken') {
          setFailure({ url, phase: 'broken' });
          return;
        }
        setFailure({ url, phase: 'refreshing' });
        void refresher.settled().then(markBrokenIfUnchanged);
      }}
    />
  );
}

/** A square tile frame: a photo, or a placeholder with a glyph and words. */
export function TileFrame({ children, tone = 'plain', testId }: { children: ReactNode; tone?: 'plain' | 'warning' | 'muted'; testId?: string }) {
  const border = tone === 'warning' ? 'border-dashed border-(--warning)' : tone === 'muted' ? 'border-dashed border-(--border)' : 'border-(--border)';
  return (
    <div data-testid={testId} className={`relative flex aspect-square w-full flex-col overflow-hidden rounded-md border bg-(--muted) ${border}`}>
      {children}
    </div>
  );
}

/** A placeholder's body: a glyph, a word and a hint — never colour alone. */
export function PlaceholderBody({ glyph, word, hint }: { glyph: string; word: string; hint?: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
      <span aria-hidden className="text-lg leading-none text-(--muted-foreground)">
        {glyph}
      </span>
      <span className="text-xs font-medium">{word}</span>
      {hint !== undefined && <span className="text-[11px] leading-snug text-(--muted-foreground)">{hint}</span>}
    </div>
  );
}

/**
 * The lightbox stage: the photo at its largest (contained), Previous /
 * Next (and ← / →), its position, and the caller's meta and actions below.
 */
export function LightboxStage({
  photo,
  alt,
  position,
  total,
  onPrevious,
  onNext,
  onBack,
  refresher,
  placeholder,
  meta,
  actions,
}: {
  photo: ViewablePhoto;
  alt: string;
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onBack: () => void;
  refresher: UrlRefresher;
  /** What shows when the photo holds no image (a removed or awaited one). */
  placeholder: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const nav = useRef({ onPrevious, onNext });
  useEffect(() => {
    nav.current = { onPrevious, onNext };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (event.key === 'ArrowLeft') nav.current.onPrevious();
      if (event.key === 'ArrowRight') nav.current.onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="photo-lightbox">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)">
          ← All photos
        </button>
        <span className="data text-xs text-(--muted-foreground)" aria-live="polite">
          {position} of {total}
        </span>
      </div>
      <div className="relative flex h-[60vh] min-h-64 items-center justify-center overflow-hidden rounded-md border border-(--border) bg-(--muted)">
        {photo.url === null ? placeholder : <PresignedImage photo={{ ...photo, url: photo.url }} alt={alt} refresher={refresher} fit="contain" />}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={onPrevious}
              aria-label="Previous photo"
              className="absolute top-1/2 left-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-(--border) bg-(--background) text-base shadow-sm hover:bg-(--muted)"
            >
              <span aria-hidden>‹</span>
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next photo"
              className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-(--border) bg-(--background) text-base shadow-sm hover:bg-(--muted)"
            >
              <span aria-hidden>›</span>
            </button>
          </>
        )}
      </div>
      {meta}
      {actions}
    </div>
  );
}
