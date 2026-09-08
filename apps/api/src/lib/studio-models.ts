/**
 * WHICH MODEL DOES WHICH JOB — asked for by role, never by name.
 *
 * Every call site used to name `claude-sonnet-5` itself, so "what would it cost to move fact
 * extraction to a cheaper model?" could only be answered by editing the engine. A role is a
 * question about the WORK ("extract facts off this page"), not about the vendor, and the mapping
 * from role to model is configuration.
 *
 * That buys three things: one place to see what the engine is paying for, the ability to A/B a
 * single role without touching content logic, and a migration that is a config change rather than
 * a refactor. Christian, 2026-09-08: "Call sites should request roles rather than hard-coding a
 * provider/model."
 *
 * Pure of the env module on purpose — it reads process.env directly, so a test can exercise the
 * whole mapping with no variables set.
 */

/**
 * The jobs the Studio engine actually asks a model to do.
 *
 * Split by what would happen if the answer were poor, because that is what decides whether a role
 * can ever move to a cheaper model. A weak WRITER is visible to the reader; a weak FACT_EXTRACTOR
 * is caught by span verification; a weak HIGH_RISK_ADJUDICATOR is how something untrue publishes.
 */
export const ROLES = [
  /** the carousel itself — the reader sees this */
  'WRITER',
  /** the skeptical second read for sense, value and plain English */
  'EDITOR',
  /** deciding what a topic needs researched, and reading the pages */
  'RESEARCH_PLANNER',
  /** turning an opened page into anchored facts */
  'FACT_EXTRACTOR',
  /** turning finished copy into structured claims */
  'CLAIM_EXTRACTOR',
  /** what kind of claim this is, and how hard it has to be verified */
  'CLAIM_CLASSIFIER',
  /** matching a claim to the evidence that supports it */
  'EVIDENCE_MATCHER',
  /** does the deck answer the promise its cover made */
  'INTENT_CHECKER',
  /** which verified bank card, if any, governs this topic */
  'CARD_MATCHER',
  /** does finished copy contradict a verified guardrail */
  'BANK_CHECKER',
  /** the last word on an ambiguous high-risk claim */
  'HIGH_RISK_ADJUDICATOR',
] as const;

export type Role = typeof ROLES[number];

/**
 * What each role runs on today.
 *
 * Everything is Sonnet 5 right now, deliberately: this commit changes WHERE the decision lives, not
 * WHAT it decides, so nothing about output can shift underneath it. Moving a role is then a
 * measured, reversible experiment instead of a rewrite.
 */
export const DEFAULT_MODELS: Readonly<Record<Role, string>> = {
  WRITER: 'claude-sonnet-5',
  EDITOR: 'claude-sonnet-5',
  RESEARCH_PLANNER: 'claude-sonnet-5',
  FACT_EXTRACTOR: 'claude-sonnet-5',
  CLAIM_EXTRACTOR: 'claude-sonnet-5',
  CLAIM_CLASSIFIER: 'claude-sonnet-5',
  EVIDENCE_MATCHER: 'claude-sonnet-5',
  INTENT_CHECKER: 'claude-sonnet-5',
  CARD_MATCHER: 'claude-sonnet-5',
  BANK_CHECKER: 'claude-sonnet-5',
  HIGH_RISK_ADJUDICATOR: 'claude-sonnet-5',
};

/**
 * Roles whose output a reader reads, or whose mistake publishes something untrue.
 *
 * Not a lock — a deliberate override still works — but moving one of these off the strong model is
 * a product decision, and `roleOverrides()` reports it so the change cannot happen quietly.
 */
export const CUSTOMER_FACING: readonly Role[] = ['WRITER', 'EDITOR', 'HIGH_RISK_ADJUDICATOR'];

const ENV_PREFIX = 'STUDIO_MODEL_';

/** The environment variable that overrides one role, e.g. STUDIO_MODEL_FACT_EXTRACTOR. */
export const envKeyFor = (role: Role): string => `${ENV_PREFIX}${role}`;

/**
 * The model this role should use.
 *
 * An unset or blank override falls back to the default, so a half-configured environment runs the
 * engine it ran yesterday rather than failing or silently picking something else.
 */
export function modelFor(role: Role, env: Record<string, string | undefined> = process.env): string {
  const override = env[envKeyFor(role)]?.trim();
  return override || DEFAULT_MODELS[role];
}

/** Every role that is not on its default model, so a running engine can say what it is actually using. */
export function roleOverrides(
  env: Record<string, string | undefined> = process.env,
): Array<{ role: Role; model: string; customerFacing: boolean }> {
  return ROLES
    .filter((r) => modelFor(r, env) !== DEFAULT_MODELS[r])
    .map((r) => ({ role: r, model: modelFor(r, env), customerFacing: CUSTOMER_FACING.includes(r) }));
}

/** One line for the log at startup — silence would make an override impossible to notice. */
export function describeRouting(env: Record<string, string | undefined> = process.env): string {
  const over = roleOverrides(env);
  if (!over.length) return '[studio/models] every role on its default model';
  return `[studio/models] ${over.length} role(s) overridden: `
    + over.map((o) => `${o.role}→${o.model}${o.customerFacing ? ' (CUSTOMER-FACING)' : ''}`).join(', ');
}
