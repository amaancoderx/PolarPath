/**
 * Session handling.
 *
 * The token lives in localStorage, is attached to every API call, and is
 * dropped the moment the server says it is no longer good. A 401 anywhere in
 * the application unwinds to the sign-in screen rather than leaving a half-lit
 * dashboard with no data in it.
 */

const KEY = "polarpath.session";

export interface Account {
  email: string;
  name: string;
  role: string;
  role_label: string;
  organisation: string;
  views: string[];
}

export interface DemoAccount {
  email: string;
  password: string;
  role: string;
  role_label: string;
  name: string;
}

export interface RoleSpec {
  id: string;
  label: string;
  description: string;
  views: string[];
}

interface Stored {
  token: string;
  user: Account;
}

let current: Stored | null = null;
const listeners = new Set<() => void>();

try {
  const raw = window.localStorage.getItem(KEY);
  if (raw) current = JSON.parse(raw) as Stored;
} catch {
  current = null;
}

function announce() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function account(): Account | null {
  return current?.user ?? null;
}

export function token(): string | null {
  return current?.token ?? null;
}

export function signedIn(): boolean {
  return current !== null;
}

export function can(view: string): boolean {
  return current?.user.views.includes(view) ?? false;
}

function persist(next: Stored | null) {
  current = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* a session that only lives in memory is still a session */
  }
  announce();
}

export async function signIn(email: string, password: string): Promise<Account> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let message = "Those credentials were not recognised";
    try {
      const body = await res.json();
      if (body?.detail) message = String(body.detail);
    } catch {
      /* keep the default */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as Stored;
  persist(body);
  return body.user;
}

export function signOut(): void {
  persist(null);
}

/** Called by the API client when the server rejects the token. */
export function invalidate(): void {
  if (current) persist(null);
}

export async function demoAccounts(): Promise<{ accounts: DemoAccount[]; roles: RoleSpec[] }> {
  const res = await fetch("/api/auth/demo-accounts");
  if (!res.ok) throw new Error("could not load the seeded accounts");
  return res.json();
}
