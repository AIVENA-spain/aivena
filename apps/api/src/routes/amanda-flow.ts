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

/** Town list baked from the live area_zone_alias + area_zone_city reference tables
 *  (2026-08-11) plus common Costa Blanca extras. Matched longest-first so
 *  "guardamar del segura" wins over "guardamar". */
const TOWNS = [
  'acequion', 'agua marina', 'aguamarina', 'aguas nuevas', 'benijofar', 'blue lagoon',
  'cabo roig', 'campoamor', 'cinuelica', 'ciudad quesada', 'dehesa de campoamor',
  'dona pepa', 'el chaparral', 'el mojon', 'el moncayo', 'el raso', 'els secans',
  'formentera del segura', 'guardamar del segura', 'guardamar', 'la florida',
  'la herrada', 'la marina', 'la marquesa golf', 'la mata', 'la regia', 'la siesta',
  'la zenia', 'las filipinas', 'las higuericas', 'las ramblas', 'lo pepin', 'lo romero',
  'lomas de cabo roig', 'los altos', 'los balcones', 'los dolses', 'los locos',
  'los naufragos', 'mil palmeras', 'montemar', 'montezenia', 'nueva torrevieja',
  'orihuela costa', 'orihuela', 'pilar de la horadada', 'pinar de campoverde',
  'playa del cura', 'playa flamenca', 'playa de los locos', 'playa los locos',
  'playa los naufragos', 'punta prima', 'quesada', 'rojales', 'san luis',
  'san miguel de salinas', 'san miguel', 'torre de la horadada', 'torre horadada',
  'torreblanca', 'torrevieja', 'villamartin',
  'alicante', 'benidorm', 'javea', 'moraira', 'calpe', 'denia', 'altea', 'albir',
  'marbella', 'estepona', 'mijas', 'fuengirola', 'san javier', 'murcia', 'cartagena',
];
const TOWNS_SORTED = [...TOWNS].sort((a, b) => b.length - a.length);
const TYPES: Array<[RegExp, string]> = [
  [/\b(apartments?|pisos?|flats?|apartamentos?|wohnung(en)?|appartements?|leilighet(er)?|l(ä|a)genhet(er)?)\b/i, 'apartment'],
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
  if (/\b(sell|selling|vender|vendo|venta|list my|valuation|valoraci(o|ó)n|tasaci(o|ó)n|value my|worth)\b/i.test(low)) out.intent = 'seller';
  else if (/\b(buy|buying|looking for|comprar|busco|interested in|rent)\b/i.test(low)) out.intent = 'buyer';

  // budget: "€350k", "350k", "350000", "350.000", "500 000", "up to 400"
  // A detected phone number is stripped first so "+34 600 111 222" can never be
  // read as a budget; then space/dot/comma thousands separators are collapsed.
  const phoneRaw = m.replace(m.match(EMAIL_RE)?.[0] ?? '', '').match(PHONE_RE)?.[0] ?? '';
  // Only strip a GENUINE phone ('+' prefix or >=9 digits) — "300.000" / "1 200 000"
  // are prices, not phones (the <=100M cap below backstops anything weird).
  const phoneSpan = phoneRaw && (/^\s*\+/.test(phoneRaw) || phoneRaw.replace(/\D/g, '').length >= 9) ? phoneRaw : '';
  const forBudget = (phoneSpan ? low.replace(phoneSpan.toLowerCase(), ' ') : low)
    .replace(/(\d)[ .,](?=\d{3}(?:\D|$))/g, '$1');
  // "between 100k and 200k" → the UPPER bound is the cap; "over / at least /
  // minimum 300k" states a FLOOR — never misread it as a cap (no filter is better
  // than a wrong one); "1.5 million" works too.
  const applyBudget = (numStr: string, mult: string | undefined) => {
    let n = parseFloat(numStr.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (mult) {
      const mm = mult.toLowerCase();
      if (/^mill/.test(mm) || mm === 'm') n *= 1_000_000;
      else if (mm === 'k' || mm === 'mil') n *= 1000;
    }
    if (Number.isFinite(n) && n >= 1000 && n <= 100_000_000) out.budgetMax = Math.round(n);
  };
  const between = forBudget.match(/between\s+[0-9][0-9.,]*\s*(?:k|mil)?\s+and\s+([0-9][0-9.,]*)\s*(million(?:es)?|mill(?:ó|o)ne?s?|mil|k|m\b|000)?/i);
  const floorOnly = /\b(over|above|more than|at least|min(?:imum)?|desde|a partir de|m(?:á|a)s de)\b\s*(€|eur)?\s*[0-9]/i.test(forBudget);
  if (between) {
    applyBudget(between[1], between[2]);
  } else if (!floorOnly) {
    const budget = forBudget.match(/(?:€|eur|up to|hasta|budget|presupuesto)?\s*([0-9][0-9.,]{2,}|[0-9](?:\.[0-9])?(?=\s*mill))\s*(million(?:es)?|mill(?:ó|o)ne?s?|mil|k|m\b|000)?/i);
    if (budget) applyBudget(budget[1], budget[2]);
  }

  // bedrooms: "2 bed", "2 bedrooms", "2 dormitorios", "2 hab" — and a BARE "3"
  // (the natural answer to "How many bedrooms?"; the funnel has no other 1-9 ask).
  const beds = low.match(/\b([1-9])\s*(?:\+)?\s*(bed|bedroom|dorm|dormitor|hab)\b/i);
  if (beds) out.bedroomsMin = parseInt(beds[1], 10);
  else if (/^[1-9]\+?$/.test(low.trim())) out.bedroomsMin = parseInt(low.trim(), 10);

  // property type
  for (const [re, t] of TYPES) if (re.test(low)) { out.propertyType = t; break; }

  // location (first matching seed town)
  for (const town of TOWNS_SORTED) if (low.includes(town)) { out.location = town.replace(/\b\w/g, (c) => c.toUpperCase()); break; }

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
  if (c.intent === 'seller') {
    // A seller is telling us about THEIR property — budget/bedroom questions
    // would be nonsense. Location → type → contact.
    if (c.propertyType === undefined) return 'type';
    if (!c.email && !c.phone) return 'contact';
    return 'ready';
  }
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
type CopyKey = Step | 'ready' | 'deflect' | 'greeting' | 'property_defer' | 'human_defer'
  | 'location_seller' | 'type_seller' | 'contact_seller' | 'ready_seller';
const LANG: Record<Lang, Record<CopyKey, string>> = {
  en: {
    // ANSWER-FIRST: warm, honest, invites a real question. No live-agent promise.
    greeting: "Hi! Ask me anything about our properties or the area — or just tell me what you're looking for.",
    intent: 'Are you looking to buy, or to sell?',
    location: 'Which area are you interested in?',
    budget: "What's your budget (roughly)?",
    bedrooms: 'How many bedrooms do you need?',
    type: 'What type of property — apartment, villa, townhouse?',
    contact: 'Great — what\'s the best email or phone number for an agent to reach you?',
    ready: "Perfect, thank you! An agent will be in touch shortly to help with your search.",
    deflect: "Sorry — I didn't quite catch that. Ask me about any of our properties or areas, or just tell me what you're looking for.",
    // Used only when the catalogue genuinely can't answer: honest, offers (not
    // demands) the team's follow-up.
    property_defer: "Good question — that's one for the team. If you'd like, leave your WhatsApp number or email and they'll get back to you.",
    location_seller: "Happy to help with that — where is the property you're thinking of selling?",
    type_seller: 'And what type of property is it — apartment, villa, townhouse?',
    contact_seller: "Thanks! Leave your WhatsApp number or email and the team will get back to you about a valuation.",
    ready_seller: 'Perfect, thank you! The team will be in touch about your property soon.',
    human_defer: "Of course — leave me your WhatsApp number (or email) and the team will get back to you as soon as they can. You're welcome to keep asking me things in the meantime.",
  },
  es: {
    greeting: '¡Hola! Pregúnteme lo que quiera sobre nuestras propiedades o la zona — o dígame qué está buscando.',
    intent: '¿Busca comprar o vender?',
    location: '¿Qué zona le interesa?',
    budget: '¿Cuál es su presupuesto (aproximado)?',
    bedrooms: '¿Cuántos dormitorios necesita?',
    type: '¿Qué tipo de propiedad — apartamento, villa, adosado?',
    contact: 'Genial — ¿cuál es el mejor email o teléfono para que un agente le contacte?',
    ready: '¡Perfecto, gracias! Un agente le contactará en breve para ayudarle con su búsqueda.',
    deflect: 'Perdone — no le he entendido bien. Pregúnteme por cualquiera de nuestras propiedades o zonas, o dígame qué está buscando.',
    property_defer: 'Buena pregunta — eso es para el equipo. Si quiere, déjeme su WhatsApp o email y le responderán.',
    location_seller: 'Encantada de ayudarle — ¿dónde está la propiedad que quiere vender?',
    type_seller: '¿Y qué tipo de propiedad es — apartamento, villa, adosado?',
    contact_seller: 'Gracias. Déjeme su WhatsApp o email y el equipo le contactará sobre la valoración.',
    ready_seller: '¡Perfecto, gracias! El equipo le contactará pronto sobre su propiedad.',
    human_defer: 'Por supuesto — déjeme su número de WhatsApp (o email) y el equipo le responderá lo antes posible. Mientras tanto, puede seguir preguntándome lo que quiera.',
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
export type Intent = 'qualify' | 'property_question' | 'human_request' | 'team_question';
const HUMAN_RE = /\b(human|real person|speak to (someone|a person|an agent)|talk to (someone|a person|an agent)|call me|agent please)\b/i;
const PROPERTY_Q_RE = /\b(do you have|are there|(any|some) (propert|home|villa|apartment|flat|house)|rec+om+end|suggest|recomiende?|sugiere?|propert(y|ies) (in|near|around|available)|how much|price of|what.?s the price|cost of|available|availability|listing|ref(erence)?\s*#?\s*\w|more (info|details|photos|pictures)|can i see|show me|square met|m2|garden|pool)\b/i;
// ANSWER-FIRST (Christian, 2026-08-11): referring back to a listing ("the one in…",
// "that villa", "more about", "pictures/photos", "how do I find it") is a property
// question — answer it, never fall into a contact-grabbing deflect.
const PROPERTY_REF_RE = /\b(the ones? (in|at|near|with|on)|that (propert|listing|apartment|villa|house|flat|one)|(tell me|more) about|pictures?|photos?|see (it|them)|view details|how (do|can) i (find|see|view))\b/i;
// A listing-reference token (letters-dash-digits, e.g. mch-011) is ALWAYS a
// property question, whatever the phrasing.
const REF_LIKE_RE = /\b[A-Za-z][A-Za-z0-9]{1,5}-[A-Za-z0-9]*\d[A-Za-z0-9]*\b/;
// Search-y phrasings the criteria counter alone misses ("im looking for a cheap
// apartment", "apartments near the beach", "got any bargains?", "cheapest…").
const SEARCH_HINT_RE = /\b((i'?m|we'?re|im)?\s*(looking|searching) for|we (want|need)|i (want|need) (a|an|some)|(something|anything) (in|near|around|under|below|for|up to|over|cheap)|got any|(you have|have you got) (any|some|a |an |villas|apartments|flats|houses|propert)|cheapest|most expensive|barat[oa]|(villas?|apartments?|flats?|houses?|penthouses?|townhouses?|propert(y|ies)|homes?|pisos?)\s+(near|by|close to|with|in|on|under|over|from|between|for sale)|beachfront|seafront|sea ?views?|first ?line|frontline)\b/i;
// Viewing phrasings must also route into the property branch (where the viewing
// capture lives): "I'd like to view MCH-003", "can we visit the villa saturday?".
const VIEWING_HINT_RE = /\b(viewing|book a visit|arrange a visit|(would like|like|want|love) to (view|visit|see)|can (i|we) (view|visit)|visit (the|it|your|on|this)|come and see|visita)\b/i;
// Honest boundary: topics the catalogue can NEVER answer (legal / tax / mortgage /
// area-life / rentals) go straight to the team — never a nonsense listing search.
const TEAM_TOPIC_RE = /\b(nie|foreigners?|extranjeros?|tax(es)?|impuestos?|mortgages?|hipotecas?|lawyers?|abogad\w*|notar\w*|schools?|colegios?|escuelas?|hospitals?|healthcare|sanidad|visas?|residenc\w*|golden visa|yields?|paperwork|process of buying|how long does|safe|crime|insurance|seguros?|utilities|community fees|ibi|for rent|to rent|rent out|rentals?|long[- ]term|alquiler\w*)\b/i;
const SELLER_RE = /\b(sell(ing)?|vender|vendo|list my|valuation|valoraci(o|ó)n|tasaci(o|ó)n|value my|worth)\b/i;

/**
 * ANSWER-FIRST doctrine: a message that simply STATES criteria ("2-bed apartment
 * in Torrevieja under 200k") deserves listings, not a questionnaire. Two or more
 * parsed criteria = treat it as a search; a single one-word funnel answer
 * ("Torrevieja") still advances the qualify flow naturally.
 */
function statesSearchCriteria(message: string): boolean {
  const p = parseMessage(message);
  const n = [p.location, p.propertyType, p.budgetMax, p.bedroomsMin].filter((v) => v !== undefined).length;
  return n >= 2;
}

export function classifyIntent(message: string): Intent {
  if (typeof message !== 'string' || !message.trim()) return 'qualify';
  const m = message.toLowerCase();
  if (HUMAN_RE.test(m)) return 'human_request';
  if (TEAM_TOPIC_RE.test(m)) return 'team_question';
  if (SELLER_RE.test(m)) return 'qualify';   // seller funnel (seller-aware questions)
  if (PROPERTY_Q_RE.test(m) || PROPERTY_REF_RE.test(m) || REF_LIKE_RE.test(message)
      || SEARCH_HINT_RE.test(m) || VIEWING_HINT_RE.test(m) || statesSearchCriteria(m)) {
    return 'property_question';
  }
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
  const seller = collected.intent === 'seller';
  if (step === 'ready') {
    return { reply: replyFor(seller ? 'ready_seller' : 'ready', lang), step, readyToCapture: true, messageType: 'ready' };
  }
  const someProgress = Object.values(collected).some((v) => v !== undefined);
  if (addedNothing && step !== 'contact' && someProgress) {
    return { reply: replyFor('deflect', lang), step, readyToCapture: false, messageType: 'deflect' };
  }
  const key = seller && (step === 'location' || step === 'type' || step === 'contact')
    ? (`${step}_seller` as CopyKey) : step;
  return { reply: replyFor(key, lang), step, readyToCapture: hasContact(collected), messageType: 'prompt' };
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
  if (intent === 'property_question' || intent === 'team_question') {
    return { reply: replyFor('property_defer', lang), messageType: 'property_defer', readyToCapture: have, awaitingContact: !have };
  }
  const r = replyForCollected(collected, addedNothing, lang);
  // The widget reveals the contact card (notice + unticked consent checkbox) when
  // Amanda is asking for contact and we don't have it yet.
  // Deflect is a helpful re-prompt, not a contact ask — only the natural end of
  // the funnel reveals the contact card (answer-first doctrine).
  const awaitingContact = !have && r.step === 'contact';
  return { reply: r.reply, messageType: r.messageType, readyToCapture: r.readyToCapture, awaitingContact };
}
