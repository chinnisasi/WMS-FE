'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiAddReceiptPhoto, fetchApiRemoveReceiptPhoto } from '@/lib/api/client';
import type { GoodsReceiptLineEntryDto, ReceiptPhotoViewDto, SkuResponse } from '@/lib/api/generated';
import { notifyInboundChanged } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { grnLineConditionLabel, grnLineRecallLabel } from '@/lib/grn-lines';
import { StatusChip } from '@/components/shared/status-chip';
import {
  MAX_REMOVE_REASON_LENGTH,
  PHOTO_ACCEPT,
  PHOTO_STATUS_HINT,
  PHOTO_STATUS_LABEL,
  STORAGE_OFF_REASON,
  STORAGE_OFF_WORD,
  addPhotoBlocker,
  addPhotoReason,
  createUrlRefresher,
  isLivePhoto,
  noRoomSentence,
  photoRoom,
  skippedPhotosSentence,
  parseRemoveReason,
  reasonLength,
  photoCountLabel,
  photoDimensions,
  photoProvenance,
  photoRemovedLine,
  prepareImageForUpload,
  removePhotoReason,
  removeVerb,
  type PrepareDeps,
} from '@/lib/receipt-photos';
import { ulid } from '@/lib/ulid';
import { useGoodsReceiptLines } from '@/lib/use-grn-lines';
import { useReceiptPhotos } from '@/lib/use-receipt-photos';
import { roleHasCapability } from '@/lib/users';

