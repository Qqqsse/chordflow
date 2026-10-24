'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { GUEST_NAMESPACE } from '@/lib/offline/offline-record';
import { clearOfflineCharts } from '@/lib/offline/offline-store';

export interface AccountUser {
  id: string;
  name: string;
  role: 'member' | 'admin';
}

export interface AccountState {
  status: 'loading' | 'ready';
  /** False in demo mode (no account endpoints). */
  accountsEnabled: boolean;
  user: AccountUser | null;
  /** IndexedDB namespace for offline charts: per account, or the guest namespace. */
  offlineNamespace: string;
  signOut: () => Promise<void>;
  /** Re-reads the session (after sign-in or sign-up). */
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountState | null>(null);

type SessionState = Omit<AccountState, 'signOut' | 'refresh' | 'offlineNamespace'>;

async function loadSession(): Promise<SessionState> {
  try {
    const response = await fetch('/api/auth/get-session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 404) return { status: 'ready', accountsEnabled: false, user: null };
    const body = (await response.json().catch(() => null)) as {
      user?: { id: string; name: string; role?: string };
    } | null;
    const user = body?.user
      ? {
          id: body.user.id,
          name: body.user.name,
          role: body.user.role === 'admin' ? ('admin' as const) : ('member' as const),
        }
      : null;
    return { status: 'ready', accountsEnabled: true, user };
  } catch {
    return { status: 'ready', accountsEnabled: false, user: null };
  }
}

export function namespaceFor(user: AccountUser | null): string {
  return user === null ? GUEST_NAMESPACE : `user:${user.id}`;
}

/**
 * Loads the session in the browser so server-rendered (and service-worker
 * cached) HTML never contains personal data.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<
    Omit<AccountState, 'signOut' | 'refresh' | 'offlineNamespace'>
  >({
    status: 'loading',
    accountsEnabled: false,
    user: null,
  });

  const refresh = useCallback(async () => {
    setState(await loadSession());
  }, []);

  useEffect(() => {
    let active = true;
    void loadSession().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    // Private offline copies are removed before the session ends (shared browsers).
    if (state.user !== null)
      await clearOfflineCharts(namespaceFor(state.user)).catch(() => undefined);
    // better-auth only accepts JSON request bodies (415 otherwise).
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    await refresh();
    router.push('/');
    router.refresh();
  }, [state.user, refresh, router]);

  return (
    <AccountContext.Provider
      value={{ ...state, offlineNamespace: namespaceFor(state.user), signOut, refresh }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountState {
  const value = useContext(AccountContext);
  if (value === null) throw new Error('useAccount must be used inside AccountProvider');
  return value;
}
