// Agent pinging — WHO gets asked, and WHEN. Pure logic, no I/O, so every rule
// below is testable without a database or a phone.
//
// The gap this closes (Christian, across 2026-08-30/31): Amanda files a good
// question with the property stamped on it, and it lands in the dashboard —
// where it waits until somebody happens to look. The whole point of the agent
// roster is that the question reaches the right person's phone instead.
//
// "The right person" is a promise the roster header already makes: "Amanda
// pings the right one — by language, and only in their working hours." This
// file is that sentence, executable.

export interface PingableAgent {
  id: string;
  full_name: string;
  whatsapp_e164: string;
  languages: string[];
  /** { "0".."6": [hour, ...] }, 0 = Sunday, matching JS getDay(). */
  work_hours: Record<string, number[]> | null;
  receives_pings: boolean;
  status: string;
  /** Last time they sent US anything — the WhatsApp 24h window starts here. */
  last_checkin_at: string | null;
}

export type PickReason =
  | 'ok'
  | 'no_agents'                 // nobody registered at all
  | 'none_receive_pings'        // registered, but pings switched off
  | 'none_on_shift'             // all off-shift right now
  | 'none_speak_language';      // on shift, but nobody speaks the buyer

export interface PickResult {
  agent: PingableAgent | null;
  reason: PickReason;
  /** True when we had to ignore the language preference to reach anyone. */
  languageCompromise: boolean;
}

/** Hour-of-day + day-of-week for an instant in a named zone, without pulling in a tz library. */
export function zonedDayHour(atMs: number, timeZone: string): { day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', hour: 'numeric', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(atMs));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { day: day < 0 ? 0 : day, hour: Number.isFinite(hr) ? hr % 24 : 0 };
}

/**
 * On shift right now?
 *
 * An agent with NO hours set is treated as NOT on shift. That is deliberate:
 * hours are left unset until someone fills them in, and inventing a default
 * would text a real person at a time they never agreed to. Silence is the safe
 * failure here — the question still sits in the dashboard.
 */
export function isOnShift(agent: PingableAgent, atMs: number, timeZone: string): boolean {
  const wh = agent.work_hours;
  if (!wh || Object.keys(wh).length === 0) return false;
  const { day, hour } = zonedDayHour(atMs, timeZone);
  const hours = wh[String(day)];
  return Array.isArray(hours) && hours.includes(hour);
}

/** The WhatsApp 24h service window: open only if they messaged us recently. */
export function windowOpen(agent: PingableAgent, atMs: number): boolean {
  if (!agent.last_checkin_at) return false;
  const t = Date.parse(agent.last_checkin_at);
  if (!Number.isFinite(t)) return false;
  // 23h, not 24h — the same margin the buyer path uses, so a ping never lands
  // on the wrong side of the boundary because of clock drift or queue delay.
  return atMs - t < 23 * 60 * 60 * 1000;
}

/**
 * Pick who to ask.
 *
 * Order of preference: speaks the buyer's language AND on shift → on shift in
 * any language → nobody. Being ON SHIFT is never traded away: texting an agent
 * outside their hours is the thing the roster explicitly promised not to do,
 * whereas answering in a shared language is a preference we can compromise on
 * and flag. Ties break on the fewest pings so far, then on name, so the same
 * inputs always choose the same person.
 */
export function pickAgent(
  agents: PingableAgent[],
  buyerLanguage: string | null,
  atMs: number,
  timeZone: string,
  pingCounts: Record<string, number> = {},
): PickResult {
  const active = agents.filter((a) => a.status === 'active');
  if (active.length === 0) return { agent: null, reason: 'no_agents', languageCompromise: false };

  const pingable = active.filter((a) => a.receives_pings);
  if (pingable.length === 0) return { agent: null, reason: 'none_receive_pings', languageCompromise: false };

  const onShift = pingable.filter((a) => isOnShift(a, atMs, timeZone));
  if (onShift.length === 0) return { agent: null, reason: 'none_on_shift', languageCompromise: false };

  const order = (list: PingableAgent[]) =>
    [...list].sort((x, y) => {
      const px = pingCounts[x.id] ?? 0;
      const py = pingCounts[y.id] ?? 0;
      if (px !== py) return px - py;
      return x.full_name.localeCompare(y.full_name);
    });

  const lang = (buyerLanguage ?? '').toLowerCase();
  const speaks = lang
    ? onShift.filter((a) => a.languages.map((l) => l.toLowerCase()).includes(lang))
    : [];
  if (speaks.length > 0) return { agent: order(speaks)[0], reason: 'ok', languageCompromise: false };

  // On shift but nobody speaks them: still ask someone — an agent who reads the
  // question in English and answers is far better than a buyer waiting — but
  // say so, so the caller can note it rather than pretend it was a clean match.
  return { agent: order(onShift)[0], reason: 'ok', languageCompromise: Boolean(lang) };
}
