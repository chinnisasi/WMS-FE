'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  fetchApiAddClientContact,
  fetchApiEditClientContact,
  fetchApiRemoveClientContact,
} from '@/lib/api/client';
import type { ClientContactDto, ClientContactListItemDto, ClientDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  CONTACT_ROLES,
  MAX_CLIENT_CONTACTS,
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  contactDraftDirty,
  contactFieldsOf,
  contactReason,
  contactRoleLabel,
  contactRolesLabel,
  emptyContactFields,
  parseContactDraft,
  type ContactFields,
  type ContactRole,
} from '@/lib/clients';
import {
  CLIENT_EMAIL_EVENTS,
  CLIENT_EMAIL_EVENT_HINT,
  CLIENT_EMAIL_EVENT_LABEL,
  CLIENT_EMAILS_FIELDSET_HINT,
  SELF_CLIENT_EMAILS_NOTE,
  contactEmailBadge,
  contactEmailEventsBody,
  contactEmailsLabel,
  type ClientEmailEvent,
} from '@/lib/client-emails';
import { ulid } from '@/lib/ulid';
import { useClientContacts } from '@/lib/use-client-contacts';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/shared/surface';
import { StatusChip } from '@/components/shared/status-chip';
import { ConfirmRow } from '@/components/settings/confirm-row';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; contact: ClientContactListItemDto }
  | { kind: 'remove'; contact: ClientContactDto }
  | { kind: 'primary'; contact: ClientContactDto };

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 1-2a — a client's contacts: ONE panel kind with its own internal
 * state (the list, add, edit, a remove confirmation, make primary). Every
 * staff session reads the list (decision 6); an owner (`canManage`) edits.
 * Roles are checkboxes in a `fieldset`/`legend`. Focus moves to the panel's
 * heading when it opens, and the region is labelled by it (it names the
 * client code). The add/edit draft reports whether it is dirty, so the card
 * asks before another panel replaces it. Story 5-2b — each row says which
 * client emails the contact receives and warns when its last one was not
 * sent; the form's "Emails" fieldset opts in (disabled on `self`).
 */
