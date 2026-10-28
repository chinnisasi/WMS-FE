'use client';

import { useRef, useState } from 'react';

import { downloadBlob } from '@/lib/csv';
import {
  recallReportFilename,
  recallReportReason,
  reportDownloadedLabel,
  type RecallReportFormat,
} from '@/lib/recalls';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass } from '@/components/shared/surface';

/**
 * Story 3-7a — "Download CSV" / "Download XLSX" for a recall report, staff
 * and portal alike (the fetcher is the caller's: `fetchApiRecallReport` or
 * `fetchApiPortalRecallReport`). The file is fetched with the bearer header
 * and handed to the browser under a name this client builds (CORS hides
 * `Content-Disposition`). One download at a time (a synchronous ref guards a
 * double click); a refusal renders by code — the XLSX cap points at the CSV,
 * a busy server says try again. Portal-allowed: no operator hook.
 */
export function RecallReportButtons({
  code,
  mode,
  fetchReport,
  onDownloaded,
}: {
  readonly code: string;
  readonly mode: string;
  readonly fetchReport: (format: RecallReportFormat) => Promise<Blob>;
  /** After a file landed (the detail re-reads its first-report time). */
  readonly onDownloaded?: () => void;
}) {
  const [busy, setBusy] = useState<RecallReportFormat | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'accepted' | 'rejected'; reason: string} | null>(null);
  const inFlight = useRef(false);

  async function download(format: RecallReportFormat) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(format);
    setOutcome(null);
    try {
      const blob = await fetchReport(format);
      const filename = recallReportFilename({ code, mode, format, now: Date.now() });
      downloadBlob(filename, blob);
      setOutcome({ tone: 'accepted', reason: reportDownloadedLabel(format, filename) });
      onDownloaded?.();
    } catch (error) {
      setOutcome({ tone: 'rejected', reason: recallReportReason(error, format) });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="recall-report">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('csv')} aria-busy={busy === 'csv' ? 'true' : undefined}>
          {busy === 'csv' ? 'Preparing CSV…' : 'Download CSV'}
        </button>
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('xlsx')} aria-busy={busy === 'xlsx' ? 'true' : undefined}>
          {busy === 'xlsx' ? 'Preparing XLSX…' : 'Download XLSX'}
        </button>
      </div>
      {outcome !== null && (
        <FeedbackBanner
          tone={outcome.tone}
          word={outcome.tone === 'accepted' ? 'Report downloaded' : 'Report not downloaded'}
          reason={outcome.reason}
        />
      )}
    </div>
  );
}
