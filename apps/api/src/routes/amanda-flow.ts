/**
 * Amanda slice 2 — PURE deterministic rules engine (Packet 2 build-prep).
 *
 * NO LLM, NO network, NO DB. Given the qualification gathered so far + the
 * visitor's latest message, it parses light structured facts, decides the next
 * question, and returns canned copy. The route/RPC layer (a separate, gated
 * step) persists to chat_sessions/chat_messages and, once contact is present,
 * calls the existing amanda_capture_lead. Unit-testable in isolation.
 *
 * Copy ships for `en` + `es` here with an `en` fallback; the remaining pilot
 * languages plug into LANG from the existing message catalog when wired (not
 * faked to 13 here).
 */

export type Collected = {
  intent?: 'buyer' | 'seller';
  location?: string;
  budgetMax?: number;
  bedroomsMin?: number;
  propertyType?: string;
  name?: string;
  email?: string;
  phone?: string;
};

export type Step = 'intent' | 'location' | 'budget' | 'bedrooms' | 'type' | 'contact';
/** Qualification asked before contact; contact is always last. */
export const STEP_ORDER: Step[] = ['intent', 'location', 'budget', 'bedrooms', 'type', 'contact'];

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /\+?[0-9][0-9 ().-]{6,19}/;

/** Small seed town list (the real build reuses properties/town-aliases). */
const TOWNS = [
  'torrevieja', 'orihuela', 'guardamar', 'la mata', 'punta prima', 'villamartin',
  'alicante', 'benidorm', 'javea', 'moraira', 'calpe', 'denia', 'altea', 'marbella',
  'estepona', 'mijas', 'fuengirola', 'san javier', 'murcia', 'cartagena',
];
const TYPES: Array<[RegExp, string]> = [
  [/\b(apartment|piso|flat|apartamento)\b/i, 'apartment'],
  [/\b(villa|chalet|detached)\b/i, 'villa'],
  [/\b(townhouse|bungalow|adosad|quad)\b/i, 'townhouse'],
  [/\b(penthouse|ático|atico)\b/i, 'penthouse'],
  [/\b(plot|land|terreno)\b/i, 'plot'],
];

