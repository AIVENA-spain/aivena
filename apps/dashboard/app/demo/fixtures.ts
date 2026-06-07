/**
 * Static demo fixtures for the public /demo route. Baked from the Vega-seeded
 * demo tenant `demo-costa-homes-pilot01` (realistic names, languages, owned
 * channels, in-language AI-reply text) — NO live DB, NO auth, NO real PII.
 * Owned channels only (whatsapp / website / email / ads) — no property portals.
 * All emails are @example.com; everything here is fictional sample data.
 */

export const DEMO_AGENCY = {
  name: "Mediterráneo Costa Homes",
  initial: "M",
  region: "Costa Blanca",
  plan: "pro" as const,
  url: "app.aivena.es/dashboard",
};

export type Lang = "pl" | "de" | "no" | "sv" | "fr" | "en" | "es";
export const LANG_LABEL: Record<Lang, string> = {
  pl: "Polski", de: "Deutsch", no: "Norsk", sv: "Svenska",
  fr: "Français", en: "English", es: "Español",
};

export type Channel = "whatsapp" | "website" | "email" | "ads";
export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp", website: "Website chat", email: "Email", ads: "Facebook Ads",
};

export type Temp = "super_hot" | "hot" | "warm" | "cold";
export type ConvoState = "needsYou" | "replied" | "autoHandled" | "waiting";

export type DemoMessage = {
  id: string;
  direction: "inbound" | "outbound";
  /** Original text (the buyer's words, or what AIVENA sends). */
  body: string;
  /** Owner-language (English) translation shown side-by-side. Null when same. */
  translated: string | null;
  ago: string;
};

export type DemoLead = {
  id: string;
  name: string;
  type: "buyer" | "seller";
  lang: Lang;
  channel: Channel;
  temp: Temp;
  area: string;
  source: string;
  score: number;
  ago: string;
  state: ConvoState;
  /** AI-drafted reply (original language) for pending suggested_reply leads. */
  draft: string | null;
  /** English gloss of the draft for the side-by-side translation pane. */
  draftTranslated: string | null;
  preview: string;
  thread: DemoMessage[];
};

// ── Inbox: buyers (5 pending in-language drafts + 2 handled) ────────────────

