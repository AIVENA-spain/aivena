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
  bathroomsMin?: number;
  /** Free-text "anything specific you'd love" answer (for the team, not a filter). */
  specifics?: string;
  /** Did the visitor agree to a few qualifying questions? Asked ONCE, politely. */
  qualPermission?: 'granted' | 'declined';
  name?: string;
  email?: string;
  phone?: string;
  /** Volatile context: the listing just shown (newest wins in the RPC merge). */
  lastRef?: string;
};

export type Step = 'intent' | 'permission' | 'location' | 'bedrooms' | 'bathrooms' | 'budget' | 'specifics' | 'type' | 'contact';
/** Buyer funnel (permission-first; ends by SHOWING matches, never a contact wall). */
export const STEP_ORDER: Step[] = ['intent', 'permission', 'location', 'bedrooms', 'bathrooms', 'budget', 'specifics'];

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
  else if (/\b(buy|buying|looking for|just looking|browsing|comprar|busco|(solo )?(estoy )?mirando|ojeando|interested in|rent)\b/i.test(low)) out.intent = 'buyer';

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
  // (bare numbers are resolved to the ASKED step by interpretFunnelAnswer).
  const beds = low.match(/\b([1-9])\s*(?:\+)?\s*(bed|bedroom|dorm|dormitor|hab)\b/i);
  if (beds) out.bedroomsMin = parseInt(beds[1], 10);
  // bathrooms: "2 bath", "2 bathrooms", "2 baños"
  const baths = low.match(/\b([1-9])\s*(?:\+)?\s*(bath|bathroom|ba(ñ|n)o)/i);
  if (baths) out.bathroomsMin = parseInt(baths[1], 10);

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

/** The next thing to ask. Buyer funnel is PERMISSION-FIRST (Christian, 2026-08-12):
 *  intent → may-I-ask? → area → bedrooms → bathrooms → budget → anything-specific →
 *  'matches' (route SHOWS the narrowed cards). Declined permission → 'browse'
 *  (route shows cards immediately, no interrogation). Sellers keep their own path. */
export function nextStep(c: Collected): Step | 'ready' | 'matches' | 'browse' {
  if (c.intent === undefined) return 'intent';
  if (c.intent === 'seller') {
    if (c.location === undefined) return 'location';
    if (c.propertyType === undefined) return 'type';
    if (!c.email && !c.phone) return 'contact';
    return 'ready';
  }
  if (c.qualPermission === undefined) return 'permission';
  if (c.qualPermission === 'declined') return 'browse';
  if (c.location === undefined) return 'location';
  if (c.bedroomsMin === undefined) return 'bedrooms';
  if (c.bathroomsMin === undefined) return 'bathrooms';
  if (c.budgetMax === undefined) return 'budget';
  if (c.specifics === undefined) return 'specifics';
  return 'matches';
}

export function hasContact(c: Collected): boolean {
  return Boolean(c.email || c.phone);
}

type Lang = 'en' | 'es';
type CopyKey = Step | 'ready' | 'matches' | 'browse' | 'deflect' | 'greeting' | 'property_defer' | 'human_defer'
  | 'area_bridge' | 'location_seller' | 'type_seller' | 'contact_seller' | 'ready_seller';
