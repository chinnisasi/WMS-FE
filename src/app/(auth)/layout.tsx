/**
 * Auth surfaces layout — no app shell, no sidebar. Centered card on the
 * token layer.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}