/** Parse light structured facts from a free-text message (deterministic). */
export function parseMessage(message: string): Partial<Collected> {
  const out: Partial<Collected> = {};
  if (typeof message !== 'string' || !message.trim()) return out;
  const m = message.trim();
  const low = m.toLowerCase();

  // intent
  if (/\b(sell|selling|vender|venta|list my|valuation|tasación|tasacion)\b/i.test(low)) out.intent = 'seller';
  else if (/\b(buy|buying|looking for|comprar|busco|interested in|rent)\b/i.test(low)) out.intent = 'buyer';

  // budget: "€350k", "350k", "350000", "350.000", "up to 400"
  const budget = low.match(/(?:€|eur|up to|hasta|budget|presupuesto)?\s*([0-9][0-9.,]{2,})\s*(k|mil|000)?/i);
  if (budget) {
    let n = parseFloat(budget[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (budget[2] && /k|mil/i.test(budget[2])) n *= 1000;
    if (Number.isFinite(n) && n >= 1000) out.budgetMax = Math.round(n);
  }

  // bedrooms: "2 bed", "2 bedrooms", "2 dormitorios", "2 hab"
  const beds = low.match(/\b([1-9])\s*(?:\+)?\s*(bed|bedroom|dorm|dormitor|hab)\b/i);
  if (beds) out.bedroomsMin = parseInt(beds[1], 10);

  // property type
  for (const [re, t] of TYPES) if (re.test(low)) { out.propertyType = t; break; }

  // location (first matching seed town)
  for (const town of TOWNS) if (low.includes(town)) { out.location = town.replace(/\b\w/g, (c) => c.toUpperCase()); break; }

  // contact
  const email = m.match(EMAIL_RE);
  if (email) out.email = email[0];
  const phone = m.replace(email?.[0] ?? '', '').match(PHONE_RE);
  if (phone && phone[0].replace(/\D/g, '').length >= 7) out.phone = phone[0].trim();

  return out;
}

/** Merge a parse result into the running collected set (never overwrites a set field). */
export function mergeCollected(prev: Collected, patch: Partial<Collected>): Collected {
  const out: Collected = { ...prev };
  for (const k of Object.keys(patch) as Array<keyof Collected>) {
    if (out[k] === undefined && patch[k] !== undefined) (out as Record<string, unknown>)[k] = patch[k];
  }
  return out;
}

/** The next thing to ask: the first missing qualification, then contact. */
export function nextStep(c: Collected): Step | 'ready' {
  if (c.intent === undefined) return 'intent';
  if (c.location === undefined) return 'location';
  if (c.budgetMax === undefined) return 'budget';
  if (c.bedroomsMin === undefined) return 'bedrooms';
  if (c.propertyType === undefined) return 'type';
  if (!c.email && !c.phone) return 'contact';
  return 'ready';
}

export function hasContact(c: Collected): boolean {
  return Boolean(c.email || c.phone);
}

type Lang = 'en' | 'es';
type CopyKey = Step | 'ready' | 'deflect' | 'greeting' | 'property_defer' | 'human_defer';
const LANG: Record<Lang, Record<CopyKey, string>> = {
  en: {
    // Phase A is capture-only: Amanda gathers what the visitor is after and
    // connects them to an agent. It does NOT claim to answer property questions
    // or share listing info (that is Phase B, property-aware Q&A — not built).
    greeting: "Hi! To connect you with the right agent, may I ask a couple of quick questions? Are you looking to buy, or to sell?",
    intent: 'Are you looking to buy, or to sell?',
    location: 'Which area are you interested in?',
    budget: "What's your budget (roughly)?",
    bedrooms: 'How many bedrooms do you need?',
    type: 'What type of property — apartment, villa, townhouse?',
    contact: 'Great — what\'s the best email or phone number for an agent to reach you?',
    ready: "Perfect, thank you! An agent will be in touch shortly to help with your search.",
    deflect: "I'll pass that to an agent. Meanwhile, what's the best email or phone to reach you?",
    // Phase A: a property question is NOT answered (no invented facts). Amanda is
    // honest that a team member will follow up, and moves to capturing contact.
    property_defer: "That's a great question — I'll make sure an agent gets back to you on it. What's the best email or phone to reach you?",
    human_defer: "Of course — I'll pass you to the team. What's the best email or phone for them to reach you?",
  },
  es: {
    greeting: '¡Hola! Para conectarle con el agente adecuado, ¿puedo hacerle un par de preguntas rápidas? ¿Busca comprar o vender?',
    intent: '¿Busca comprar o vender?',
    location: '¿Qué zona le interesa?',
    budget: '¿Cuál es su presupuesto (aproximado)?',
    bedrooms: '¿Cuántos dormitorios necesita?',
    type: '¿Qué tipo de propiedad — apartamento, villa, adosado?',
    contact: 'Genial — ¿cuál es el mejor email o teléfono para que un agente le contacte?',
    ready: '¡Perfecto, gracias! Un agente le contactará en breve para ayudarle con su búsqueda.',
    deflect: 'Se lo paso a un agente. Mientras, ¿cuál es el mejor email o teléfono para contactarle?',
    property_defer: 'Muy buena pregunta — me aseguraré de que un agente le responda. ¿Cuál es el mejor email o teléfono para contactarle?',
    human_defer: 'Por supuesto — le paso con el equipo. ¿Cuál es el mejor email o teléfono para que le contacten?',
  },
};
const pickLang = (lang?: string): Lang => (lang === 'es' ? 'es' : 'en');

/** Canned reply for a step (or the ready/deflect/defer states), in en/es with en fallback. */
export function replyFor(key: CopyKey, lang?: string): string {
  return LANG[pickLang(lang)][key];
}

/**
 * Coarse per-turn intent — the forward-compat seam for Phase B. Phase A only acts
 * on 'qualify' (advance the funnel); 'property_question' and 'human_request' both
 * safely defer to an agent + capture contact (NO invented answers). Phase B slots
 * a real property-answer handler onto the 'property_question' branch without
 * touching the qualify flow. Deterministic; human request wins if ambiguous.
 */
export type Intent = 'qualify' | 'property_question' | 'human_request';
const HUMAN_RE = /\b(human|real person|speak to (someone|a person|an agent)|talk to (someone|a person|an agent)|call me|agent please)\b/i;
const PROPERTY_Q_RE = /\b(do you have|are there|any (propert|home|villa|apartment|flat|house)|how much|price of|what.?s the price|cost of|available|availability|listing|ref(erence)?\s*#?\s*\w|more (info|details|photos|pictures)|can i see|show me|square met|m2|garden|pool)\b/i;
export function classifyIntent(message: string): Intent {
  if (typeof message !== 'string' || !message.trim()) return 'qualify';
  const m = message.toLowerCase();
  if (HUMAN_RE.test(m)) return 'human_request';
  if (PROPERTY_Q_RE.test(m)) return 'property_question';
  return 'qualify';
}

/** Message-type tag on Amanda's reply — the extensible envelope Phase B reuses
 *  (e.g. Phase B adds 'property_answer' + an attachments payload). */
export type MessageType = 'prompt' | 'ready' | 'deflect' | 'property_defer' | 'human_defer';

export type AdvanceResult = {
  collected: Collected;
  reply: string;
  step: Step | 'ready';
  readyToCapture: boolean;
  parsed: Partial<Collected>;
};

/**
 * Advance the conversation one turn. Merges parsed facts, computes the next
 * question, and returns the canned reply. `readyToCapture` is true once contact
 * is present (the route then calls amanda_capture_lead, consent permitting).
 * If the message added nothing and we're mid-qualification, deflect (still asks
 * for contact) rather than looping the same question forever.
 */
export function advance(prev: Collected, message: string, lang?: string): AdvanceResult {
  const parsed = parseMessage(message);
  const collected = mergeCollected(prev, parsed);
  const addedNothing = Object.keys(parsed).length === 0;
  const r = replyForCollected(collected, addedNothing, lang);
  return { collected, reply: r.reply, step: r.step, readyToCapture: r.readyToCapture, parsed };
}

/**
 * Compute the reply from an ALREADY-merged collected set. The slice-2 route uses
 * this after the RPC has merged the turn's parsed patch server-side (so it never
 * needs the pre-merge `prev`). `addedNothing` = this turn's parse produced no new
 * facts. Deflect only mid-flow (nothing added AND we've already gathered
 * something); a fresh session just gets asked the first question. Single source
 * of truth — `advance()` calls this too.
 */
export function replyForCollected(
  collected: Collected,
  addedNothing: boolean,
  lang?: string,
): { reply: string; step: Step | 'ready'; readyToCapture: boolean; messageType: MessageType } {
  const step = nextStep(collected);
  if (step === 'ready') return { reply: replyFor('ready', lang), step, readyToCapture: true, messageType: 'ready' };
  const someProgress = Object.values(collected).some((v) => v !== undefined);
  if (addedNothing && step !== 'contact' && someProgress) {
    return { reply: replyFor('deflect', lang), step, readyToCapture: false, messageType: 'deflect' };
  }
  return { reply: replyFor(step, lang), step, readyToCapture: hasContact(collected), messageType: 'prompt' };
}

/**
 * One conversational turn, intent-routed — the single entry the /message route
 * uses. Phase A honours three intents; only 'qualify' advances the funnel. A
 * property question or a human request is NEVER answered with invented facts —
 * Amanda defers to an agent and moves to capturing contact (readyToCapture once
 * contact is present, so the route can hand off to amanda_capture_lead when the
 * visitor has consented). Phase B replaces the 'property_question' branch with a
 * real, catalogue-grounded answer + attachments; nothing else here changes.
 */
export function turnReply(
  collected: Collected,
  addedNothing: boolean,
  intent: Intent,
  lang?: string,
): { reply: string; messageType: MessageType; readyToCapture: boolean; awaitingContact: boolean } {
  const have = hasContact(collected);
  if (intent === 'human_request') {
    return { reply: replyFor('human_defer', lang), messageType: 'human_defer', readyToCapture: have, awaitingContact: !have };
  }
  if (intent === 'property_question') {
    return { reply: replyFor('property_defer', lang), messageType: 'property_defer', readyToCapture: have, awaitingContact: !have };
  }
  const r = replyForCollected(collected, addedNothing, lang);
  // The widget reveals the contact card (notice + unticked consent checkbox) when
  // Amanda is asking for contact and we don't have it yet.
  const awaitingContact = !have && (r.step === 'contact' || r.messageType === 'deflect');
  return { reply: r.reply, messageType: r.messageType, readyToCapture: r.readyToCapture, awaitingContact };
}
