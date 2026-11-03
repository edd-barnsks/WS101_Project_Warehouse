/* ───────────────────────────────────────────────────────────────
   API client for the PHP backend + the signed-in session.

   Where the API lives:
     • development: Vite forwards /api/* to the PHP server (see vite.config.js / .env.example)
     • production:  set VITE_API_BASE when you build, e.g. /PHP_Backend_For_WS101/index.php
   The login token is kept in sessionStorage: it is gone when the tab closes, and never written to
   localStorage. Passwords are never stored anywhere in the browser.
   ─────────────────────────────────────────────────────────────── */

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '/api').replace(/\/+$/, '');
const SESSION_KEY = 'wh-session';

export type Role = 'admin' | 'employee';
export type Session = { token: string; expiresAt: number; staffId: number; username: string; name: string; role: Role };

/** Backend role names <-> the names this app uses (Staff = "Cashier"). */
export const toRole = (backendRole: string): Role => (backendRole === 'Admin' ? 'admin' : 'employee');
export const toBackendRole = (role: Role): 'Admin' | 'Staff' => (role === 'admin' ? 'Admin' : 'Staff');
export const roleLabel = (role: Role | string): string => (role === 'admin' ? 'Admin' : 'Cashier');

/* ---------- session ---------- */
export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session> | null;
    if (!s || typeof s.token !== 'string' || !/^[a-f0-9]{64}$/.test(s.token) || typeof s.expiresAt !== 'number'
      || typeof s.username !== 'string' || (s.role !== 'admin' && s.role !== 'employee')) return null;
    if (s.expiresAt <= Date.now()) { clearSession(); return null; }
    return s as Session;
  } catch { return null; }
}
export function setSession(s: Session) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private mode: login will not persist */ } }
export function updateSession(patch: Partial<Session>) { const s = getSession(); if (s) setSession({ ...s, ...patch }); }
export function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/** The first version of this app kept plain-text passwords in localStorage. Remove them if they are still there. */
export function removeLegacyCredentials() {
  try { for (const key of ['wh-users', 'wh-credentials', 'wh-session']) localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Where the app is hosted ('/' in development, './' in a build) so redirects also work from a sub-folder such as /warehouse/. */
export const BASE = import.meta.env.BASE_URL;
export const pageUrl = (page: '' | 'app.html', query = '') => `${BASE}${page}${query}`;

export function goToLogin(expired = false) {
  clearSession();
  window.location.replace(pageUrl('', expired ? '?expired=1' : ''));
}

/* ---------- requests ---------- */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}, public retryAfter = 0) { super(message); }
}

type Query = Record<string, string | number | boolean | undefined | null>;
export function qs(params: Query = {}): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Calls the API. Throws ApiError with the server's message (or a friendly one when the server can't be reached).
 * A 401 on anything except /auth/login means the login expired: the user is sent back to the login page.
 */
export async function api<T = unknown>(method: string, path: string, body?: unknown, options: { token?: string | null; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = options.token !== undefined ? options.token : getSession()?.token;
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that Apache and MySQL are running, then try again.');
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { /* not JSON */ } }

  if (!res.ok) {
    const err = (data && typeof data === 'object' ? data : {}) as { error?: string; details?: Record<string, unknown> };
    if (res.status === 401 && options.auth !== false && path !== '/auth/login') {
      goToLogin(true);
    }
    const fallback = res.status >= 500 ? 'The server had a problem. Please try again.'
      : res.status === 404 && !text.trim().startsWith('{') ? 'The API was not found. Check the API address in your setup (see README).'
      : `Request failed (${res.status}).`;
    throw new ApiError(res.status, err.error || fallback, err.details ?? {}, Number(res.headers.get('Retry-After')) || 0);
  }
  if (data === null) throw new ApiError(res.status, 'The server sent an unexpected reply. Check the API address in your setup (see README).');
  return data as T;
}

/** Field names the server uses in its messages -> how a person would say them. */
const FIELD_LABELS: Record<string, string> = {
  CustomerName: 'customer name', ProductName: 'product name', CategoryName: 'category name', SupplierName: 'supplier name',
  ContactPerson: 'contact person', FirstName: 'first name', LastName: 'last name', StaffName: 'name',
  CurrentPassword: 'current password', NewPassword: 'new password', NewUsername: 'new username',
  PaymentMethod: 'payment method', AmountPaid: 'amount received', DiscountRate: 'discount', StockQuantity: 'stock quantity',
  RackSlot: 'rack slot', ProductID: 'product', CategoryID: 'category', OrderItemID: 'order line',
  ReorderLevel: 'low-stock level',
};
const FIELD_RE = new RegExp(`\\b(${Object.keys(FIELD_LABELS).join('|')})\\b`, 'g');

/** Turns a server message like "CurrentPassword is incorrect." into "Current password is incorrect." */
export function humanize(message: string): string {
  const text = message.replace(FIELD_RE, (name) => FIELD_LABELS[name]);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ListResult<T> = { data: T[]; total: number; page: number; limit: number };

/** Loads every page of a list endpoint (200 per request). */
export async function fetchAll<T>(path: string, params: Query = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await api<ListResult<T>>('GET', path + qs({ ...params, limit: 200, page }));
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
  }
  return out;
}

/* ---------- formatting helpers ---------- */
/** HTML-escape text before putting it in innerHTML. Everything that comes from the API goes through this. */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]!));

/** "12.34" or 12.34 -> 1234 (whole cents; no floating-point drift in totals) */
export const toCents = (v: string | number): number => Math.round(Number(v) * 100 + (Number(v) < 0 ? -1e-9 : 1e-9));
export const fromCents = (c: number): number => c / 100;
export const peso = (amount: number): string => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** cents x percent, rounded half-up to a cent: the same rule the server uses, so totals match exactly. */
export const percentOfCents = (cents: number, percent: number): number => Math.floor((cents * Math.round(percent * 100) + 5000) / 10000);

/** The server sends "2026-10-29 14:05:09" (the warehouse's own clock). Show it as written, with no time-zone shifting. */
export function serverDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) : null;
}
export function formatServerDate(value: string | null | undefined, style: 'short' | 'medium' = 'short'): string {
  const d = serverDate(value);
  return d ? d.toLocaleString([], { dateStyle: style, timeStyle: 'short' }) : String(value ?? '');
}

/* ---------- CSV export ---------- */
export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV cell. Text that starts with = + - @ (or a tab / carriage return) would be run as a formula when the file is
 * opened in Excel, so it gets a leading apostrophe. Names and notes come from other people, so this always runs.
 * Real numbers are written as they are.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds the CSV text (a byte-order mark first so Excel reads accents and the peso sign correctly). */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Hands the CSV to the browser as a download. */
export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** yyyy-mm-dd in the browser's own calendar, for file names and date inputs. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
