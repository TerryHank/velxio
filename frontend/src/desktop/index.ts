/**
 * Velxio Desktop SPA hooks — mounted from main.tsx when VITE_DESKTOP is set.
 *
 * Two responsibilities in Phase 3:
 *
 *  1. Show the welcome / sign-in screen if the stored license key
 *     fails validation. While the welcome screen is up, the SPA's
 *     editor is hidden behind it so the user can't compile / run.
 *  2. Mount desktop-only side panels (the ESP32 QEMU prompt).
 *
 * Phase 4 will add the offline JWT cache and grace banners on top.
 *
 * Pure OSS still runs without any of this (the dynamic import is
 * tree-shaken when the env flag is unset). The pro overlay also
 * doesn't load in desktop builds, so this module owns the desktop UI.
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { createElement as h, Fragment } from 'react';
import { DesktopWelcomePage } from './DesktopWelcomePage';
import { Esp32QemuPrompt } from './Esp32QemuPrompt';
import { GraceBanner } from './GraceBanner';
import { invoke, isTauri, type ValidationResult } from './tauriBridge';
import { installDesktopMenuListener } from './menu';
import { dlog } from './log';
import './desktop.css';

let mounted = false;
let welcomeRoot: Root | null = null;
let welcomeHost: HTMLElement | null = null;
let sidePanelRoot: Root | null = null;

function unmountWelcome(): void {
  if (welcomeRoot) {
    try { welcomeRoot.unmount(); } catch { /* noop */ }
    welcomeRoot = null;
  }
  if (welcomeHost) {
    welcomeHost.remove();
    welcomeHost = null;
  }
}

function mountWelcome(): void {
  if (welcomeRoot) return;
  welcomeHost = document.createElement('div');
  welcomeHost.id = 'velxio-desktop-welcome-root';
  document.body.appendChild(welcomeHost);
  welcomeRoot = createRoot(welcomeHost);
  welcomeRoot.render(
    createElement(DesktopWelcomePage, {
      onAuthorised: () => unmountWelcome(),
    }),
  );
}

function mountSidePanels(): void {
  if (sidePanelRoot) return;
  const host = document.createElement('div');
  host.id = 'velxio-desktop-side-panels';
  document.body.appendChild(host);
  sidePanelRoot = createRoot(host);
  // Single root for both side-panel surfaces so we don't burn extra
  // React roots on the document. Both renderers return null when
  // they have nothing to show, so the only cost is the subscription
  // they each install.
  sidePanelRoot.render(
    h(Fragment, null, h(GraceBanner, null), h(Esp32QemuPrompt, null)),
  );
}

/**
 * Resolve the initial license state in the background.
 *
 * Policy: the editor ALWAYS opens directly on first launch. Compile,
 * run, simulate AVR/RP2040/ATtiny, save .vlx — all that works
 * without a license because it's upstream OSS functionality.
 *
 * The welcome / sign-in screen used to mount unconditionally when
 * the license check failed; that gated 100% of the app behind an
 * account and broke the "try before you buy" expectation. Now the
 * check just runs to populate state for downstream consumers:
 *
 *   - GraceBanner subscribes to `velxio://license-status` and shows
 *     the amber/red banner only when an EXISTING license enters
 *     soft/hard grace, lock, or tampered state.
 *   - Pro-only features (ESP32 QEMU download, agent IA) check
 *     entitlements at use time and prompt then.
 *
 * Sign-in is still reachable via the native menubar
 * (View → ... in pro/desktop/src-tauri/src/menu.rs).
 */
async function checkInitialLicense(): Promise<void> {
  if (!isTauri()) return;
  try {
    const key = await invoke<string | null>('license_get_key');
    if (!key) {
      dlog('checkInitialLicense: no key — anonymous mode (editor open, free OSS features)');
      return;
    }
    const result = await invoke<ValidationResult>('license_validate', { key });
    dlog('checkInitialLicense: validated', {
      valid: result.valid,
      plan: result.plan,
      reason_code: result.reason_code,
    });
    // We deliberately don't mountWelcome here even if invalid — the
    // GraceBanner shows for invalid keys (locked / tampered), and an
    // anonymous-mode user (no key at all) sees nothing extra.
  } catch (err) {
    dlog('checkInitialLicense: failed', { err: String(err) });
  }
}

export const mountDesktop = (): void => {
  if (mounted) return;
  mounted = true;
  dlog('mountDesktop — Tauri shell active');

  // Native menubar (Velxio / File / Edit / View / Help) sends events
  // here. Hook the listener before any UI is mounted so the first
  // user click is never dropped.
  void installDesktopMenuListener();

  mountSidePanels();
  void checkInitialLicense();
};
