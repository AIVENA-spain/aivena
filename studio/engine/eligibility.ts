import { EditableManifest } from "./renderEditable";

// PRODUCTION ELIGIBILITY GUARD.
// Some templates make a factual claim that depends on the property's STATUS — e.g. "Just Sold" is only true for a
// sold property. The engine/dashboard must NEVER auto-generate such a post for an active listing. This guard is
// the single checkpoint: a status-gated template renders ONLY when the property's status matches, OR when the
// caller passes an explicit demo/test flag (accepted as a template-engine proof, NOT a real claim).

export type EligibilityCtx = { status?: string; demo?: boolean };
export type EligibilityResult = { ok: boolean; demo: boolean; reason: string };

export function checkEligibility(m: EditableManifest, ctx: EligibilityCtx): EligibilityResult {
  const e = (m as any).eligibility as EditableManifest["eligibility"];
  if (!e || !e.requires_status?.length) return { ok: true, demo: false, reason: "no status requirement" };
  const need = e.requires_status.map((s) => s.toLowerCase());
  const status = (ctx.status || "").toLowerCase();
  if (need.includes(status)) return { ok: true, demo: false, reason: `status '${status}' satisfies '${e.post_type}'` };
  if (ctx.demo) return { ok: true, demo: true, reason: `DEMO/TEST render — '${e.post_type}' needs status [${need.join(", ")}] but property is '${status || "unknown"}'. Accepted as template-engine PROOF ONLY, not a real ${e.post_type} claim.` };
  return { ok: false, demo: false, reason: `BLOCKED — '${e.post_type}' requires status [${need.join(", ")}] but property status is '${status || "unknown"}'. ${e.note || ""}` };
}

// Throwing form for call sites that must fail-closed (production render path).
export function assertEligible(m: EditableManifest, ctx: EligibilityCtx): EligibilityResult {
  const r = checkEligibility(m, ctx);
  if (!r.ok) throw new Error(`ELIGIBILITY ${r.reason}`);
  return r;
}
