/**
 * Story 6-1c — the public link pages (`/accept-invite`, `/reset-password`)
 * sit outside the `(auth)` group (they are never redirected by the gate), so
 * they carry the same centred card frame themselves.
 */
export default function AcceptInviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
