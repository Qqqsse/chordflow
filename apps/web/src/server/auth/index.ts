import 'server-only';
import { getDatabase } from '../catalog';
import { createAuth, readAuthConfig, type Auth } from './auth';

let auth: Auth | undefined;

/** Authentication is only available in database mode; demo mode is anonymous-only. */
export function getAuth(): Auth | null {
  const handle = getDatabase();
  if (handle === null) return null;
  auth ??= createAuth(handle.db, readAuthConfig(process.env));
  return auth;
}
