/**
 * Overview lead-surface display formatters (Bug-1 copy-polish).
 *
 * Turns raw DB enum values (source / channel / lead_type / language / temperature)
 * into professional, human-readable copy so the dashboard never leaks internal
 * identifiers like `whatsapp_inbound`, `buyer`, or `NORWEGIAN`. Pure + dashboard-only:
 * no API/DB change — the underlying values are unchanged, only how we render them.
 */

const ACRONYMS: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  ai: "AI",
  url: "URL",
  crm: "CRM",
  eu: "EU",
};

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (ACRONYMS[lower]) return ACRONYMS[lower];
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Humanize a raw token: split on _ - whitespace, Title-Case, fix known acronyms. */
export function humanizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  return cleaned.split(/[\s_-]+/).filter(Boolean).map(titleCaseWord).join(" ");
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  web: "Web",
  webchat: "Web chat",
  website: "Web",
  phone: "Phone",
  voice: "Phone",
  call: "Phone",
  sms: "SMS",
};

export function formatChannel(channel: string | null | undefined): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel.trim().toLowerCase()] ?? humanizeToken(channel);
}

const SOURCE_LABELS: Record<string, string> = {
  whatsapp_inbound: "WhatsApp enquiry",
  whatsapp: "WhatsApp enquiry",
  email_inbound: "Email enquiry",
  email: "Email enquiry",
  web_form: "Web form",
  webform: "Web form",
  web: "Website",
  website: "Website",
  phone_inbound: "Phone enquiry",
  call_inbound: "Phone enquiry",
  manual: "Manual entry",
  referral: "Referral",
  portal: "Portal",
};

export function formatSource(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source.trim().toLowerCase()] ?? humanizeToken(source);
}

const LEAD_TYPE_LABELS: Record<string, string> = {
  buyer: "Buyer",
  seller: "Seller",
  renter: "Renter",
  tenant: "Tenant",
  landlord: "Landlord",
  investor: "Investor",
  owner: "Owner",
};

export function formatLeadType(type: string | null | undefined): string | null {
  if (!type) return null;
  return LEAD_TYPE_LABELS[type.trim().toLowerCase()] ?? humanizeToken(type);
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", english: "English",
  es: "Spanish", spanish: "Spanish", espanol: "Spanish", "español": "Spanish",
  no: "Norwegian", nb: "Norwegian", nn: "Norwegian", norwegian: "Norwegian",
  de: "German", german: "German", deutsch: "German",
  fr: "French", french: "French", francais: "French",
  nl: "Dutch", dutch: "Dutch", nederlands: "Dutch",
  sv: "Swedish", swedish: "Swedish", svenska: "Swedish",
  da: "Danish", danish: "Danish", dansk: "Danish",
  fi: "Finnish", finnish: "Finnish", suomi: "Finnish",
  pl: "Polish", polish: "Polish", polski: "Polish",
  ru: "Russian", russian: "Russian",
  pt: "Portuguese", portuguese: "Portuguese",
  it: "Italian", italian: "Italian", italiano: "Italian",
};

export function formatLanguage(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return LANGUAGE_LABELS[lang.trim().toLowerCase()] ?? humanizeToken(lang);
}

/**
 * Combined temperature + score meta line.
 * - temperature present → "Warm · 75"
 * - temperature absent  → "<scoreLabel> 75" (scoreLabel is i18n, defaults to "Lead score")
 * - neither             → null
 */
export function formatTemperatureScore(
  temperature: string | null | undefined,
  score: number | null | undefined,
  scoreLabel = "Lead score",
): string | null {
  const parts: string[] = [];
  const temp = humanizeToken(temperature);
  if (temp) parts.push(temp);
  if (typeof score === "number") {
    parts.push(temp ? String(score) : `${scoreLabel} ${score}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
