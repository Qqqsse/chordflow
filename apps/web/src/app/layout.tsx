import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountProvider } from '@/components/account/account-context';
import { AccountMenu } from '@/components/account/account-menu';
import { ServiceWorkerRegistrar } from '@/components/offline/service-worker-registrar';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'chordflow', template: '%s · chordflow' },
  description: '邊彈邊唱的吉他和弦譜',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface-muted focus:px-3 focus:py-2"
        >
          跳到主要內容
        </a>
        <AccountProvider>
          <header className="border-b border-border">
            <nav
              aria-label="主選單"
              className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm"
            >
              <Link href="/" className="text-base font-bold tracking-tight">
                chordflow
              </Link>
              <Link href="/demo" className="text-ink-muted hover:text-ink">
                示範譜
              </Link>
              <a href="/offline" className="text-ink-muted hover:text-ink">
                離線譜庫
              </a>
              <AccountMenu />
            </nav>
          </header>
          <main id="main" className="mx-auto max-w-4xl px-4 py-8">
            {children}
          </main>
          <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-ink-muted">
            <a href="/terms" className="hover:text-ink">
              使用條款
            </a>
          </footer>
        </AccountProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