const LANG: Record<Lang, Record<CopyKey, string>> = {
  en: {
    // Warm local agent voice — inviting, never a form.
    greeting: "Hi, welcome! I'm Amanda — I'd love to help you find the right place on the Costa Blanca. What are you looking for, or would you like me to show you a few of our properties?",
    intent: "Lovely to meet you! Are you looking to buy, thinking of selling, or just having a look around?",
    permission: "Wonderful! To find you the best matches, may I ask a few quick questions — bedrooms, budget, that kind of thing? Or I can simply show you some properties now.",
    location: "Great — which area or town are you drawn to?",
    bedrooms: "Got it. How many bedrooms would you ideally like?",
    bathrooms: "And how many bathrooms would suit you?",
    budget: "Perfect. Roughly what budget are you working with?",
    specifics: "Nearly there — is there anything specific you'd love? A pool, sea views, a garden… anything at all.",
    type: "And what kind of place feels right — an apartment, a villa, a townhouse?",
    contact: "Wonderful — what's the best WhatsApp number or email so the team can send you the best matches?",
    ready: "Perfect, thank you! The team will be in touch very soon with places I think you'll love.",
    matches: "Perfect, thank you! Here's what I'd pick for you — take a look, and ask me anything about any of them.",
    browse: "Of course! Here are a few lovely ones to browse — or just tell me what you fancy and I'll narrow it down.",
    deflect: "Sorry, I didn't quite catch that — but I'm here to help! Ask me anything about our properties or the area, or just tell me what you have in mind.",
    // Warm bridge when an area/general answer couldn't be produced this moment —
    // acknowledges the question so it never reads as a cold restart.
    area_bridge: "I'd love to help you get a feel for the area! While I gather my thoughts on that — are you looking to buy, or just exploring the coast for now?",
    // Used only when a question genuinely needs a person (legal/tax/etc.).
    property_defer: "Good question — that one's best for the team, who'll give you the full picture. If you'd like, leave your WhatsApp number or email and they'll get straight back to you.",
    location_seller: "Happy to help you with that — whereabouts is the property you're thinking of selling?",
    type_seller: "And what kind of property is it — an apartment, a villa, a townhouse?",
    contact_seller: "Thank you! Leave your WhatsApp number or email and the team will get back to you about a valuation.",
    ready_seller: "Perfect, thank you! The team will be in touch soon about your property.",
    human_defer: "Of course — leave me your WhatsApp number or email and the team will get back to you as soon as they can. And I'm right here if you'd like to keep chatting in the meantime.",
  },
  es: {
    greeting: "¡Hola, bienvenido/a! Soy Amanda y estaré encantada de ayudarle a encontrar su sitio en la Costa Blanca. ¿Qué está buscando, o prefiere que le enseñe algunas de nuestras propiedades?",
    intent: "¡Un placer! ¿Busca comprar, está pensando en vender, o solo está mirando?",
    permission: "¡Estupendo! Para encontrarle lo que mejor le encaje, ¿puedo hacerle unas preguntas rápidas — dormitorios, presupuesto y poco más? O si lo prefiere, le enseño algunas propiedades ya.",
    location: "Genial — ¿qué zona o pueblo le atrae?",
    bedrooms: "Entendido. ¿Cuántos dormitorios le gustaría idealmente?",
    bathrooms: "¿Y cuántos baños le vendrían bien?",
    budget: "Perfecto. ¿Con qué presupuesto está trabajando, más o menos?",
    specifics: "Ya casi — ¿hay algo especial que le encantaría? Piscina, vistas al mar, jardín… lo que sea.",
    type: "¿Y qué tipo de vivienda le encaja — un apartamento, una villa, un adosado?",
    contact: "Estupendo — ¿cuál es el mejor WhatsApp o email para que el equipo le envíe las mejores opciones?",
    ready: "¡Perfecto, gracias! El equipo le contactará muy pronto con lugares que creo que le encantarán.",
    matches: "¡Perfecto, gracias! Esto es lo que yo le enseñaría — eche un vistazo y pregúnteme lo que quiera.",
    browse: "¡Claro! Aquí tiene algunas para ir mirando — o dígame qué le apetece y se lo afino.",
    deflect: "Perdone, no le he entendido bien — ¡pero estoy aquí para ayudar! Pregúnteme lo que quiera sobre nuestras propiedades o la zona, o dígame qué tiene en mente.",
    area_bridge: "¡Me encantaría ayudarle a hacerse una idea de la zona! Mientras lo preparo — ¿está buscando comprar, o de momento solo explorando la costa?",
    property_defer: "Buena pregunta — esa la ve mejor el equipo, que le dará todos los detalles. Si quiere, déjeme su WhatsApp o email y le responderán enseguida.",
    location_seller: "Encantada de ayudarle — ¿dónde está la propiedad que quiere vender?",
    type_seller: "¿Y qué tipo de propiedad es — un apartamento, una villa, un adosado?",
    contact_seller: "¡Gracias! Déjeme su WhatsApp o email y el equipo le contactará sobre la valoración.",
    ready_seller: "¡Perfecto, gracias! El equipo le contactará pronto sobre su propiedad.",
    human_defer: "Por supuesto — déjeme su número de WhatsApp o email y el equipo le responderá lo antes posible. Y sigo aquí por si quiere seguir charlando mientras tanto.",
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
// TEAM = genuinely legal / tax / financial / rental topics only. Pure AREA topics
// (safe, crime, schools, hospitals, healthcare, utilities) were REMOVED 2026-08-12:
// they are exactly what the web-searching area agent answers well — deflecting them
// to the team made real area questions ("is X safe to buy?") a dead end.
const TEAM_TOPIC_RE = /\b(nie|foreigners?|extranjeros?|tax(es)?|impuestos?|mortgages?|hipotecas?|lawyers?|abogad\w*|notar\w*|visas?|residenc\w*|golden visa|yields?|paperwork|process of buying|how long does|insurance|seguros?|community fees|ibi|for rent|to rent|rent out|rentals?|long[- ]term|alquiler\w*)\b/i;
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
export type MessageType = 'prompt' | 'ready' | 'matches' | 'browse' | 'deflect' | 'property_defer' | 'human_defer';

export type AdvanceResult = {
  collected: Collected;
  reply: string;
  step: Step | 'ready' | 'matches' | 'browse';
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
): { reply: string; step: Step | 'ready' | 'matches' | 'browse'; readyToCapture: boolean; messageType: MessageType } {
  const step = nextStep(collected);
  const seller = collected.intent === 'seller';
  if (step === 'ready') {
    return { reply: replyFor(seller ? 'ready_seller' : 'ready', lang), step, readyToCapture: true, messageType: 'ready' };
  }
  // Funnel complete (or permission declined) → the route SHOWS property cards.
  if (step === 'matches') return { reply: replyFor('matches', lang), step, readyToCapture: false, messageType: 'matches' };
  if (step === 'browse') return { reply: replyFor('browse', lang), step, readyToCapture: false, messageType: 'browse' };
  const someProgress = Object.values(collected).some((v) => v !== undefined);
  // At the permission step an unclear answer re-asks the question, never deflects.
  if (addedNothing && step !== 'contact' && step !== 'permission' && someProgress) {
    return { reply: replyFor('deflect', lang), step, readyToCapture: false, messageType: 'deflect' };
  }
  const key = seller && (step === 'location' || step === 'type' || step === 'contact')
    ? (`${step}_seller` as CopyKey) : step;
  return { reply: replyFor(key, lang), step, readyToCapture: hasContact(collected), messageType: 'prompt' };
}

const YES_RE = /\b(yes|yeah|yep|sure|ok(ay)?|of course|go ahead|sounds good|why not|fine|si|s(í|i) claro|claro|vale|por supuesto|adelante)\b/i;
const NO_RE = /\b(no|nope|nah|rather not|not now|just show|skip|prefiero no|mejor no|ens(é|e)ñame)\b/i;
const NOTHING_RE = /^(no|nope|nothing|nothing special|not really|that's all|thats all|im good|i'm good|nada|nada m(á|a)s|eso es todo)\.?$/i;

/**
 * Pure: interpret this turn's message IN THE CONTEXT of the question just asked —
 * things a context-free parser can't resolve. Returns extra Collected facts:
 *   permission: yes/no (criteria in the answer imply yes); bedrooms/bathrooms: a
 *   bare number answers the ASKED room question; specifics: the text IS the answer
 *   ('none' when they say nothing special).
 */
export function interpretFunnelAnswer(
  stepBefore: Step | 'ready' | 'matches' | 'browse',
  message: string,
  patch: Partial<Collected>,
): Partial<Collected> {
  const out: Partial<Collected> = {};
  const m = (message || '').trim();
  if (stepBefore === 'permission') {
    const hasCriteria = patch.location !== undefined || patch.bedroomsMin !== undefined
      || patch.bathroomsMin !== undefined || patch.budgetMax !== undefined || patch.propertyType !== undefined;
    if (hasCriteria || YES_RE.test(m)) out.qualPermission = 'granted';
    else if (NO_RE.test(m)) out.qualPermission = 'declined';
  } else if (stepBefore === 'bedrooms' && /^[1-9]\+?$/.test(m)) {
    out.bedroomsMin = parseInt(m, 10);
  } else if (stepBefore === 'bathrooms' && /^[1-9]\+?$/.test(m)) {
    out.bathroomsMin = parseInt(m, 10);
  } else if (stepBefore === 'specifics' && m) {
    out.specifics = NOTHING_RE.test(m) ? 'none' : m.slice(0, 200);
  }
  return out;
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