import { FeedbackBanner } from '@/components/feedback/banner';
import { CameraGlyph, LightboxStage, ModalFrame, PlaceholderBody, PresignedImage, TileFrame } from '@/components/shared/photo-viewer';
import { ReadFailure, buttonClass, primaryClass, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 2-5a — a goods receipt's damage photos, opened from a line's photo
 * button (that line) or from the receipt row's indicator (every line).
 *
 * - A grid per line: attached photos (a presigned image), and placeholders
 *   that say what they are in words — "On its way" (awaited: the handheld
 *   has not synced it), "Never arrived" (expired), "Removed" (who, when and
 *   why — never the image, A20).
 * - A tile opens the lightbox stage (← / →, "1 of 5", the provenance and
 *   size, Open full size). It is a stage inside this one modal, never a
 *   second modal.
 * - Add photo (`receipt.attach`): each file is re-encoded in the browser
 *   (`prepareImageForUpload`, decision 4) and POSTed with its own key; a
 *   failed upload keeps the PREPARED file and its key, so Retry replays the
 *   same bytes under the same key. The line cap (10) is checked against the
 *   list on screen; the server's 409 is the ruling.
 * - Remove / Cancel (`receipt.photo-remove`): an inline confirmation with a
 *   reason (1–200). The key is bound to the photo and the reason — the
 *   reason is in the request hash — so a retry of the same reason replays
 *   and an edited one mints a new key.
 * - An expired URL refetches the list once, deduped (A28).
 *
 * Pessimistic throughout: nothing is painted before the server answers; a
 * write ends with `notifyInboundChanged()`, which re-reads this list (quietly),
 * the lines' counts and the receipt row's indicator.
 */
export function ReceiptPhotosDialog({
  grnId,
  grnCode,
  focusLineId,
  skuMap,
  onClose,
  prepareDeps,
}: {
  grnId: string;
  grnCode: string;
  /** Opened from a line: show that line (with "Show all lines"); null shows every line. */
  focusLineId: string | null;
  skuMap: Readonly<Record<string, SkuResponse>> | null;
  onClose: () => void;
  /** Tests replace the browser's decoder/encoder. */
  prepareDeps?: PrepareDeps;
}) {
  const photos = useReceiptPhotos(grnId);
  const lines = useGoodsReceiptLines(grnId);
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  const canAttach = roleHasCapability(role, 'receipt.attach');
  const canRemove = roleHasCapability(role, 'receipt.photo-remove');

  // A28 — one refresher per dialog; it reads the newest `refresh` at call time.
  const [refresher] = useState(() => createUrlRefresher(photos.refresh));
  useEffect(() => refresher.bind(photos.refresh), [refresher, photos.refresh]);

  const [showAll, setShowAll] = useState(focusLineId === null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string } | null>(null);
  const [uploads, setUploads] = useState<readonly UploadItem[]>([]);
  const uploading = useRef(false);
  const [busyUploading, setBusyUploading] = useState(false);

  const data = photos.state === 'ready' ? photos.data : null;
  const storageOn = data?.storageEnabled ?? false;
  const allPhotos = data?.photos ?? [];
  const lineRows = lines.state === 'ready' ? lines.data : [];
  const shownLines = showAll || focusLineId === null ? lineRows : lineRows.filter((line) => line.id === focusLineId);
  const shownLineIds = new Set(shownLines.map((line) => line.id));
  // The lightbox walks the photos in the order the grids show them.
  const ordered = shownLines.flatMap((line) => orderForGrid(allPhotos.filter((photo) => photo.grnLineId === line.id)));
  const stageIndex = stageId === null ? -1 : ordered.findIndex((photo) => photo.id === stageId);
  const staged = stageIndex === -1 ? null : ordered[stageIndex]!;
  const receiptLive = allPhotos.filter(isLivePhoto).length;
  const focusLine = focusLineId === null ? null : (lineRows.find((line) => line.id === focusLineId) ?? null);

  async function addFiles(line: GoodsReceiptLineEntryDto, files: readonly File[]) {
    const session = readSession();
    if (session === null) {
      setOutcome({ tone: 'rejected', word: 'Not added', reason: 'Your session expired — sign in again.' });
      return;
    }
    if (uploading.current || files.length === 0) return;
    uploading.current = true;
    setBusyUploading(true);
    setOutcome(null);
    const lineLive = allPhotos.filter((photo) => photo.grnLineId === line.id && isLivePhoto(photo)).length;
    const { room, limitedBy } = photoRoom(lineLive, receiptLive);
    const taken = files.slice(0, room);
    const items: UploadItem[] = taken.map((file) => ({ id: ulid(), lineId: line.id, name: file.name, phase: 'preparing', problem: null, prepared: null, key: ulid() }));
    setUploads((current) => [...current, ...items]);
    let added = 0;
    try {
      for (let index = 0; index < taken.length; index++) {
        const item = items[index]!;
        const prepared = await prepareImageForUpload(taken[index]!, prepareDeps);
        if (!prepared.ok) {
          patch(item.id, { phase: 'refused', problem: prepared.problem });
          continue;
        }
        patch(item.id, { phase: 'uploading', prepared: prepared.file });
        if (await send(session.tenant.id, { ...item, prepared: prepared.file })) added += 1;
      }
    } finally {
      uploading.current = false;
      setBusyUploading(false);
    }
    const skipped = files.length - taken.length;
    if (added > 0) {
      setOutcome({
        tone: skipped > 0 ? 'warning' : 'accepted',
        word: `${photoCountLabel(added)} added`,
        reason:
          skipped > 0
            ? `To ${line.skuCode}. ${skippedPhotosSentence(skipped, limitedBy)}`
            : `To ${line.skuCode} on ${grnCode}.`,
      });
      notifyInboundChanged();
    } else if (skipped > 0) {
      setOutcome({ tone: 'rejected', word: 'Not added', reason: noRoomSentence(limitedBy) });
    }
  }

  function patch(id: string, change: Partial<UploadItem>) {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  /** POST one prepared photo under its key; true on success (the row then leaves the queue). */
  async function send(tenantId: string, item: UploadItem & { prepared: File }): Promise<boolean> {
    try {
      await fetchApiAddReceiptPhoto(tenantId, grnId, item.lineId, item.prepared, item.key);
      setUploads((current) => current.filter((entry) => entry.id !== item.id));
      return true;
    } catch (error) {
      // A cap or a type refusal will not change on a retry — offer Dismiss only.
      const final = error instanceof ApiProblem && error.status !== 503 && error.code !== 'conflict';
      patch(item.id, { phase: final ? 'refused' : 'failed', problem: addPhotoReason(error) });
      return false;
    }
  }

  async function retry(item: UploadItem) {
    const session = readSession();
    if (session === null || item.prepared === null || uploading.current) return;
    uploading.current = true;
    setBusyUploading(true);
    patch(item.id, { phase: 'uploading', problem: null });
    try {
      if (await send(session.tenant.id, { ...item, prepared: item.prepared })) {
        setOutcome({ tone: 'accepted', word: '1 photo added', reason: `On ${grnCode}.` });
        notifyInboundChanged();
      }
    } finally {
      uploading.current = false;
      setBusyUploading(false);
    }
  }

  const title = `Damage photos · ${grnCode}`;
  const subtitle =
    focusLine !== null && !showAll ? (
      <>
        <span className="font-mono">{focusLine.skuCode}</span> {focusLine.skuName}
      </>
    ) : (
      'Every line of this receipt'
    );

  return (
    <ModalFrame
      title={title}
      subtitle={subtitle}
      wide
      onClose={onClose}
      onEscape={() => (stageId !== null ? setStageId(null) : onClose())}
    >
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      {photos.state === 'failed' ? (
        <ReadFailure word="Photos unavailable" reason={photos.reason} onRetry={photos.reload} />
      ) : lines.state === 'failed' ? (
        <ReadFailure word="Receipt lines unavailable" reason={lines.reason} onRetry={lines.reload} />
      ) : photos.state === 'loading' || lines.state === 'loading' ? (
        <GridSkeleton />
      ) : (
        <>
          {!storageOn && <FeedbackBanner tone="warning" word={STORAGE_OFF_WORD} reason={STORAGE_OFF_REASON} />}
          {staged !== null ? (
            <PhotoStage
              key={staged.id}
              photo={staged}
              line={lineRows.find((line) => line.id === staged.grnLineId) ?? null}
              grnId={grnId}
              position={stageIndex + 1}
              total={ordered.length}
              refresher={refresher}
              canRemove={canRemove}
              onMove={(step) => setStageId(ordered[(stageIndex + step + ordered.length) % ordered.length]!.id)}
              onBack={() => setStageId(null)}
              onRemoved={(word, reason) => {
                setOutcome({ tone: 'accepted', word, reason });
                notifyInboundChanged();
              }}
              onGone={() => notifyInboundChanged()}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {shownLines.length === 0 && <div className="text-(--muted-foreground)">No lines settled on this receipt.</div>}
              {shownLines.map((line) => {
                const linePhotos = orderForGrid(allPhotos.filter((photo) => photo.grnLineId === line.id));
                const lineLive = linePhotos.filter(isLivePhoto).length;
                const blocker = addPhotoBlocker(lineLive, receiptLive);
                return (
                  <LineSection
                    key={line.id}
                    line={line}
                    sku={skuMap?.[line.skuId] ?? null}
                    photos={linePhotos}
                    refresher={refresher}
                    canAdd={canAttach && storageOn}
                    addBlocker={blocker}
                    busy={busyUploading}
                    uploads={uploads.filter((item) => item.lineId === line.id)}
                    onFiles={(files) => void addFiles(line, files)}
                    onOpen={(photo) => setStageId(photo.id)}
                    onRetry={(item) => void retry(item)}
                    onDismiss={(item) => setUploads((current) => current.filter((entry) => entry.id !== item.id))}
                  />
                );
              })}
              {/* Photos on lines this read does not list (a line refused to review) — never hidden silently. */}
              {showAll && allPhotos.some((photo) => !shownLineIds.has(photo.grnLineId)) && (
                <div className="text-xs text-(--muted-foreground)">
                  {photoCountLabel(allPhotos.filter((photo) => !shownLineIds.has(photo.grnLineId)).length)} on lines not listed here.
                </div>
              )}
            </div>
          )}
          {focusLineId !== null && staged === null && lineRows.length > 1 && (
            <div>
              <button type="button" className={rowButtonClass} onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show this line only' : `Show all ${lineRows.length} lines`}
              </button>
            </div>
          )}
        </>
      )}
    </ModalFrame>
  );
}

interface UploadItem {
  readonly id: string;
  readonly lineId: string;
  readonly name: string;
  /** refused: the file or the server's answer will not change on a retry (Dismiss only). */
  readonly phase: 'preparing' | 'uploading' | 'failed' | 'refused';
  readonly problem: string | null;
  /** The re-encoded file — kept so a Retry sends the SAME bytes under the SAME key. */
  readonly prepared: File | null;
  readonly key: string;
}

/** Live photos first (attached, then awaited, each oldest first), then removed and never-arrived ones. */
function orderForGrid(photos: readonly ReceiptPhotoViewDto[]): ReceiptPhotoViewDto[] {
  const rank = { attached: 0, awaited: 1, expired: 2, removed: 3 } as const;
  return [...photos].sort((a, b) => rank[a.status] - rank[b.status] || a.createdAt.localeCompare(b.createdAt));
}

function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading the photos" className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="aspect-square rounded-md bg-(--muted)" />
      ))}
    </div>
  );
}

