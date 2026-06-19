import { useEffect, type ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { EditorPage } from './pages/EditorPage';
import { ExamplesPage } from './pages/ExamplesPage';
import { DocsPage } from './pages/DocsPage';
// Login, Register, ForgotPassword, ResetPassword, Admin, UserProfile,
// Project, ProjectById — moved to the pro overlay in Phase 3 of the
// OSS split. They register themselves via registerProRoutes() inside
// mountPro() and appear under /login, /admin, /:username etc. only when
// the overlay is loaded.
import { ExampleDetailPage } from './pages/ExampleDetailPage';
import { ExampleEditorPage } from './pages/ExampleEditorPage';
import { LocaleSync } from './i18n/LocaleSync';
import { NON_DEFAULT_LOCALES } from './i18n/config';
import { useProRoutes } from './lib/proRoutes';
import { triggerSessionCheck } from './lib/proSession';
import './App.css';

/**
 * Single source of truth for the route tree. Each entry is registered
 * twice in <Routes> below: once at the root (default locale) and once
 * nested under each non-default locale prefix (e.g. `/es/editor`).
 *
 * Index entries (path === '') belong to the locale-prefixed parent's
 * `index` slot — they render at exactly `/<locale>/`.
 */

const ROUTES: { path: string; element: ReactElement; index?: boolean }[] = [
  { path: '/', element: <Navigate to="/editor" replace />, index: true },
  { path: 'editor', element: <EditorPage /> },
  { path: 'examples', element: <ExamplesPage /> },
  // /examples/<id> = SEO landing (preview, badges, "Open in Simulator" CTA).
  // /example/<id>  = live editor with the example pre-loaded; the URL
  //                  stays pinned so links are shareable + bookmarkable.
  // Singular vs plural is intentional — Google indexes the plural landings.
  { path: 'examples/:exampleId', element: <ExampleDetailPage /> },
  { path: 'example/:exampleId', element: <ExampleEditorPage /> },
  { path: 'docs', element: <DocsPage /> },
  { path: 'docs/:section', element: <DocsPage /> },
];

// Vite exposes the configured deployment base at build time. React Router
// needs the same prefix when the app is hosted as a GitHub project page.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

function App() {
  // Pro overlay registers extra routes (login, register, admin, profile,
  // project-by-slug, …) via registerProRoutes() inside mountPro(). The
  // subscription is sync external store, so any registration after the
  // initial render triggers a re-render — no Not-Found flash for routes
  // the overlay was about to add.
  const proRoutes = useProRoutes();
  const allRoutes = [...ROUTES, ...proRoutes];

  useEffect(() => {
    // Pro overlay's mountPro() registers a session-check callback that
    // resolves the JWT cookie into a user object. No-op in OSS without
    // the overlay.
    triggerSessionCheck();
    // #root-seo is a static SEO fallback in index.html (position:absolute,
    // visibility:hidden). It still contributes to document scrollHeight, so
    // every page got a phantom scroll the size of the prerendered SEO body.
    document.getElementById('root-seo')?.remove();
  }, []);

  return (
    <Router basename={ROUTER_BASENAME}>
      <LocaleSync>
        <Routes>
          {/* Default locale (English) — no URL prefix. */}
          {allRoutes.map((r) =>
            r.index ? (
              <Route key="root" path="/" element={r.element} />
            ) : (
              <Route key={r.path} path={`/${r.path}`} element={r.element} />
            )
          )}

          {/*
            Non-default locales — same routes nested under `/<locale>/`.
            We register one branch per locale rather than a `:lang` param
            so React Router doesn't accidentally swallow real top-level
            paths like `/circuit-simulator` as a locale segment.
          */}
          {NON_DEFAULT_LOCALES.map((locale) => (
            <Route key={`locale-${locale}`} path={`/${locale}`}>
              {allRoutes.map((r) =>
                r.index ? (
                  <Route key={`${locale}-root`} index element={r.element} />
                ) : (
                  <Route
                    key={`${locale}-${r.path}`}
                    path={r.path}
                    element={r.element}
                  />
                )
              )}
            </Route>
          ))}
        </Routes>
      </LocaleSync>
    </Router>
  );
}

export default App;
