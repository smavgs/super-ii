# Super ii launch design QA

Date: 2026-08-28  
Public implementation: https://superii.site  
Cloudflare fallback: https://super-ii-site.moneymakergpts.workers.dev  
Deployment verified: Cloudflare Worker version `326122eb-0ef7-40c8-bb4b-c75a6ae5efde`

## Source and implementation

- User-supplied brand source retained at `/Users/apple/Documents/Super ii Website/public/brand/super-ii-logo.png`.
- Source logo SHA-256: `b28353284ddd75513d5344684711a2a2f50065197b9510c12b909adbd346f60f`.
- Brand validation fails closed if the supplied logo changes.
- Primary implementation paths: `src/pages`, `src/components`, `src/layouts`, `src/styles/global.css`, `src/content/site.json`, and `public`.
- Launch stack represented and verified in the repository: TypeScript, Astro, CSS, Python, PL/pgSQL, JavaScript, Shell, and Go.

## Visual comparison history

1. The supplied yellow rounded-square `Sii` mark was compared side by side with the implemented hero mark.
2. The implementation preserves the exact supplied pixels; only layout crop, responsive sizing, and the contextual “Built in public” caption differ.
3. Desktop and mobile screenshots were visually inspected for spacing, typography, borders, radii, image crop, alignment, and section rhythm.
4. A live QA pass found two tiny empty Clerk triggers beside separate visible header buttons. The implementation was corrected by binding every custom Clerk button with `asChild`, and a Python regression rule now rejects this markup mistake.
5. The corrected build was redeployed and compared again. No unacceptable visual or interaction mismatch remains.

Evidence:

- `qa/evidence/logo-comparison.png`
- `qa/evidence/desktop-home.png` at 1440 x 900
- `qa/evidence/mobile-home.png` at 390 x 844

## Viewports and responsive behavior

- Desktop: 1440 x 900; document width 1440; no horizontal overflow.
- Mobile: 390 x 844; document width 390; no horizontal overflow.
- Desktop navigation, mobile navigation, cards, CTA bands, footer columns, logo, and empty-catalog preview remain readable and aligned.
- Mobile navigation opens with `aria-expanded=true`, exposes Models, Datasets, Apps, Pricing, Docs, Log in, and Join free, then closes with `aria-expanded=false`.
- Dark theme switches on and returns to light without console errors.

## Core interactions

- Header Log in opens the Clerk sign-in modal.
- Header Join free opens the Clerk sign-up modal.
- Account Log in opens the Clerk sign-in modal.
- Explore the hub resolves to `/models`.
- Join Super ii resolves to `/sign-up`.
- Sign-in and sign-up pages render passwordless email, Google, and GitHub controls.
- Clerk production policy was independently read back after save: normal first factors are email code, Google OAuth, and GitHub OAuth; password sign-up and adding a password are disabled.
- No test identity was created and no personal email or OAuth account was transmitted during QA.
- Contact submission previously returned HTTP 201, was verified in Neon, and its uniquely identified QA row was deleted after verification.

## Accessibility and semantics

- Exactly one page H1 on the homepage at both tested viewports.
- Header, primary/mobile navigation, main, and footer landmarks are present.
- Zero images missing `alt` attributes.
- Zero unnamed buttons after the Clerk binding correction.
- Skip-to-content, theme, menu, modal-close, and navigation labels are exposed to assistive technology.
- No horizontal overflow at the tested desktop or mobile viewport.

## Browser and console

- Browser: the user's connected Google Chrome only.
- Live homepage, sign-in, sign-up, account, menu, theme, CTA, and Clerk modal checks completed.
- Final live Chrome console result: zero errors on all tested production states.

## Routes, health, and discovery

All 18 canonical routes returned HTTP 200 directly through the normal resolver:

`/`, `/models`, `/datasets`, `/spaces`, `/pricing`, `/organizations`, `/enterprise`, `/docs`, `/about`, `/contact`, `/security`, `/status`, `/sign-in`, `/sign-up`, `/account`, `/legal/privacy`, `/legal/terms`, and `/api/health`.

The health endpoint reported:

- website: `ok`
- authentication: `ok`
- database: `ok`
- catalog: `ok-empty`

`robots.txt` and `sitemap.xml` return HTTP 200, with 14 indexable public routes in the sitemap and account/auth/API routes excluded from crawling.

## Security, DNS, and edge delivery

- Namecheap delegates to `meadow.ns.cloudflare.com` and `will.ns.cloudflare.com`.
- Apex, `www`, Clerk application, Clerk account portal, Clerk mail, and DKIM records were verified.
- Apex and `www` HTTPS return HTTP 200; HTTP redirects to HTTPS with HTTP 301.
- TLS certificate is valid for `superii.site`; minimum TLS is 1.2 and TLS 1.3 is enabled.
- HSTS, CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, COOP, and CORP headers are present.
- Cloudflare serves the public deployment on the free plan; the fallback workers.dev route remains enabled.
- Release scan checked 94 files and found no private local values in the bundle.

## Engineering verification

- `npm run check`: 36 files, zero errors, warnings, or hints.
- `npm run validate`: supplied logo, empty catalogs, four plans, 18 routes, and internal links passed.
- `npm run db:check`: one migration, nine tables, PL/pgSQL, RLS, and empty repository catalog passed.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm run build`: production Worker build completed and secret scan passed.
- Cloudflare deployment: Worker startup time 20 ms; both custom domains and workers.dev trigger deployed.

## Final assessment

The launch implementation matches the supplied brand, works responsively, exposes the approved authentication methods, keeps catalogs honestly empty, and passes the final visual, interaction, accessibility, console, route, database, security, and deployment checks.

final result: passed