function LineSection({
  line,
  sku,
  photos,
  refresher,
  canAdd,
  addBlocker,
  busy,
  uploads,
  onFiles,
  onOpen,
  onRetry,
  onDismiss,
}: {
  line: GoodsReceiptLineEntryDto;
  sku: SkuResponse | null;
  photos: readonly ReceiptPhotoViewDto[];
  refresher: ReturnType<typeof createUrlRefresher>;
  canAdd: boolean;
  addBlocker: string | null;
  busy: boolean;
  uploads: readonly UploadItem[];
  onFiles: (files: readonly File[]) => void;
  onOpen: (photo: ReceiptPhotoViewDto) => void;
  onRetry: (item: UploadItem) => void;
  onDismiss: (item: UploadItem) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const blockerId = useId();
  const attached = photos.filter((photo) => photo.status === 'attached').length;
  const pending = photos.filter((photo) => photo.status === 'awaited').length;
  const counts = [photoCountLabel(attached), ...(pending > 0 ? [`${pending} on its way`] : [])].join(' · ');
  return (
    <section aria-label={`Photos of ${line.skuCode}`} data-testid={`photo-line-${line.id}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-(--border) pb-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            <span className="font-mono">{line.skuCode}</span> {line.skuName}
            {line.batchCode !== null && (
              <span className="text-(--muted-foreground)">
                {' '}
                · batch <span className="font-mono">{line.batchCode}</span>
              </span>
            )}
            {grnLineRecallLabel(line) !== null && (
              <>
                {' '}
                <StatusChip tone="warning" glyph="⚑" data-testid="grn-line-recall">
                  {grnLineRecallLabel(line)}
                </StatusChip>
              </>
            )}
          </span>
          <span className="text-xs text-(--muted-foreground)">
            {grnLineConditionLabel(line, sku)} · <span className="data">{counts}</span>
          </span>
        </div>
        {canAdd && (
          <div className="flex flex-col items-end gap-1">
            <input
              ref={input}
              type="file"
              accept={PHOTO_ACCEPT}
              multiple
              hidden
              aria-label={`Choose photos for ${line.skuCode}`}
              data-testid={`photo-input-${line.id}`}
              onChange={(event) => {
                const files = event.target.files === null ? [] : [...event.target.files];
                event.target.value = '';
                onFiles(files);
              }}
            />
            <button
              type="button"
              className={`${primaryClass} flex items-center gap-1.5 py-1.5`}
              disabled={busy || addBlocker !== null}
              title={addBlocker ?? undefined}
              aria-describedby={addBlocker === null ? undefined : blockerId}
              onClick={() => input.current?.click()}
            >
              <CameraGlyph />
              {busy ? 'Uploading…' : 'Add photo'}
            </button>
            {addBlocker !== null && <span id={blockerId} className="max-w-64 text-right text-[11px] text-(--muted-foreground)">{addBlocker}</span>}
          </div>
        )}
      </div>
      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Uploads">
          {uploads.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid="photo-upload">
              <span className="font-mono">{item.name}</span>
              {item.phase === 'preparing' && <span role="status" className="text-(--muted-foreground)">Preparing…</span>}
              {item.phase === 'uploading' && <span role="status" className="text-(--muted-foreground)">Uploading…</span>}
              {(item.phase === 'failed' || item.phase === 'refused') && (
                <>
                  <span role="alert" className="text-(--destructive)">
                    Not added — {item.problem}
                  </span>
                  {item.phase === 'failed' && (
                    <button type="button" className={rowButtonClass} disabled={busy} onClick={() => onRetry(item)}>
                      Retry
                    </button>
                  )}
                  <button type="button" className={rowButtonClass} onClick={() => onDismiss(item)}>
                    Dismiss
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {photos.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--border) px-3 py-4 text-center text-xs text-(--muted-foreground)">
          No photos on this line{canAdd ? ' — add the first one.' : '.'}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <PhotoTile photo={photo} label={`${line.skuCode} photo ${index + 1}`} refresher={refresher} onOpen={() => onOpen(photo)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One tile — a button opening the stage; its content follows the status, in words. */
function PhotoTile({
  photo,
  label,
  refresher,
  onOpen,
}: {
  photo: ReceiptPhotoViewDto;
  label: string;
  refresher: ReturnType<typeof createUrlRefresher>;
  onOpen: () => void;
}) {
  const tone = photo.status === 'awaited' ? 'warning' : photo.status === 'attached' ? 'plain' : 'muted';
  return (
    <TileFrame tone={tone} testId={`photo-tile-${photo.status}`}>
      {photo.status === 'attached' && photo.url !== null ? (
        // The tile is a div wrapping the image so a Retry inside a broken image is not a nested button.
        <div className="relative h-full w-full">
          <PresignedImage photo={{ ...photo, url: photo.url }} alt={label} refresher={refresher} />
          <button type="button" aria-label={`Open ${label}`} onClick={onOpen} className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-(--ring)" />
        </div>
      ) : (
        <button type="button" aria-label={`Open ${label} (${PHOTO_STATUS_LABEL[photo.status]})`} onClick={onOpen} className="h-full w-full">
          <TilePlaceholder photo={photo} />
        </button>
      )}
    </TileFrame>
  );
}

function TilePlaceholder({ photo }: { photo: ReceiptPhotoViewDto }) {
  switch (photo.status) {
    case 'attached':
      // Attached with no URL: storage is off on this server.
      return <PlaceholderBody glyph="▢" word="Image unavailable" hint="Photo storage is off." />;
    case 'awaited':
      return <PlaceholderBody glyph="⧗" word={PHOTO_STATUS_LABEL.awaited} hint={PHOTO_STATUS_HINT.awaited} />;
    case 'expired':
      return <PlaceholderBody glyph="∅" word={PHOTO_STATUS_LABEL.expired} hint={PHOTO_STATUS_HINT.expired} />;
    case 'removed':
      return (
        <PlaceholderBody
          glyph="⊘"
          word={photo.contentType === null ? 'Cancelled' : PHOTO_STATUS_LABEL.removed}
          hint={photo.removedReason === undefined ? undefined : <span className="line-clamp-3">“{photo.removedReason}”</span>}
        />
      );
    default: {
      const unknown: never = photo.status;
      return <PlaceholderBody glyph="?" word={String(unknown)} />;
    }
  }
}

/** The lightbox stage for one photo, with its facts and (for a manager) Remove / Cancel. */
function PhotoStage({
  photo,
  line,
  grnId,
  position,
  total,
  refresher,
  canRemove,
  onMove,
  onBack,
  onRemoved,
  onGone,
}: {
  photo: ReceiptPhotoViewDto;
  line: GoodsReceiptLineEntryDto | null;
  grnId: string;
  position: number;
  total: number;
  refresher: ReturnType<typeof createUrlRefresher>;
  canRemove: boolean;
  onMove: (step: number) => void;
  onBack: () => void;
  onRemoved: (word: string, reason: string) => void;
  /** 409 `attachment-not-attached`: removed elsewhere — re-read. */
  onGone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // The key is the confirmation's: bound to this photo and the reason sent.
  const keyRef = useRef<{ key: string; reason: string } | null>(null);
  const verb = removeVerb(photo.status);
  const removable = canRemove && (photo.status === 'attached' || photo.status === 'awaited');
  const label = `${line?.skuCode ?? 'Line'} photo ${position}`;

  async function confirm() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current) return;
    const parsed = parseRemoveReason(reasonText);
    if (parsed.reason === null) {
      setProblem(parsed.problem);
      return;
    }
    if (keyRef.current === null || keyRef.current.reason !== parsed.reason) keyRef.current = { key: ulid(), reason: parsed.reason };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fetchApiRemoveReceiptPhoto(session.tenant.id, grnId, photo.id, parsed.reason, keyRef.current.key);
      keyRef.current = null;
      setConfirming(false);
      onRemoved(verb.done, `“${parsed.reason}” — the record stays on the receipt.`);
    } catch (error) {
      setProblem(removePhotoReason(error));
      if (error instanceof ApiProblem && error.code === 'attachment-not-attached') onGone();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const facts: string[] = [];
  if (line !== null) facts.push(`Line ${photo.lineNo} · ${line.skuCode}`);
  else facts.push(`Line ${photo.lineNo}`);
  facts.push(PHOTO_STATUS_LABEL[photo.status]);
  if (photo.status !== 'awaited' && photo.status !== 'expired') facts.push(photoProvenance(photo));
  const size = photoDimensions(photo);
  if (size !== '') facts.push(size);

  return (
    <LightboxStage
      photo={photo}
      alt={label}
      position={position}
      total={total}
      onPrevious={() => onMove(-1)}
      onNext={() => onMove(1)}
      onBack={onBack}
      refresher={refresher}
      placeholder={
        <div className="max-w-sm">
          <TilePlaceholder photo={photo} />
        </div>
      }
      meta={
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(--muted-foreground)">
            {facts.map((fact, index) => (
              <span key={index}>
                {index > 0 && <span aria-hidden>· </span>}
                {fact}
              </span>
            ))}
            {photo.url !== null && (
              <a href={photo.url} target="_blank" rel="noreferrer" className="text-(--primary) underline underline-offset-2">
                Open full size
              </a>
            )}
          </div>
          {photo.status === 'removed' && (
            <div data-testid="photo-removed-detail" className="flex flex-col gap-0.5">
              <span>{photoRemovedLine(photo)}</span>
              {photo.removedReason !== undefined && <span className="text-(--muted-foreground)">Reason: “{photo.removedReason}”</span>}
            </div>
          )}
        </div>
      }
      actions={
        removable ? (
          confirming ? (
            <div className="flex flex-col gap-2 rounded-md border border-(--destructive) p-3" aria-label={verb.button}>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">{verb.prompt}</span>
                <textarea
                  aria-label="Reason"
                  rows={2}
                  // UTF-16 units: twice the cap, so an emoji-heavy reason is judged by the parser (code points), not cut short.
                  maxLength={MAX_REMOVE_REASON_LENGTH * 2}
                  autoFocus
                  value={reasonText}
                  disabled={busy}
                  onChange={(event) => {
                    setReasonText(event.target.value);
                    setProblem(null);
                  }}
                  className="rounded-sm border border-(--input) bg-(--background) px-2 py-1 text-sm"
                />
                <span className="data self-end text-[11px] text-(--muted-foreground)">
                  {reasonLength(reasonText)}/{MAX_REMOVE_REASON_LENGTH}
                </span>
              </label>
              {problem !== null && (
                <div role="alert" className="text-xs text-(--destructive)">
                  {problem}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className="rounded-md bg-(--destructive) px-3 py-1.5 text-sm font-medium text-(--destructive-foreground) hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? verb.busy : verb.button}
                </button>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" className={`${buttonClass} text-(--destructive)`} onClick={() => setConfirming(true)}>
                {verb.button}…
              </button>
            </div>
          )
        ) : undefined
      }
    />
  );
}
