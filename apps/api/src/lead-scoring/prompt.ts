/**
 * The fact-extraction instructions. v1.3 was the text proven in the 2026-09-11 practice runs; v1.4 (the same day, after
 * the first Scoring check caught the AI quoting the agency's words as the lead's) numbers every lead message and makes
 * each quote name the one message it comes from. The AI only extracts facts; code (rubric.ts) turns them into a score.
 */
import { leadLabel, leadMessagesOf } from './lead-messages';
import type { ScoringInput } from './types';

export const SYSTEM_PROMPT = `You extract facts from a conversation between a real-estate agency on the Costa Blanca and a lead. The conversation can be in any language. You do NOT score the lead; code does that from your facts.

Rules:
- Use only what the LEAD wrote. Agency messages are context only.
- Never guess. If unsure, choose the weaker option.
- Evidence: "lead_messages" lists every message the lead wrote, numbered L1, L2 and so on; it is the ONLY text you may quote. For every fact you mark (any value other than none, unknown or false), "quote" = up to 3 pieces separated by " | ". Each piece is the number of ONE lead message, a colon, then the lead's exact words from that message, copied character for character in the original language, at most 10 words. Example: "L2: max 350k | L6: Sounds good, see you then". Never join words from different messages into one piece, and never translate. Never quote the agency: its messages, prices, reference numbers and listing details are never evidence, even when the lead agrees to them. When the lead agrees to something the agency proposed, quote the lead's own reply (such as "L6: Sounds good, see you then"), not the proposal. No quote means no fact: leave it at none, unknown or false. Otherwise "quote": null.
- "now" is the moment of scoring. Judge dates against it.

Definitions:
- budget, area and need describe the lead's OWN search. The price, location or features of a listing they ask about are NOT their budget, area or need; that is specific_property. For example, "Is the apartment in Villamartin, ref AB123, still available?" gives area "none" and need "none": the town and the type describe that listing.
- budget: "clear" = an amount or range, including approximate ("around €420,000", "under 500k", "max 420.000"); "vague" = e.g. "not too expensive"; "none".
- area: "clear" = one or more named towns or areas they want; "vague" = only a country or region ("we might move to Spain", "Costa Blanca"); "none".
- need: "clear" = a property type plus a size or key feature, also when asked as a question ("do you have villas with a pool?"); "vague" = only a type; "none".
- real_lead: false only for spam, wrong numbers, suppliers, job seekers, or someone who never wanted to buy, sell or rent. A genuine buyer or seller who bought elsewhere or lost interest is still a real lead: record that under negative.
- intent: "real" if they want to buy, sell or rent; "curious" if vague ("maybe one day", "just looking", "just curious").
- specific_property: "availability_only" = they only asked whether a listing is available; "discussed" = they asked about it or showed interest beyond availability; "none".
- concrete_question: a concrete question about a property or the purchase (parking, distance, costs, process). NOT asking whether it is available, and NOT asking what listings you have.
- asked_for_listings_or_photos: they asked to see options, listings, photos or details, or said yes when offered them.
- timing: "within_30_days" if they want to view or buy within 30 days of now; "later"; "unknown".
- viewing: "wants_to_view" = interest without a date; "requested" = asked for, or accepted, a day or time not yet confirmed by both; "agreed_settled" = a day and time both sides agreed and nothing is pending; "agreed_change_pending" = agreed, then the lead asked to change it and the change is not confirmed; "none". within_7_days: whether the viewing date is within 7 days of now, or null without a date.
- financing_ready: cash buyer, mortgage approved, or funds ready.
- decision, the strongest that applies: "asks_how_to_proceed" (how to offer, reserve, proceed or send documents), "offer_or_negotiation", "agrees_to_reserve_pay_or_documents", "ready_to_close_now", "already_committed" (already reserved, paid a deposit or signed), or "none".
- negative: "not_interested", "bought_elsewhere", "stop_contact" (asks not to be contacted), or "none".

Reply with ONE compact JSON object on a single line, with no code fences and no other text, using exactly these keys. Every value must be one of the options shown:
{"real_lead": true|false, "not_a_lead_reason": null|"spam"|"wrong_number"|"supplier_or_job"|"no_buy_or_sell_intent", "intent": "real"|"curious", "budget": {"state": "clear"|"vague"|"none", "quote": ...}, "area": {"state": "clear"|"vague"|"none", "quote": ...}, "need": {"state": "clear"|"vague"|"none", "quote": ...}, "specific_property": {"state": "none"|"availability_only"|"discussed", "quote": ...}, "concrete_question": {"present": true|false, "quote": ...}, "asked_for_listings_or_photos": {"present": true|false, "quote": ...}, "timing": {"state": "within_30_days"|"later"|"unknown", "quote": ...}, "viewing": {"state": "none"|"wants_to_view"|"requested"|"agreed_settled"|"agreed_change_pending", "within_7_days": true|false|null, "quote": ...}, "financing_ready": {"present": true|false, "quote": ...}, "decision": {"state": "none"|"asks_how_to_proceed"|"offer_or_negotiation"|"agrees_to_reserve_pay_or_documents"|"ready_to_close_now"|"already_committed", "quote": ...}, "negative": {"state": "none"|"not_interested"|"bought_elsewhere"|"stop_contact", "quote": ...}, "reason": "<one sentence, max 25 words, in English>"}`;

/**
 * The model's input: the practice-run shape, plus (v1.4) every lead message numbered, both where it sits in the
 * conversation and as "lead_messages", the one list it may quote from. Agency messages carry no number.
 */
export function buildUserContent(input: ScoringInput): string {
  const earlier = input.earlierLeadMessages ?? [];
  let n = earlier.length;
  return JSON.stringify({
    now: input.now,
    conversation: input.conversation.map((m) => (m.from === 'lead' ? { id: leadLabel(n++), ...m } : m)),
    ...(earlier.length ? { earlier_lead_messages: earlier.map((m, i) => ({ id: leadLabel(i), ...m })) } : {}),
    lead_messages: leadMessagesOf(input).map((text, i) => ({ id: leadLabel(i), text })),
  });
}

/** Long conversations get room for their quotes (practice run 1: a 450-token answer was cut off). */
export function maxOutputTokens(input: ScoringInput): number {
  return buildUserContent(input).length > 4000 ? 900 : 500;
}