export const DEMO_LEADS: DemoLead[] = [
  {
    id: "ld-kat", name: "Katarzyna Nowak", type: "buyer", lang: "pl", channel: "whatsapp",
    temp: "super_hot", area: "Orihuela Costa", source: "WhatsApp", score: 92, ago: "4m",
    state: "needsYou",
    preview: "Czy to mieszkanie jest jeszcze dostępne?",
    draft: "Dzień dobry Pani Katarzyno! Tak, mieszkanie w Orihuela Costa jest dostępne — cena 198 000 €. Chętnie umówię oglądanie w ten weekend. Pasuje sobota rano?",
    draftTranslated: "Good morning Ms Nowak! Yes, the apartment in Orihuela Costa is available — €198,000. Happy to arrange a viewing this weekend. Does Saturday morning suit you?",
    thread: [
      { id: "m1", direction: "inbound", body: "Dzień dobry, czy mieszkanie z ogłoszenia w Orihuela Costa jest jeszcze dostępne? Jaki jest budżet?", translated: "Good morning, is the apartment from the listing in Orihuela Costa still available? What's the price?", ago: "4m" },
    ],
  },
  {
    id: "ld-hei", name: "Heinrich Müller", type: "buyer", lang: "de", channel: "website",
    temp: "super_hot", area: "Jávea", source: "Website chat", score: 90, ago: "11m",
    state: "needsYou",
    preview: "Ist die Villa in Jávea noch verfügbar?",
    draft: "Guten Tag Herr Müller! Ja, die Villa in Jávea ist noch verfügbar (650 000 €). Ich schicke Ihnen gern die Unterlagen und schlage zwei Besichtigungstermine vor.",
    draftTranslated: "Hello Mr Müller! Yes, the villa in Jávea is still available (€650,000). I'll gladly send you the documents and propose two viewing times.",
    thread: [
      { id: "m1", direction: "inbound", body: "Guten Tag, ist die Villa in Jávea mit Meerblick noch zu haben? Wir würden gern besichtigen.", translated: "Hello, is the villa in Jávea with sea view still available? We'd love to view it.", ago: "11m" },
    ],
  },
  {
    id: "ld-lar", name: "Lars Pedersen", type: "buyer", lang: "no", channel: "whatsapp",
    temp: "hot", area: "Torrevieja", source: "WhatsApp", score: 81, ago: "26m",
    state: "needsYou",
    preview: "Er leiligheten fortsatt til salgs?",
    draft: "Hei Lars! Ja, leiligheten i Torrevieja er fortsatt til salgs (195 000 €). Jeg har også to lignende alternativer innenfor budsjettet — vil du at jeg sender bildene?",
    draftTranslated: "Hi Lars! Yes, the apartment in Torrevieja is still for sale (€195,000). I also have two similar options within budget — would you like me to send the photos?",
    thread: [
      { id: "m1", direction: "inbound", body: "Hei! Er leiligheten i Torrevieja fortsatt ledig? Vi ser etter noe under 200 000 €.", translated: "Hi! Is the Torrevieja apartment still available? We're looking for something under €200,000.", ago: "26m" },
    ],
  },
  {
    id: "ld-emm", name: "Emma Lindqvist", type: "buyer", lang: "sv", channel: "ads",
    temp: "hot", area: "Villamartín", source: "Facebook Ads", score: 78, ago: "1h",
    state: "needsYou",
    preview: "Tack för informationen!",
    draft: "Hej Emma! Tack för ditt intresse för Villamartín. Jag har tre lägenheter runt 280 000 € — vill du att jag skickar urvalet?",
    draftTranslated: "Hi Emma! Thanks for your interest in Villamartín. I have three apartments around €280,000 — shall I send the selection?",
    thread: [
      { id: "m1", direction: "inbound", body: "Hej, jag såg er annons om Villamartín. Vad har ni för lägenheter runt 280 000 €?", translated: "Hi, I saw your ad about Villamartín. What apartments do you have around €280,000?", ago: "1h" },
    ],
  },
  {
    id: "ld-gee", name: "Geert Janssens", type: "buyer", lang: "fr", channel: "website",
    temp: "hot", area: "Guardamar", source: "Website chat", score: 76, ago: "2h",
    state: "needsYou",
    preview: "L'appartement est-il toujours disponible ?",
    draft: "Bonjour Geert ! Oui, l'appartement à Guardamar est toujours disponible. Souhaitez-vous que je vous envoie les détails ou que je propose une visite ?",
    draftTranslated: "Hello Geert! Yes, the apartment in Guardamar is still available. Would you like me to send the details or propose a viewing?",
    thread: [
      { id: "m1", direction: "inbound", body: "Bonjour, l'appartement à Guardamar de votre site est-il toujours disponible ?", translated: "Hello, is the Guardamar apartment from your website still available?", ago: "2h" },
    ],
  },
  {
    id: "ld-ann", name: "Anna Kowalska", type: "buyer", lang: "pl", channel: "whatsapp",
    temp: "warm", area: "La Zenia", source: "WhatsApp", score: 64, ago: "5h",
    state: "autoHandled",
    preview: "Dziękuję, do zobaczenia!",
    draft: null, draftTranslated: null,
    thread: [
      { id: "m1", direction: "inbound", body: "Czy mają Państwo coś w La Zenia do 220 000 €?", translated: "Do you have anything in La Zenia up to €220,000?", ago: "6h" },
      { id: "m2", direction: "outbound", body: "Dzień dobry! Tak, mamy trzy mieszkania w La Zenia w tym przedziale. Wysyłam szczegóły na WhatsApp.", translated: "Good morning! Yes, we have three apartments in La Zenia in that range. Sending details on WhatsApp.", ago: "5h" },
    ],
  },
  {
    id: "ld-sar", name: "Sarah Whitcombe", type: "buyer", lang: "en", channel: "website",
    temp: "warm", area: "Cabo Roig", source: "Website chat", score: 60, ago: "1d",
    state: "replied",
    preview: "Great, thanks — I'll take a look.",
    draft: null, draftTranslated: null,
    thread: [
      { id: "m1", direction: "inbound", body: "Hi, do you have any 2-bed apartments near the beach in Cabo Roig under €250k?", translated: null, ago: "1d" },
      { id: "m2", direction: "outbound", body: "Hi Sarah! Yes — I have two by the beach at €235,000 and €248,000. I'll send photos and floor plans now.", translated: null, ago: "1d" },
    ],
  },
];

// ── Sellers (valuation lead — Generate pillar) ─────────────────────────────

export const DEMO_SELLER = {
  id: "sl-ing", name: "Ingrid Svensson", lang: "sv" as Lang, channel: "website" as Channel,
  area: "Dénia", ago: "3h",
  property: "3-bed townhouse · Dénia",
  rangeLow: 305000, rangeHigh: 342000,
  consentData: true, consentComms: true,
  preview: "Hur mycket är mitt hus värt?",
  thread: [
    { id: "m1", direction: "inbound" as const, body: "Hej, jag funderar på att sälja mitt radhus i Dénia. Hur mycket är det värt?", translated: "Hi, I'm thinking of selling my townhouse in Dénia. How much is it worth?", ago: "3h" },
    { id: "m2", direction: "outbound" as const, body: "Hej Ingrid! Baserat på området ligger ett radhus med 3 sovrum på cirka 305 000–342 000 €. Jag skickar en gratis värderingsrapport — vill du att vi bokar ett besök?", translated: "Hi Ingrid! Based on the area, a 3-bed townhouse is around €305,000–342,000. I'll send a free valuation report — shall we book a visit?", ago: "3h" },
  ],
};

