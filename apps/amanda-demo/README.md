# Amanda demo — private preview (fictional agency)

A **private, password-gated** Vercel preview of AIVENA's Amanda assistant embedded in a
**fictional** real-estate agency site ("Costa Vista Estates"). NOT public, NOT indexed,
NOT a real agency, NOT the AIVENA homepage/dashboard/marketing site.

- `index.html` — the fictional agency page (hero / properties / valuation are **visual only**) + Amanda bubble.
- `widget/amanda.html` — the real Amanda widget (Phase-B, with property cards), a self-contained copy.
- `api/chat/[agency]/[action].js` — server proxy: **hardcodes `test-agency`**, prefixes sessions
  `amanda-preview-`, env-gated by `AMANDA_DEMO_ENABLED` (off → 503). No secrets, no CORS, no provider send.

## Privacy (set at deploy — separate go-ask)
- Vercel **Deployment Protection** (password or Vercel SSO) on the project.
- `robots.txt` disallow + `X-Robots-Tag: noindex` (vercel.json) + `<meta noindex>`.
- Env `AMANDA_DEMO_ENABLED=true` to turn on; unset/anything-else → the proxy returns 503.

## Off switch
Disable/delete the Vercel deployment, or set `AMANDA_DEMO_ENABLED` ≠ `true` (proxy 503s).
