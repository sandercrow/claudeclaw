/**
 * Claude account switching for the agent subprocess.
 *
 * The SDK subprocess authenticates with CLAUDE_CODE_OAUTH_TOKEN, which agent.ts
 * re-reads from .env on every query. So changing the active token in .env is
 * enough: no restart, sessions and memory are local and unaffected.
 *
 * .env keys:
 *   CLAUDE_TOKEN_LC=<setup-token of todor@lanzaderaconsciente.com>
 *   CLAUDE_TOKEN_IW=<setup-token of todor@ingenieria-web.es>
 *   CLAUDE_CODE_OAUTH_TOKEN=<the active one>
 *   CLAUDE_ACCOUNT_AUTO_FAILOVER=true|false  (default true)
 *   CLAUDE_ACCOUNT_PREFERRED=lc|iw  (home account: after a failover, return to it once its limit resets)
 */
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export type AccountKey = 'lc' | 'iw';
export const ACCOUNTS: Record<AccountKey, { label: string; envKey: string }> = {
  lc: { label: 'LC (todor@lanzaderaconsciente.com)', envKey: 'CLAUDE_TOKEN_LC' },
  iw: { label: 'IW (todor@ingenieria-web.es)', envKey: 'CLAUDE_TOKEN_IW' },
};
const ENV_PATH = path.resolve(process.cwd(), '.env');

/** Account → epoch ms until which it is considered exhausted (session limit). Persisted across restarts. */
const STATE_PATH = path.resolve(process.cwd(), 'store', 'claude-account-state.json');
const exhaustedUntil = new Map<AccountKey, number>();
try {
  const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as Record<string, number>;
  for (const [k, v] of Object.entries(saved)) if ((k === 'lc' || k === 'iw') && v > Date.now()) exhaustedUntil.set(k, v);
} catch { /* no state yet */ }
function saveState(): void {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(Object.fromEntries(exhaustedUntil))); } catch { /* best effort */ }
}
let autoFailoverOverride: boolean | null = null;

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(ENV_PATH)) return map;
  for (const raw of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return map;
}

function writeEnvKey(key: string, value: string): void {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8').split('\n') : [];
  let done = false;
  const out = lines.map((l) => {
    if (l.replace(/^\s*/, '').startsWith(key + '=')) { done = true; return key + '=' + value; }
    return l;
  });
  if (!done) out.push(key + '=' + value);
  fs.writeFileSync(ENV_PATH, out.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

export function configuredAccounts(): AccountKey[] {
  const env = readEnv();
  return (Object.keys(ACCOUNTS) as AccountKey[]).filter((k) => (env.get(ACCOUNTS[k].envKey) ?? '').length > 20);
}

export function getActiveAccount(): AccountKey | 'custom' | 'none' {
  const env = readEnv();
  const active = env.get('CLAUDE_CODE_OAUTH_TOKEN') ?? '';
  if (!active) return 'none';
  for (const k of Object.keys(ACCOUNTS) as AccountKey[]) {
    if (env.get(ACCOUNTS[k].envKey) === active) return k;
  }
  return 'custom';
}

export function setActiveAccount(key: AccountKey): string {
  const env = readEnv();
  const token = env.get(ACCOUNTS[key].envKey) ?? '';
  if (token.length < 20) throw new Error('No token configured for ' + ACCOUNTS[key].envKey);
  writeEnvKey('CLAUDE_CODE_OAUTH_TOKEN', token);
  logger.warn({ account: key }, 'Active Claude account switched');
  return ACCOUNTS[key].label;
}

export function autoFailoverEnabled(): boolean {
  if (autoFailoverOverride !== null) return autoFailoverOverride;
  const v = (readEnv().get('CLAUDE_ACCOUNT_AUTO_FAILOVER') ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}
export function setAutoFailover(on: boolean): void { autoFailoverOverride = on; }

/** Parse "1:50pm (UTC)" / "13:50 (UTC)" from Claude's limit message into an epoch; fallback 60 min. */
export function parseResetTime(text: string | undefined): number {
  const now = Date.now();
  const m = text?.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  // "out of usage credits" gives no reset time: the plan's credits are gone until a top-up
  // or the weekly reset, so keep that account parked for a while instead of retrying every hour.
  if (!m) return now + (/credits/i.test(text ?? '') ? 6 : 1) * 60 * 60_000;
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(now);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min, 0);
  const t = utc <= now ? utc + 24 * 60 * 60_000 : utc;
  return Math.min(t, now + 6 * 60 * 60_000); // never block more than 6h on a bad parse
}

export function markExhausted(key: AccountKey, resetText?: string): void {
  exhaustedUntil.set(key, parseResetTime(resetText));
  saveState();
}
/** Park an account for a number of hours (manual switch away from it, or a limit with no reset time). */
export function parkAccount(key: AccountKey, hours: number): void {
  exhaustedUntil.set(key, Date.now() + hours * 60 * 60_000);
  saveState();
}

export function isExhausted(key: AccountKey): boolean {
  const until = exhaustedUntil.get(key) ?? 0;
  if (until <= Date.now()) { exhaustedUntil.delete(key); saveState(); return false; }
  return true;
}

/**
 * Current account hit its limit: mark it and switch to the other one if it is
 * configured and not known to be exhausted. Returns the new account or null.
 */
export function failover(resetText?: string): { from: AccountKey | 'custom' | 'none'; to: AccountKey } | null {
  const from = getActiveAccount();
  if (from === 'lc' || from === 'iw') markExhausted(from, resetText);
  const candidates = configuredAccounts().filter((k) => k !== from && !isExhausted(k));
  if (candidates.length === 0) return null;
  const to = candidates[0];
  setActiveAccount(to);
  return { from, to };
}

export function getPreferred(): AccountKey | null {
  const v = (readEnv().get('CLAUDE_ACCOUNT_PREFERRED') ?? '').toLowerCase();
  return v === 'lc' || v === 'iw' ? v : null;
}

/**
 * Called periodically: if we are on a fallback account and the preferred one is
 * past its reset time, switch back. Returns the account we returned to, or null.
 */
export function maybeReturnToPreferred(): AccountKey | null {
  const pref = getPreferred();
  if (!pref) return null;
  const active = getActiveAccount();
  if (active === pref) return null;
  if (!configuredAccounts().includes(pref) || isExhausted(pref)) return null;
  setActiveAccount(pref);
  logger.warn({ account: pref }, 'Returned to preferred Claude account after its limit reset');
  return pref;
}

export function accountStatusText(): string {
  const active = getActiveAccount();
  const lines: string[] = [];
  lines.push('Cuenta activa: ' + (active === 'lc' || active === 'iw' ? ACCOUNTS[active].label : active));
  for (const k of Object.keys(ACCOUNTS) as AccountKey[]) {
    const conf = configuredAccounts().includes(k);
    const ex = isExhausted(k) ? ' (límite hasta ' + new Date(exhaustedUntil.get(k)!).toISOString().slice(11, 16) + ' UTC)' : '';
    lines.push((k === active ? '• ' : '  ') + k + ': ' + (conf ? 'configurada' : 'sin token') + ex);
  }
  lines.push('Failover automático: ' + (autoFailoverEnabled() ? 'on' : 'off') + (getPreferred() ? ' · cuenta principal: ' + getPreferred() + ' (vuelve sola al restablecerse)' : ''));
  lines.push('Uso: /cuenta lc | /cuenta iw | /cuenta auto on|off');
  return lines.join('\n');
}
