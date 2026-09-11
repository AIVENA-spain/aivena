/**
 * Lead scoring: shared types (rubric v1.3, approved by Christian 2026-09-11).
 * The AI only extracts FACTS, each backed by the lead's own words; code turns the facts into a score.
 */

export type Speaker = 'lead' | 'agency';
export type ConversationMessage = { at: string; from: Speaker; text: string };
export type EarlierLeadMessage = { at: string; text: string };
export type ScoringInput = {
  /** The moment of scoring; dates in the conversation are judged against it. */
  now: string;
  conversation: ConversationMessage[];
  earlierLeadMessages?: EarlierLeadMessage[];
};

/** One extracted fact. State facts use `state`; yes/no facts use `present`. */
export type Fact = { state?: string; present?: boolean; quote?: string | null; within_7_days?: boolean | null };

/** Facts as the model returns them. evidence.invalidValues() rejects any answer outside the allowed values. */
export type Facts = {
  real_lead?: boolean;
  not_a_lead_reason?: string | null;
  intent?: string | null;
  /** The model's own sentence. Kept for the audit trail only: never shown, never used to score. */
  reason?: string | null;
  budget?: Fact;
  area?: Fact;
  need?: Fact;
  specific_property?: Fact;
  concrete_question?: Fact;
  asked_for_listings_or_photos?: Fact;
  timing?: Fact;
  viewing?: Fact;
  financing_ready?: Fact;
  decision?: Fact;
  negative?: Fact;
};

export type Band =
  | 'not_a_lead'
  | 'very_cold'
  | 'early_interest'
  | 'warm'
  | 'hot'
  | 'super_hot'
  | 'ready_to_act'
  | 'lost'
  | 'deal'
  | 'do_not_contact';

export type Temperature = 'not_a_lead' | 'cold' | 'warm' | 'hot' | 'super_hot' | null;

export type ScoreResult = { score: number | null; band: Band; note?: string };
