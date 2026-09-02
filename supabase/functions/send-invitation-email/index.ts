// CAPTURE (version control) of the deploy-only Edge Function `send-invitation-email`.
// Slug: send-invitation-email · id bbac2b05-65e1-4147-b0be-93f870b1bc5c · version 19 · ACTIVE
// verify_jwt=TRUE — operator-triggered, keep it true on any redeploy.
// ezbr_sha256: ecd1a847b482d1fa3b2ac46235d596f0f2da75b2250d1a4b32ac95e22301ed69
// Captured 2026-09-01 from the DEPLOYED source. No secrets present — the Resend
// key resolves from Vault, falling back to an env var.
// NOT byte-identical to live in one harmless respect: the deployed source writes
// Spanish accents and em dashes as \u00f3 / \u2014 escapes; this capture writes
// the literal characters. JavaScript sees the SAME string either way, so the
// behaviour is identical — but it means a raw byte diff against live will show
// these lines. Compare the rendered strings, not the bytes.
// Do NOT deploy this file without diffing against live first — the repo has been stale before.
//
// send-invitation-email — Resend-backed transactional invite delivery.
//
// Two modes (POST JSON body):
//   { invitation_id: "<uuid>" }     → single send
//   { mode: "backfill" }            → fan out to all pending, unsent, < 5 attempts, unexpired
//
// Auth: verify_jwt:true. Operator-triggered (Hono service-role JWT in normal
// flow, or Christian's service-role for manual backfill). The owner gate ran
// at create_invitation time — sending here just delivers an existing artifact.
// Throttle: send_attempts cap (5) per invitation.
//
// Locale: inviter's user_preferences.ui_language → en/es; everything else → en.
// FROM: invites@send.aivena.es (same verified Resend domain as the buyer path).
// REPLY-TO: inviter's auth.users email (real human, not a black hole).
// CTA: ${DASHBOARD_ORIGIN}/invite/accept?token=<token>
//
// All errors are structured envelopes; nothing user-facing leaks raw stack text.
//
// v9 (2026-06-10): auth.users lookup now goes through public._admin_get_inviter_metadata
// (SECURITY DEFINER, service_role-only). PostgREST does not expose the auth
// schema, so the prior schema("auth").from("users") call always returned empty
// → inviter_metadata_missing for every send.
//
// v10 (2026-06-11): Resend API key now loads from Vault via _get_platform_secret
// (secret name RESEND_INVITE_API_KEY), with a fallback to the legacy
// RESEND_API_KEY env var if the Vault secret is absent. This removes the need
// to set a dashboard Edge Function secret — the key lives in Vault alongside the
// other platform secrets (Twilio, kie.ai). The key is resolved once per request
// at the start of the handler.
//
// v11 (2026-06-11): DASHBOARD_ORIGIN default changed from https://aivena.es to
// https://aivena.es/dashboard, since the dashboard ships under a /dashboard
// basePath (Next.js) and the accept page lives at /dashboard/invite/accept.
// An explicit DASHBOARD_ORIGIN env var still overrides this default if set.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL                = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY_ENV          = Deno.env.get("RESEND_API_KEY"); // legacy fallback only
const DASHBOARD_ORIGIN            = Deno.env.get("DASHBOARD_ORIGIN") || "https://aivena.es/dashboard";

const FROM_ADDRESS       = "AIVENA <invites@send.aivena.es>";
const SEND_ATTEMPTS_CAP  = 5;
const SUPPORTED_LOCALES  = ["en", "es"] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Resolve the Resend key: Vault (RESEND_INVITE_API_KEY) first, env var fallback.
async function resolveResendKey(admin: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await admin.rpc("_get_platform_secret", { p_name: "RESEND_INVITE_API_KEY" });
    if (!error && data && typeof data === "string" && data.length > 0) return data;
  } catch { /* fall through to env */ }
  return RESEND_API_KEY_ENV ?? null;
}

function normalizeLocale(s: string | null | undefined): Locale {
  if (s && (SUPPORTED_LOCALES as readonly string[]).includes(s)) return s as Locale;
  return "en";
}

