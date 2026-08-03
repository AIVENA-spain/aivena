// Amanda demo — server-side proxy (private preview only).
//
// The browser calls THIS same-origin route; it forwards to the live, is_test-gated
// Amanda API. Enforcement points (all server-side, un-bypassable from the client):
//   • the agency is HARDCODED to `test-agency` — the path :agency is ignored, and any
//     non-test slug is rejected 403 (no real-agency slug is ever forwarded);
//   • every session token is prefixed `amanda-preview-` so all residue is identifiable
//     and purgeable;
//   • the whole route is env-gated: AMANDA_DEMO_ENABLED !== "true" → 503 (off-switch).
// No secrets here; the upstream /chat endpoints are public + is_test-gated. No CORS
// (server-to-server). No provider/send path is touched.

const UPSTREAM = "https://aivena-production.up.railway.app";
const TEST_AGENCY = "test-agency";          // the ONLY agency this demo ever talks to
const SESSION_PREFIX = "amanda-preview-";   // marks all preview residue for cleanup

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (process.env.AMANDA_DEMO_ENABLED !== "true") {
    return res.status(503).json({ ok: false, error: "demo_disabled" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const action = req.query.action;
  if (action !== "message" && action !== "contact") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  // Defense-in-depth: never accept a non-test agency slug from the client.
  const requested = req.query.agency;
  if (requested && requested !== TEST_AGENCY) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  // Enforce the preview session prefix so every row this demo creates is purgeable.
  if (typeof body.sessionToken === "string" && body.sessionToken) {
    body.sessionToken = body.sessionToken.startsWith(SESSION_PREFIX)
      ? body.sessionToken
      : SESSION_PREFIX + body.sessionToken;
  }

  try {
    const upstream = await fetch(`${UPSTREAM}/chat/${TEST_AGENCY}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  } catch (_e) {
    return res.status(502).json({ ok: false, error: "upstream_unreachable" });
  }
};
