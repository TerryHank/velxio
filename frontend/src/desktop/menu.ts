/**
 * Native menubar event bridge.
 *
 * The Tauri shell (pro/desktop/src-tauri/src/menu.rs in velxio-prod)
 * builds a Velxio / File / Edit / View / Help menubar. Internal items
 * (Save .vlx, Open .vlx, Toggle Serial Monitor, Find, …) emit a
 * `velxio://menu` event with `{ action: '<id>' }`. URL items (Docs,
 * Examples, Discord, GitHub) are opened directly from Rust and don't
 * reach this listener.
 *
 * Actions handled directly here (no further plumbing needed):
 *   - save-vlx, open-vlx     → triggerDownloadVlx / file picker
 *   - toggle-serial-monitor  → useSimulatorStore.toggleSerialMonitor()
 *   - check-for-updates      → tauri-plugin-updater check()
 *
 * Actions forwarded to whoever's listening as a window CustomEvent
 * `velxio:menu:<action>`:
 *   - new-project, find-in-editor, toggle-file-explorer
 *
 * No-op outside Tauri (e.g. running the bundle in a regular browser
 * for debugging) — listen() returns a no-op when the global event
 * API isn't present.
 */

import { listen } from './tauriBridge';
import { dlog } from './log';
import { triggerDownloadVlx, importVlxFile } from '../utils/vlxFile';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { switchLocale } from '../i18n/path';
import { LOCALES, type Locale } from '../i18n/config';

type MenuAction =
  | 'new-project'
  | 'save-vlx'
  | 'open-vlx'
  | 'find-in-editor'
  | 'toggle-file-explorer'
  | 'toggle-serial-monitor'
  | 'check-for-updates'
  | 'set-locale'
  | 'navigate-route';

interface MenuEventPayload {
  action: MenuAction;
  // Only present when action='set-locale'. Matches an entry in
  // i18n/config.ts::LOCALES.
  locale?: string;
  // Only present when action='navigate-route'. Absolute pathname
  // (e.g. '/examples', '/docs', '/about') — navigated via React
  // Router so the current locale prefix gets applied.
  route?: string;
}

let installed = false;

export async function installDesktopMenuListener(): Promise<void> {
  if (installed) return;
  installed = true;
  await listen<MenuEventPayload>('velxio://menu', (event) => {
    dlog('menu event', event.payload);
    void handle(event.payload.action, event.payload);
  });
}

async function handle(action: MenuAction, payload?: MenuEventPayload): Promise<void> {
  switch (action) {
    case 'save-vlx':
      triggerDownloadVlx();
      return;
    case 'open-vlx':
      pickAndImportVlx();
      return;
    case 'toggle-serial-monitor':
      useSimulatorStore.getState().toggleSerialMonitor();
      return;
    case 'new-project':
    case 'find-in-editor':
    case 'toggle-file-explorer':
      window.dispatchEvent(new CustomEvent(`velxio:menu:${action}`));
      return;
    case 'check-for-updates':
      await checkForUpdates();
      return;
    case 'set-locale':
      if (payload?.locale) setLocale(payload.locale);
      return;
    case 'navigate-route':
      if (payload?.route) navigateTo(payload.route);
      return;
  }
}

function navigateTo(route: string): void {
  // Prefix with the current locale if we're on a non-default one,
  // so `/examples` from `/es/editor` lands at `/es/examples` instead
  // of switching back to English. Mirrors how LanguageSwitcher does it.
  const cur = window.location.pathname;
  const localeMatch = cur.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\b/);
  const prefix = localeMatch && LOCALES.includes(localeMatch[1] as Locale)
    ? `/${localeMatch[1]}`
    : '';
  const normalised = route.startsWith('/') ? route : `/${route}`;
  const next = `${prefix}${normalised}`;
  if (next === cur) return;
  // history.pushState + popstate keeps React Router happy without
  // reloading the SPA (Monaco state, simulator state, sidecar
  // connection all preserved).
  window.history.pushState(null, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function setLocale(locale: string): void {
  // Defensive: ignore unknown locales coming from the menu so a
  // stale shell doesn't navigate to a broken URL.
  if (!(LOCALES as readonly string[]).includes(locale)) {
    dlog('set-locale: ignoring unknown locale', { locale });
    return;
  }
  const target = locale as Locale;
  const next =
    switchLocale(window.location.pathname, target) +
    window.location.search +
    window.location.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) {
    return;
  }
  // history.pushState + popstate lets React Router pick the change up
  // without a full reload, preserving the editor state. Reload would
  // re-spawn the sidecar handshake and lose Monaco/sim state for ~5s.
  window.history.pushState(null, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function pickAndImportVlx(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.vlx,application/json';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      try {
        await importVlxFile(file);
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(`Failed to open .vlx: ${(err as Error).message}`);
      }
    }
    document.body.removeChild(input);
  });
  input.click();
}

async function checkForUpdates(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updater = (window as any).__TAURI__?.updater;
    if (!updater?.check) {
      // eslint-disable-next-line no-alert
      alert('Update plugin not available in this build.');
      return;
    }
    const update = await updater.check();
    if (update) {
      await update.downloadAndInstall();
    } else {
      // eslint-disable-next-line no-alert
      alert('Velxio Desktop is up to date.');
    }
  } catch (err) {
    // eslint-disable-next-line no-alert
    alert(`Update check failed: ${(err as Error).message}`);
  }
}
