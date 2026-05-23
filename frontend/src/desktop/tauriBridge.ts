/**
 * Thin typed wrapper around the Tauri IPC surface used by the desktop
 * frontend modules. Falls back to `null` when the global isn't present,
 * letting components render gracefully when the bundle is somehow
 * loaded outside Tauri (during `vite dev` against a regular browser
 * tab, for instance).
 */

export type ValidationResult = {
  valid: boolean;
  plan?: string | null;
  status?: string | null;
  reason_code?: string | null;
  trial_ends_at?: string | null;
  subscription_period_end?: string | null;
  entitlements?: Record<string, boolean>;
};

export type TauriInvoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type TauriListen = <T = unknown>(
  event: string,
  cb: (payload: { payload: T }) => void,
) => Promise<() => void>;

type TauriGlobal = {
  core?: { invoke?: TauriInvoke };
  invoke?: TauriInvoke;
  event?: { listen?: TauriListen };
};

function tauri(): TauriGlobal | null {
  const w = window as { __TAURI__?: TauriGlobal };
  return w.__TAURI__ ?? null;
}

export function isTauri(): boolean {
  return tauri() !== null;
}

export const invoke: TauriInvoke = async (cmd, args) => {
  const t = tauri();
  if (!t) throw new Error('Tauri runtime not available');
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) throw new Error('Tauri invoke handler not available');
  return fn(cmd, args);
};

export const listen: TauriListen = async (event, cb) => {
  const t = tauri();
  if (!t?.event?.listen) {
    // No-op subscription if event API isn't ready (e.g. during `vite dev`).
    return () => undefined;
  }
  return t.event.listen(event, cb);
};

export async function openExternal(url: string): Promise<void> {
  const t = tauri();

  // Outside Tauri (vite dev in a regular browser tab) — just delegate
  // to window.open. Works because the real browser obeys it.
  if (!t) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  // Inside Tauri the global API path changed between versions and
  // between `withGlobalTauri` exposure flags. Try every known path
  // and stop at the first one that returns without throwing. Each
  // attempt is logged best-effort so the desktop-debug.log file
  // shows exactly which one worked (or that none did).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = t as any;
  const attempts: Array<[string, () => Promise<unknown>]> = [
    // tauri-plugin-opener — the official Tauri 2.x way for opening
    // URLs in the system browser. Most reliable, try first.
    ['invoke opener.open_url', () => invoke('plugin:opener|open_url', { url })],
    ['invoke opener.open',     () => invoke('plugin:opener|open_url', { path: url })],
    // tauri-plugin-shell open — older path, arg shape varies between
    // 2.x releases; try both.
    ['invoke shell.open path', () => invoke('plugin:shell|open', { path: url, with: null })],
    ['invoke shell.open url',  () => invoke('plugin:shell|open', { url })],
    // Global wrappers (only present in specific Tauri 2.x configs).
    ['shell.open',     () => tg.shell?.open?.(url)],
    ['opener.openUrl', () => tg.opener?.openUrl?.(url)],
    ['opener.open',    () => tg.opener?.open?.(url)],
  ];

  let lastError: unknown = null;
  for (const [name, fn] of attempts) {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        await r;
      } else if (r === undefined) {
        // The wrapper didn't exist (optional chaining short-circuited
        // to undefined). Skip silently and try the next path.
        continue;
      }
      tryLog(`openExternal: ${name} succeeded`, { url });
      return;
    } catch (err) {
      lastError = err;
      // Keep trying.
    }
  }

  tryLog('openExternal: every IPC path failed, falling back to window.open', {
    url,
    lastError: lastError ? String(lastError) : null,
  });
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Best-effort, no-throw: log via the desktop write_debug_log command
// when available. Defined here so openExternal can use it without
// importing from desktop/log.ts (which would create a cycle).
function tryLog(message: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  console.log('[velxio-desktop]', message, extra ?? '');
  const t = tauri();
  if (!t) return;
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) return;
  let line = message;
  if (extra !== undefined) {
    try { line += ' ' + JSON.stringify(extra); }
    catch { line += ' ' + String(extra); }
  }
  void (fn as TauriInvoke)('write_debug_log', { message: line }).catch(() => {});
}

function randomNonce(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function beginSignIn(apiBase = 'https://velxio.dev'): Promise<string> {
  const state = randomNonce();
  await invoke('license_register_nonce', { nonce: state });
  const signInUrl =
    `${apiBase.replace(/\/+$/, '')}/auth/desktop?state=${encodeURIComponent(state)}`;
  await openExternal(signInUrl);
  return state;
}
