import fs from "node:fs";
import { abs } from "./paths";

export interface ClaimFinding {
  term: string;
  surface: string;
  lang: string;
  supported: boolean;
  editorially_locked: boolean;
  category: "editorial_claim" | "unverified_subjective_claim";
}

export function loadLexicon(): any {
  return JSON.parse(fs.readFileSync(abs("claims/subjective_lexicon.json"), "utf8"));
}

function evalFactCond(expr: string, facts: any): boolean {
  const m = expr.match(/^([a-z_]+)\s*(>=|<=|=|:)\s*(.+)$/);
  if (!m) return false;
  const [, key, op, val] = m;
  const v = key === "built_sqm" ? facts?.size?.built_sqm : facts?.[key];
  if (v == null) return false;
  if (op === ">=") return Number(v) >= Number(val);
  if (op === "<=") return Number(v) <= Number(val);
  return String(v) === String(val);
}

function isSupported(claim: any, facts: any): boolean {
  for (const cond of claim.supported_by || []) {
    if (cond.startsWith("feature:") && (facts?.features || []).includes(cond.slice(8))) return true;
    if (cond.startsWith("fact:") && evalFactCond(cond.slice(5), facts)) return true;
  }
  return false;
}

// Detect subjective claims in a piece of rendered text, per language, and classify each.
export function detectClaims(text: string, lang: string, facts: any, editorialLocks: any[] = []): ClaimFinding[] {
  const lex = loadLexicon();
  const lower = (text || "").toLowerCase();
  const perLang = lex.per_language_terms?.[lang] || {};
  const findings: ClaimFinding[] = [];
  for (const claim of lex.claims) {
    const canon: string = claim.term;
    const forms = new Set<string>([canon.toLowerCase()]);
    for (const f of perLang[canon] || []) forms.add(String(f).toLowerCase());
    let surface = "";
    for (const f of forms) if (lower.includes(f)) { surface = f; break; }
    if (!surface) continue;
    const supported = isSupported(claim, facts);
    const locked = editorialLocks.some((l) => String(l?.claim || "").toLowerCase() === canon.toLowerCase());
    findings.push({
      term: canon, surface, lang, supported, editorially_locked: locked,
      category: supported || locked ? "editorial_claim" : "unverified_subjective_claim",
    });
  }
  return findings;
}