// ── Overview KPIs ──────────────────────────────────────────────────────────

export const DEMO_KPIS = {
  newBuyers: { value: 18, delta: 5 },
  needsAction: { value: 5 },
  hotLeads: { value: 4 },
  newSellers: { value: 3, delta: 2 },
  followupsSent: { value: 42, delta: 11 },
  callsRecovered: { value: 6, delta: 3 },
};

export type ActivityRow = { id: string; name: string; label: string; channel: Channel; ago: string };
export const DEMO_ACTIVITY: ActivityRow[] = [
  { id: "a1", name: "Katarzyna Nowak", label: "New WhatsApp enquiry · awaiting your reply", channel: "whatsapp", ago: "4m" },
  { id: "a2", name: "Heinrich Müller", label: "Website chat · AI draft ready", channel: "website", ago: "11m" },
  { id: "a3", name: "Missed call +49", label: "Missed call → WhatsApp recovery sent (DE)", channel: "whatsapp", ago: "18m" },
  { id: "a4", name: "Anna Kowalska", label: "Auto-replied on WhatsApp", channel: "whatsapp", ago: "5h" },
  { id: "a5", name: "Ingrid Svensson", label: "New valuation request · seller", channel: "website", ago: "3h" },
  { id: "a6", name: "Emma Lindqvist", label: "Facebook Ads lead · AI draft ready", channel: "ads", ago: "1h" },
];

// ── Missed-call → WhatsApp recovery ────────────────────────────────────────

export type Recovery = { id: string; number: string; lang: Lang; outcome: string; ago: string; recovered: boolean };
export const DEMO_RECOVERIES: Recovery[] = [
  { id: "r1", number: "+49 ··· 392", lang: "de", outcome: "WhatsApp sent in German · replied", ago: "18m", recovered: true },
  { id: "r2", number: "+47 ··· 217", lang: "no", outcome: "WhatsApp sent in Norwegian · booked viewing", ago: "2h", recovered: true },
  { id: "r3", number: "+34 ··· 556", lang: "es", outcome: "WhatsApp sent in Spanish · awaiting reply", ago: "4h", recovered: false },
];

// ── Properties (owned catalog) ─────────────────────────────────────────────

export type DemoProperty = {
  id: string; ref: string; title: string; type: string; status: "active" | "reserved" | "sold";
  price: number; beds: number; baths: number; m2: number; city: string;
};
export const DEMO_PROPERTIES: DemoProperty[] = [
  { id: "p1", ref: "MCH-2041", title: "Sea-view villa with pool", type: "Villa", status: "active", price: 650000, beds: 4, baths: 3, m2: 240, city: "Jávea" },
  { id: "p2", ref: "MCH-1887", title: "Beachside 2-bed apartment", type: "Apartment", status: "active", price: 198000, beds: 2, baths: 2, m2: 78, city: "Orihuela Costa" },
  { id: "p3", ref: "MCH-1902", title: "Modern apartment near marina", type: "Apartment", status: "active", price: 195000, beds: 2, baths: 1, m2: 71, city: "Torrevieja" },
  { id: "p4", ref: "MCH-2110", title: "Townhouse with private garden", type: "Townhouse", status: "reserved", price: 285000, beds: 3, baths: 2, m2: 132, city: "Villamartín" },
  { id: "p5", ref: "MCH-1779", title: "Frontline golf apartment", type: "Apartment", status: "active", price: 232000, beds: 2, baths: 2, m2: 86, city: "Guardamar" },
  { id: "p6", ref: "MCH-1654", title: "Renovated bungalow", type: "Bungalow", status: "sold", price: 179000, beds: 2, baths: 1, m2: 68, city: "La Zenia" },
];

// ── Matches (buyer ↔ listing) ──────────────────────────────────────────────

