// Amanda engine — pure pending-action narrowing (kept db-free so the golden
// suite can exercise it; process-turn-db wires it).

/** Narrow several proposed slots by the buyer's text using each label's
 *  unambiguous numeric tokens (day-of-month + HH:MM, plus weekday names en/es).
 *  Returns a slot only when EXACTLY one matches — never guess (§4). */
export function narrowPendingByText(
  actions: Array<{ id: string; label: string; expiresAtMs: number }>,
  text: string,
): { id: string; label: string; expiresAtMs: number } | null {
  const t = text.toLowerCase();
  const matches = actions.filter((a) => {
    const label = a.label.toLowerCase();
    const day = label.match(/\b(\d{1,2})\b/)?.[1];
    const time = label.match(/(\d{1,2}):(\d{2})/);
    const weekday = label.match(/^([a-z]+)/)?.[1];
    const wdEs: Record<string, string> = { monday: 'lunes', tuesday: 'martes', wednesday: 'miercoles', thursday: 'jueves', friday: 'viernes', saturday: 'sabado', sunday: 'domingo' };
    const hits: boolean[] = [];
    if (day) hits.push(new RegExp(`\\b${day}\\b`).test(t));
    if (time) hits.push(t.includes(`${time[1]}:${time[2]}`) || new RegExp(`\\b${time[1]}\\s*h\\b|\\ba las ${time[1]}\\b|\\bat ${time[1]}\\b`).test(t));
    if (weekday && wdEs[weekday]) hits.push(t.includes(weekday) || t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(wdEs[weekday]));
    return hits.some(Boolean);
  });
  return matches.length === 1 ? matches[0] : null;
}