// Role-label dictionary. Keep aligned with the agency_role enum.
const ROLE_LABELS: Record<Locale, Record<string, { definite: string; with_article: string }>> = {
  en: {
    agent:  { definite: "Agent",  with_article: "an Agent"  },
    viewer: { definite: "Viewer", with_article: "a Viewer"  },
    owner:  { definite: "Owner",  with_article: "an Owner"  },
  },
  es: {
    agent:  { definite: "Agente",     with_article: "Agente"     },
    viewer: { definite: "Espectador", with_article: "Espectador" },
    owner:  { definite: "Propietario", with_article: "Propietario" },
  },
};

function roleLabel(locale: Locale, role: string, form: "definite" | "with_article"): string {
  const entry = ROLE_LABELS[locale][role.toLowerCase()];
  if (entry) return entry[form];
  return role;
}

function formatExpiry(locale: Locale, isoDate: string): string {
  const d = new Date(isoDate);
  const fmtLocale = locale === "es" ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(fmtLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface TemplateCtx {
  locale:        Locale;
  inviterName:   string;
  inviterEmail:  string;
  brandName:     string;
  role:          string;
  acceptUrl:     string;
  expiresAtIso:  string;
}

function renderTemplate(ctx: TemplateCtx): { subject: string; html: string; text: string } {
  const { locale, inviterName, inviterEmail, brandName, role, acceptUrl, expiresAtIso } = ctx;
  const expiry  = formatExpiry(locale, expiresAtIso);
  const roleArt = roleLabel(locale, role, "with_article");

  let subject: string, headline: string, intro: string, ctaLabel: string;
  let expiryNotice: string, ignoreNotice: string, footer: string, greet: string;

  if (locale === "es") {
    subject      = `${inviterName} te ha invitado a unirte a ${brandName} en AIVENA`;
    greet        = "Hola,";
    headline     = `${inviterName} te ha invitado a unirte a ${brandName}`;
    intro        = `Has sido invitado a unirte a ${brandName} en AIVENA como ${roleArt}.`;
    ctaLabel     = "Aceptar invitación";
    expiryNotice = `Esta invitación expira el ${expiry}.`;
    ignoreNotice = "Si no esperabas este correo, puedes ignorarlo.";
    footer       = `Enviado por AIVENA en nombre de ${brandName}. Responde a este correo para contactar con ${inviterName} (${inviterEmail}).`;
  } else {
    subject      = `${inviterName} invited you to join ${brandName} on AIVENA`;
    greet        = "Hi,";
    headline     = `${inviterName} invited you to join ${brandName}`;
    intro        = `You've been invited to join ${brandName} on AIVENA as ${roleArt}.`;
    ctaLabel     = "Accept invitation";
    expiryNotice = `This invitation expires on ${expiry}.`;
    ignoreNotice = "If you didn't expect this email, you can safely ignore it.";
    footer       = `Sent by AIVENA on behalf of ${brandName}. Reply to this email to reach ${inviterName} (${inviterEmail}).`;
  }

  const text = [
    greet,
    "",
    `${inviterName} (${inviterEmail}) — ${intro}`,
    "",
    `${ctaLabel}: ${acceptUrl}`,
    "",
    expiryNotice,
    "",
    ignoreNotice,
    "",
    "— AIVENA",
    "",
    footer,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAF8F3;margin:0;padding:0;color:#0A0A0A;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:0.55;margin-bottom:18px;">AIVENA</div>
    <h1 style="font-size:22px;font-weight:600;line-height:1.3;margin:0 0 16px;color:#0A0A0A;">${escapeHtml(headline)}</h1>
    <p style="font-size:16px;line-height:1.55;margin:0 0 20px;color:#0A0A0A;">${escapeHtml(intro)}</p>
    <p style="margin:0 0 28px;">
      <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#0A0A0A;color:#1FE874;text-decoration:none;padding:13px 24px;border-radius:999px;font-weight:600;font-size:15px;">${escapeHtml(ctaLabel)}</a>
    </p>
    <p style="font-size:14px;color:#555;line-height:1.55;margin:0 0 12px;">${escapeHtml(expiryNotice)}</p>
    <p style="font-size:14px;color:#555;line-height:1.55;margin:0 0 32px;">${escapeHtml(ignoreNotice)}</p>
    <div style="border-top:1px solid #e8e6e0;padding-top:18px;font-size:12px;color:#888;line-height:1.5;">${escapeHtml(footer)}</div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

// ------------------------------------------------------------------------
// Per-invitation resolution + send. Returns a structured outcome record.
// ------------------------------------------------------------------------
interface InvitationContext {
  id:              string;
  agency_id:       string;
  email:           string;
  role:            string;
  token:           string;
  expires_at:      string;
  invited_by:      string;
  send_attempts:   number;
  status:          string;
  last_sent_at:    string | null;
  inviter_email:   string | null;
  inviter_name:    string | null;
  inviter_locale:  string | null;
  brand_name:      string | null;
}

async function fetchInvitationContext(
  admin: SupabaseClient,
  filter: { invitation_id?: string; backfill?: boolean }
): Promise<{ rows: InvitationContext[]; error?: string }> {
  let query = admin
    .from("invitations")
    .select("id, agency_id, email, role, token, expires_at, invited_by, send_attempts, status, last_sent_at");

  if (filter.invitation_id) {
    query = query.eq("id", filter.invitation_id);
  } else if (filter.backfill) {
    query = query
      .eq("status", "pending")
      .is("last_sent_at", null)
      .lt("send_attempts", SEND_ATTEMPTS_CAP)
      .gt("expires_at", new Date().toISOString());
  }

  const { data: invRows, error: invErr } = await query;
  if (invErr) return { rows: [], error: invErr.message };
  if (!invRows || invRows.length === 0) return { rows: [] };

  const inviterIds = Array.from(new Set(invRows.map((r: any) => r.invited_by)));
  const agencyIds  = Array.from(new Set(invRows.map((r: any) => r.agency_id)));

  // v9: inviter lookup via SECURITY DEFINER RPC, since PostgREST does not
  // expose the auth schema. The RPC returns ONLY (id, email, full_name) —
  // never the raw user row.
  const [usersRes, prefsRes, brandRes, agencyRes] = await Promise.all([
    admin.rpc("_admin_get_inviter_metadata", { p_user_ids: inviterIds }),
    admin.from("user_preferences")
      .select("user_id, ui_language")
      .in("user_id", inviterIds),
    admin.from("agency_branding")
      .select("agency_id, brand_name")
      .in("agency_id", agencyIds),
    admin.from("agencies")
      .select("id, trading_name, legal_name")
      .in("id", agencyIds),
  ]);

  if (usersRes.error) {
    return { rows: [], error: `inviter_lookup_failed: ${usersRes.error.message}` };
  }

  const usersById  = new Map((usersRes.data ?? []).map((u: any) => [u.id, u]));
  const prefsById  = new Map((prefsRes.data ?? []).map((p: any) => [p.user_id, p]));
  const brandById  = new Map((brandRes.data ?? []).map((b: any) => [b.agency_id, b]));
  const agencyById = new Map((agencyRes.data ?? []).map((a: any) => [a.id, a]));

  const out: InvitationContext[] = invRows.map((r: any) => {
    const u  = usersById.get(r.invited_by);
    const p  = prefsById.get(r.invited_by);
    const b  = brandById.get(r.agency_id);
    const a  = agencyById.get(r.agency_id);
    const brandName = b?.brand_name || a?.trading_name || a?.legal_name || "your agency";
    return {
      id: r.id,
      agency_id: r.agency_id,
      email: r.email,
      role: r.role,
      token: r.token,
      expires_at: r.expires_at,
      invited_by: r.invited_by,
      send_attempts: r.send_attempts,
      status: r.status,
      last_sent_at: r.last_sent_at,
      inviter_email: u?.email ?? null,
      inviter_name:  u?.full_name ?? null,
      inviter_locale: p?.ui_language ?? null,
      brand_name: brandName,
    };
  });

  return { rows: out };
}

interface SendOutcome {
  invitation_id: string;
  email: string;
  sent: boolean;
  resend_id?: string;
  error?: string;
  skipped_reason?: string;
}

async function sendOneInvitation(
  admin: SupabaseClient,
  ctx: InvitationContext,
  resendKey: string
): Promise<SendOutcome> {
  if (ctx.status !== "pending") {
    return { invitation_id: ctx.id, email: ctx.email, sent: false,
             skipped_reason: `invitation_status_${ctx.status}` };
  }
  if (new Date(ctx.expires_at).getTime() <= Date.now()) {
    return { invitation_id: ctx.id, email: ctx.email, sent: false,
             skipped_reason: "invitation_expired" };
  }
  if (ctx.send_attempts >= SEND_ATTEMPTS_CAP) {
    return { invitation_id: ctx.id, email: ctx.email, sent: false,
             skipped_reason: "send_attempts_exceeded" };
  }
  if (!ctx.inviter_email || !ctx.inviter_name) {
    return { invitation_id: ctx.id, email: ctx.email, sent: false,
             skipped_reason: "inviter_metadata_missing" };
  }

  const locale     = normalizeLocale(ctx.inviter_locale);
  const acceptUrl  = `${DASHBOARD_ORIGIN.replace(/\/$/, "")}/invite/accept?token=${encodeURIComponent(ctx.token)}`;
  const { subject, html, text } = renderTemplate({
    locale,
    inviterName:  ctx.inviter_name,
    inviterEmail: ctx.inviter_email,
    brandName:    ctx.brand_name || "your agency",
    role:         ctx.role,
    acceptUrl,
    expiresAtIso: ctx.expires_at,
  });

  let resendId: string | undefined;
  let sendErr: string | undefined;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       [ctx.email],
        subject,
        html,
        text,
        reply_to: ctx.inviter_email,
      }),
    });
    const raw = await resp.text();
    if (resp.ok) {
      try { resendId = JSON.parse(raw)?.id; } catch { /* ok */ }
    } else {
      sendErr = `resend_http_${resp.status}: ${raw.slice(0, 240)}`;
    }
  } catch (e) {
    sendErr = `resend_fetch_failed: ${(e as Error).message?.slice(0, 240) ?? "unknown"}`;
  }

  const nowIso = new Date().toISOString();
  if (sendErr) {
    const { error: updErr } = await admin
      .from("invitations")
      .update({
        send_attempts: ctx.send_attempts + 1,
        last_error:    sendErr,
      })
      .eq("id", ctx.id)
      .eq("send_attempts", ctx.send_attempts);
    if (updErr) {
      return { invitation_id: ctx.id, email: ctx.email, sent: false,
               error: `${sendErr}; state_update_failed: ${updErr.message}` };
    }
    return { invitation_id: ctx.id, email: ctx.email, sent: false, error: sendErr };
  }

  const { error: updErr } = await admin
    .from("invitations")
    .update({
      send_attempts: ctx.send_attempts + 1,
      last_sent_at:  nowIso,
      last_error:    null,
    })
    .eq("id", ctx.id)
    .eq("send_attempts", ctx.send_attempts);
  if (updErr) {
    return { invitation_id: ctx.id, email: ctx.email, sent: true,
             resend_id: resendId, error: `state_update_failed: ${updErr.message}` };
  }

  return { invitation_id: ctx.id, email: ctx.email, sent: true, resend_id: resendId };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });

  let body: any;
  try { body = await req.json(); } catch { return j(400, { error: "invalid_json" }); }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const resendKey = await resolveResendKey(admin);
  if (!resendKey) {
    return j(500, {
      error: "resend_not_configured",
      detail: "No Resend key found in Vault (RESEND_INVITE_API_KEY) or env (RESEND_API_KEY).",
    });
  }

  if (body?.mode === "backfill") {
    const { rows, error } = await fetchInvitationContext(admin, { backfill: true });
    if (error) return j(500, { error: "fetch_failed", detail: error });

    const outcomes: SendOutcome[] = [];
    for (const ctx of rows) {
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(await sendOneInvitation(admin, ctx, resendKey));
    }
    const sent    = outcomes.filter(o => o.sent).length;
    const failed  = outcomes.filter(o => !o.sent && o.error).length;
    const skipped = outcomes.filter(o => !o.sent && o.skipped_reason).length;
    return j(200, {
      mode: "backfill",
      processed: outcomes.length,
      sent, failed, skipped,
      outcomes,
      ran_at: new Date().toISOString(),
    });
  }

  const invitation_id = body?.invitation_id;
  if (!invitation_id || typeof invitation_id !== "string") {
    return j(400, {
      error: "missing_or_invalid_invitation_id",
      hint: "POST { invitation_id: <uuid> } for single send, or { mode: \"backfill\" } for fan-out.",
    });
  }

  const { rows, error } = await fetchInvitationContext(admin, { invitation_id });
  if (error) return j(500, { error: "fetch_failed", detail: error });
  if (rows.length === 0) return j(404, { error: "invitation_not_found", invitation_id });

  const outcome = await sendOneInvitation(admin, rows[0], resendKey);
  const status = outcome.sent ? 200 : (outcome.skipped_reason ? 409 : 502);
  return j(status, { mode: "single", ...outcome });
});
