import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';

import { THEME_STORAGE_KEY } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'WMS',
    template: '%s · WMS',
  },
  description: 'Multi-tenant warehouse management',
};

// Applies the theme before first paint so there is no flash: an explicit
// choice (localStorage) wins; otherwise the OS preference is respected. The
// key is interpolated from src/lib/theme.ts so the write side (ThemeToggle)
// and this read side cannot drift apart.
const themeInit = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

/**
 * Root layout: document chrome only. The app shell (sidebar + header) lives
 * in the `(app)` route group so the auth surfaces (`/login`, `/register`)
 * render without it — signup must not render the app sidebar.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={GeistSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}