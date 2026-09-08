import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';

import { AppShell } from '@/components/shell/app-shell';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'WMS',
    template: '%s · WMS',
  },
  description: 'Multi-tenant warehouse management',
};

// Applies the theme before first paint so there is no flash: an explicit
// choice (localStorage) wins; otherwise the OS preference is respected.
const themeInit = `
(function () {
  try {
    var stored = localStorage.getItem('wms-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={GeistSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}