export type DemoMatch = { id: string; buyer: string; lang: Lang; property: string; price: number; fit: number; reason: string };
export const DEMO_MATCHES: DemoMatch[] = [
  { id: "mt1", buyer: "Katarzyna Nowak", lang: "pl", property: "Beachside 2-bed · Orihuela Costa", price: 198000, fit: 96, reason: "2 beds · beach · €180–210k · Orihuela" },
  { id: "mt2", buyer: "Lars Pedersen", lang: "no", property: "Modern apartment · Torrevieja", price: 195000, fit: 91, reason: "2 beds · under €200k · marina area" },
  { id: "mt3", buyer: "Emma Lindqvist", lang: "sv", property: "Townhouse · Villamartín", price: 285000, fit: 84, reason: "3 beds · ~€280k · golf resort" },
];

// ── Viewings (booked appointments) ─────────────────────────────────────────

export type DemoViewing = {
  id: string; lead: string; lang: Lang; property: string; when: string;
  duration: number; agent: string; status: "confirmed" | "completed";
};
export const DEMO_VIEWINGS: DemoViewing[] = [
  { id: "v1", lead: "Heinrich Müller", lang: "de", property: "Sea-view villa · Jávea", when: "Sat 14 Jun · 10:30", duration: 45, agent: "Lucía", status: "confirmed" },
  { id: "v2", lead: "Katarzyna Nowak", lang: "pl", property: "Beachside 2-bed · Orihuela Costa", when: "Sat 14 Jun · 12:00", duration: 30, agent: "Lucía", status: "confirmed" },
  { id: "v3", lead: "Lars Pedersen", lang: "no", property: "Modern apartment · Torrevieja", when: "Sun 15 Jun · 11:00", duration: 30, agent: "Marco", status: "confirmed" },
  { id: "v4", lead: "Emma Lindqvist", lang: "sv", property: "Townhouse · Villamartín", when: "Tue 10 Jun · 17:00", duration: 45, agent: "Marco", status: "completed" },
];

// ── Performance ────────────────────────────────────────────────────────────

export const DEMO_PERF = {
  leadsAnswered: { count: 47, total: 49, pct: 96 },
  avgReplySeconds: 38,
  languagesSeen: 6,
  languageList: ["pl", "de", "no", "sv", "fr", "en"] as Lang[],
  recoveredLeads: 6,
  missedCallRecoveryPct: 71,
  dailyAnswered: [6, 9, 7, 11, 8, 4, 2],
  langBreakdown: [
    { lang: "pl" as Lang, n: 12 },
    { lang: "de" as Lang, n: 10 },
    { lang: "en" as Lang, n: 9 },
    { lang: "sv" as Lang, n: 7 },
    { lang: "no" as Lang, n: 5 },
    { lang: "fr" as Lang, n: 4 },
  ],
};

// ── Studio (generated content library) ─────────────────────────────────────

export type DemoStudioItem = {
  id: string; kind: "Ad creative" | "Social post" | "Virtual staging";
  title: string; status: "Published" | "Draft" | "Approved"; lang: Lang; gradient: string;
};
export const DEMO_STUDIO: DemoStudioItem[] = [
  { id: "s1", kind: "Ad creative", title: "Sea-view villa · Jávea — €650,000", status: "Published", lang: "de", gradient: "linear-gradient(135deg,#7FB8E8,#9FD6C0,#BCE8C2)" },
  { id: "s2", kind: "Social post", title: "New listing · Beachside 2-bed Orihuela", status: "Approved", lang: "pl", gradient: "linear-gradient(135deg,#F2C879,#E9A98A,#9FD6B0)" },
  { id: "s3", kind: "Virtual staging", title: "Torrevieja apartment — living room", status: "Draft", lang: "en", gradient: "linear-gradient(135deg,#B6A7E8,#9AA6E0,#C7B6F0)" },
  { id: "s4", kind: "Social post", title: "Open house Saturday · Villamartín", status: "Published", lang: "sv", gradient: "linear-gradient(135deg,#9FD6C0,#BCE8C2,#7FB8E8)" },
  { id: "s5", kind: "Ad creative", title: "Frontline golf apartment · Guardamar", status: "Approved", lang: "fr", gradient: "linear-gradient(135deg,#E9A98A,#F2C879,#9FD6B0)" },
  { id: "s6", kind: "Virtual staging", title: "Dénia townhouse — bedroom restyle", status: "Draft", lang: "sv", gradient: "linear-gradient(135deg,#9AA6E0,#C7B6F0,#B6A7E8)" },
];

// ── Plan / quota (Settings glance) ─────────────────────────────────────────

export const DEMO_PLAN = {
  tier: "Pro",
  quotas: [
    { label: "Voice minutes", used: 214, quota: 500 },
    { label: "Ad creatives", used: 7, quota: 20 },
    { label: "Social posts", used: 11, quota: 20 },
    { label: "Virtual staging", used: 3, quota: 20 },
  ],
  languages: ["es", "en", "de", "no", "sv", "pl", "fr"] as Lang[],
};