export function ClientContactsPanel({
  client,
  canManage,
  onClose,
  onDirtyChange,
}: {
  client: ClientDto;
  canManage: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const contacts = useClientContacts(client.id);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const rows = contacts.state === 'ready' ? contacts.data : [];
  const full = rows.length >= MAX_CLIENT_CONTACTS;
  const show = (next: Mode) => {
    onDirtyChange(false);
    setMode(next);
  };
  const done = (next: Outcome) => {
    show({ kind: 'list' });
    setOutcome(next);
    contacts.refresh();
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Contacts — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>
      <div className="text-(--muted-foreground)">
        Who to reach at {client.code} for operations, billing and returns. The primary contact is listed first and is the default
        recipient of client notifications.
      </div>

      {contacts.state === 'failed' ? (
        <ReadFailure word="Contacts unavailable" reason={contacts.reason} onRetry={contacts.reload} />
      ) : contacts.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading contacts…</div>
      ) : rows.length === 0 ? (
        <div className="text-(--muted-foreground)">No contacts yet.</div>
      ) : (
        <ul aria-label={`Contacts of ${client.code}`} className="flex flex-col gap-1">
          {rows.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border) py-1 last:border-b-0">
              <ContactRow contact={contact} />
              {canManage ? (
                <div className="flex flex-wrap gap-1">
                  <button type="button" className={rowButtonClass} aria-label={`Edit ${contact.name}`} onClick={() => show({ kind: 'edit', contact })}>
                    Edit
                  </button>
                  {contact.isPrimary ? null : (
                    <button
                      type="button"
                      className={rowButtonClass}
                      aria-label={`Make ${contact.name} primary`}
                      onClick={() => show({ kind: 'primary', contact })}
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    className={rowButtonClass}
                    aria-label={`Remove ${contact.name}`}
                    onClick={() => show({ kind: 'remove', contact })}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && mode.kind === 'list' && contacts.state === 'ready' ? (
        full ? (
          <div className="text-xs text-(--muted-foreground)">
            {client.code} has {MAX_CLIENT_CONTACTS} contacts, the most a client holds — remove one to add another.
          </div>
        ) : (
          <div>
            <button type="button" className={rowButtonClass} onClick={() => show({ kind: 'add' })}>
              Add contact
            </button>
          </div>
        )
      ) : null}

      {canManage && mode.kind === 'add' ? (
        <ContactForm
          key="add"
          clientCode={client.code}
          systemOwned={client.systemOwned}
          initial={emptyContactFields()}
          submitLabel="Add contact"
          onDirtyChange={onDirtyChange}
          onCancel={() => show({ kind: 'list' })}
          save={(body, key, tenantId) => fetchApiAddClientContact(tenantId, client.id, body, key)}
          onSaved={(contact) =>
            done({
              tone: 'accepted',
              word: `${contact.name} added`,
              reason: contact.isPrimary ? 'The first contact is the primary one.' : `Added to ${client.code}'s contacts.`,
            })
          }
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Contact not added', reason })}
        />
      ) : null}

      {canManage && mode.kind === 'edit' ? (
        <ContactForm
          key={`edit-${mode.contact.id}`}
          clientCode={client.code}
          systemOwned={client.systemOwned}
          initial={contactFieldsOf(mode.contact)}
          submitLabel="Save contact"
          onDirtyChange={onDirtyChange}
          onCancel={() => show({ kind: 'list' })}
          save={(body, key, tenantId) => fetchApiEditClientContact(tenantId, client.id, mode.contact.id, body, key)}
          onSaved={(contact) => done({ tone: 'accepted', word: `${contact.name} saved`, reason: 'The contact is up to date.' })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Contact not saved', reason })}
        />
      ) : null}

      {canManage && mode.kind === 'primary' ? (
        <ConfirmRow<ClientContactDto>
          key={`primary-${mode.contact.id}`}
          question={`Make ${mode.contact.name} the primary contact of ${client.code}?`}
          confirmLabel="Make primary"
          ariaLabel="Confirm make primary"
          run={(key, tenantId) => fetchApiEditClientContact(tenantId, client.id, mode.contact.id, { isPrimary: true }, key)}
          reason={contactReason}
          onClose={() => show({ kind: 'list' })}
          onDone={(contact) => done({ tone: 'accepted', word: `${contact.name} is primary`, reason: 'They are listed first now.' })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Primary not changed', reason })}
        />
      ) : null}

      {canManage && mode.kind === 'remove' ? (
        <ConfirmRow<ClientContactDto>
          key={`remove-${mode.contact.id}`}
          question={`Remove ${mode.contact.name} (${mode.contact.email}) from ${client.code}'s contacts?`}
          confirmLabel="Remove contact"
          ariaLabel="Confirm remove contact"
          run={(key, tenantId) => fetchApiRemoveClientContact(tenantId, client.id, mode.contact.id, key)}
          reason={contactReason}
          onClose={() => show({ kind: 'list' })}
          onDone={(contact) => done({ tone: 'accepted', word: `${contact.name} removed`, reason: `No longer a contact of ${client.code}.` })}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Contact not removed', reason })}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

/** A contact's lines: name (Primary), email · phone · roles, its client emails and the last email's problem. */
function ContactRow({ contact }: { contact: ClientContactListItemDto }) {
  const emails = contactEmailsLabel(contact.emailEvents ?? []);
  const badge = contactEmailBadge(contact.lastEmail ?? null);
  return (
    <div className="flex min-w-48 flex-col">
      <span className="font-medium">
        {contact.name}
        {contact.isPrimary ? <span className="ml-2 rounded-sm border border-(--border) px-1 text-xs">Primary</span> : null}
      </span>
      <span className="text-xs text-(--muted-foreground)">
        {contact.email}
        {contact.phone === null ? '' : ` · ${contact.phone}`} · {contactRolesLabel(contact.roles)}
      </span>
      {emails !== null || badge !== null ? (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {emails !== null ? <span className="text-(--muted-foreground)">{emails}</span> : null}
          {badge !== null ? (
            <StatusChip tone="warning" glyph="!">
              {badge}
            </StatusChip>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The add / edit form. Per-draft Idempotency-Key (`keyRef.current ??=
 * ulid()`): reused across retries of the unchanged draft, cleared on any
 * edit and on success. An edit sends the whole contact (an unchanged one is
 * a server-side no-op) — except `emailEvents`, sent only when the ticked set
 * differs from the one the form was seeded with, so a stale form never
 * overwrites (and cancels the queued mail of) another owner's opt-in.
 */
function ContactForm({
  clientCode,
  systemOwned,
  initial,
  submitLabel,
  onDirtyChange,
  onCancel,
  save,
  onSaved,
  onRejected,
}: {
  clientCode: string;
  /** Story 5-2b — the warehouse's own client: the Emails fieldset is disabled and `emailEvents` never sent. */
  systemOwned: boolean;
  initial: ContactFields;
  submitLabel: string;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  save: (
    body: { name: string; email: string; phone: string | null; roles: ContactRole[]; emailEvents?: ClientEmailEvent[] },
    idempotencyKey: string,
    tenantId: string,
  ) => Promise<ClientContactDto>;
  onSaved: (contact: ClientContactDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [fields, setFields] = useState<ContactFields>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const legendId = useId();
  const emailsLegendId = useId();
  const emailsNoteId = useId();

  const edit = (next: ContactFields) => {
    keyRef.current = null;
    setFields(next);
    onDirtyChange(contactDraftDirty(next, initial));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseContactDraft(fields);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const contact = await save(
        {
          ...parsed.body,
          roles: [...(parsed.body.roles ?? [])],
          ...(sameEmailEvents(fields.emailEvents, initial.emailEvents) ? {} : contactEmailEventsBody(fields.emailEvents, systemOwned)),
        },
        keyRef.current,
        session.tenant.id,
      );
      keyRef.current = null;
      onSaved(contact);
    } catch (error) {
      onRejected(contactReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`${submitLabel} for ${clientCode}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            className={inputClass}
            value={fields.name}
            required
            maxLength={MAX_CONTACT_NAME_LENGTH * 2}
            onChange={(event) => edit({ ...fields, name: event.target.value })}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>Email</span>
          <input
            className={inputClass}
            type="email"
            value={fields.email}
            required
            maxLength={MAX_CONTACT_EMAIL_LENGTH}
            spellCheck={false}
            onChange={(event) => edit({ ...fields, email: event.target.value })}
          />
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1">
          <span className={labelClass}>Phone (optional)</span>
          <input
            className={inputClass}
            type="tel"
            value={fields.phone}
            maxLength={MAX_CONTACT_PHONE_LENGTH}
            onChange={(event) => edit({ ...fields, phone: event.target.value })}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3" aria-labelledby={legendId}>
        <legend id={legendId} className={labelClass}>
          Roles (none = a general contact)
        </legend>
        {CONTACT_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={fields.roles.includes(role)}
              onChange={(event) =>
                edit({
                  ...fields,
                  roles: event.target.checked ? [...fields.roles, role] : fields.roles.filter((r) => r !== role),
                })
              }
            />
            {contactRoleLabel(role)}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1" aria-labelledby={emailsLegendId} aria-describedby={emailsNoteId} disabled={systemOwned}>
        <legend id={emailsLegendId} className={labelClass}>
          Emails
        </legend>
        <span id={emailsNoteId} className="text-xs text-(--muted-foreground)">
          {systemOwned ? SELF_CLIENT_EMAILS_NOTE : CLIENT_EMAILS_FIELDSET_HINT}
        </span>
        {CLIENT_EMAIL_EVENTS.map((event) => (
          <label key={event} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!systemOwned && fields.emailEvents.includes(event)}
              onChange={(change) =>
                edit({
                  ...fields,
                  emailEvents: change.target.checked ? [...fields.emailEvents, event] : fields.emailEvents.filter((e) => e !== event),
                })
              }
            />
            <span className="flex flex-col">
              <span>{CLIENT_EMAIL_EVENT_LABEL[event]}</span>
              <span className="text-xs text-(--muted-foreground)">{CLIENT_EMAIL_EVENT_HINT[event]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={rowButtonClass}>
          Cancel
        </button>
      </div>
      {problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

/** Story 5-2b — the same opt-ins, whatever the tick order. */
function sameEmailEvents(a: readonly ClientEmailEvent[], b: readonly ClientEmailEvent[]): boolean {
  return a.length === b.length && a.every((event) => b.includes(event));
}
