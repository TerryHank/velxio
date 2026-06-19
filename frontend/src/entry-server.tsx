/**
 * SSR entry point for prerendering SEO pages at build time.
 *
 * Used by scripts/prerender-seo.mjs via Vite's ssrLoadModule.
 * Renders each page component to an HTML string so the prerender script
 * can inject it into the static dist/index.html per route.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SEO_ROUTES } from './seoRoutes';

// ── SEO page components ─────────────────────────────────────────────────────
import { exampleProjects } from './data/examples';
import { ExamplesPage } from './pages/ExamplesPage';
import { DocsPage } from './pages/DocsPage';
import { ExampleDetailPage } from './pages/ExampleDetailPage';

// Map route paths to their React component
const ROUTE_COMPONENTS: Record<string, React.FC> = {
  '/examples': ExamplesPage,
  // Docs sections — all use DocsPage with different URL params
  '/docs': DocsPage,
  '/docs/intro': DocsPage,
  '/docs/getting-started': DocsPage,
  '/docs/emulator': DocsPage,
  '/docs/esp32-emulation': DocsPage,
  '/docs/riscv-emulation': DocsPage,
  '/docs/rp2040-emulation': DocsPage,
  '/docs/raspberry-pi3-emulation': DocsPage,
  '/docs/components': DocsPage,
  '/docs/architecture': DocsPage,
  '/docs/third-party': DocsPage,
  '/docs/mcp': DocsPage,
  '/docs/setup': DocsPage,
  '/docs/roadmap': DocsPage,
};

/**
 * Returns all routes that have both seoMeta and a renderable component.
 */
export function getPrerenderedRoutes() {
  return SEO_ROUTES.filter((r) => r.seoMeta && ROUTE_COMPONENTS[r.path]);
}

/**
 * Render a route's page component to an HTML string.
 */
export function render(path: string): string {
  const Component = ROUTE_COMPONENTS[path];
  if (!Component) return '';

  try {
    return renderToString(
      <MemoryRouter initialEntries={[path]}>
        <Component />
      </MemoryRouter>,
    );
  } catch (err) {
    console.warn(`  ⚠ SSR render failed for ${path}:`, (err as Error).message);
    return '';
  }
}

/**
 * Returns all example routes to prerender, one per example project.
 */
export function getPrerenderedExampleRoutes() {
  return exampleProjects.map((e) => ({
    path: `/examples/${e.id}`,
    title: `${e.title} — Free Arduino Simulator Example | Velxio`,
    description: `${e.description}. Run this example free in your browser — no install, no account required.`,
    url: `https://velxio.dev/examples/${e.id}`,
  }));
}

/**
 * Render an example detail page to an HTML string.
 */
export function renderExample(exampleId: string): string {
  try {
    return renderToString(
      <MemoryRouter initialEntries={[`/examples/${exampleId}`]}>
        <ExampleDetailPage />
      </MemoryRouter>,
    );
  } catch (err) {
    console.warn(`  ⚠ SSR render failed for /examples/${exampleId}:`, (err as Error).message);
    return '';
  }
}
