// Amanda engine — what she may RESEARCH (Christian's condition, 2026-08-28:
// "its harmless research… as long as theyre not asking anything unappropriate").
// The prompt is aspiration; this is the deterministic law on the research tool.
// Pure, no db — refuses BEFORE the question ever leaves the building.
//
// Two classes are refused, both for real-world reasons rather than squeamishness:
//
//  1. PEOPLE. Looking up a private individual (the buyer, a seller, a neighbour)
//     is surveillance, not local knowledge, and it is personal data we have no
//     basis to collect. Public institutions are NOT people — a school, town
//     hall, hospital or clinic is exactly what she SHOULD look up.
//
//  2. STEERING. Describing an area by the race, religion, nationality or
//     ethnicity of the people living there is discriminatory area-steering —
//     illegal in property sales and the fastest way to end an agency. This
//     mirrors the discrimination screen already used on agency knowledge.
//
// Everything else — schools, beaches, distances, transport, healthcare,
// amenities, the character of a town, the local market — flows through.

export type ResearchVerdict = { ok: true } | { ok: false; reason: 'about_a_person' | 'discriminatory_steering' | 'empty' };

// A person-lookup intent. Deliberately about the INTENT ("who lives at", "find
// the owner of", "background check"), not about names — name detection would
// refuse "Where is the Norwegian school in Ciudad Quesada?" on "Norwegian".
const PERSON_INTENT: RegExp[] = [
  /\b(who (?:lives|owns|is living)|who's living)\b/i,
  /\b(background check|criminal record|court record|credit (?:score|check))\b/i,
  /\b(find|look ?up|search for|get|trace)\b[^.?!]{0,30}\b(this |the )?(person|owner|seller|buyer|neighbou?r|landlord)\b[^.?!]{0,30}\b(address|phone|number|email|salary|income|age|facebook|instagram|linkedin|social media)\b/i,
  /\b(phone number|home address|email address|date of birth|salary|net worth)\b[^.?!]{0,25}\b(of|for)\b[^.?!]{0,25}\b(the )?(owner|seller|buyer|neighbou?r|landlord|him|her|them)\b/i,
  /\b(quién vive|quien vive|dueño actual|propietario actual)\b[^.?!]{0,30}\b(en|de)\b/i,
  /\b(hvem (?:bor|eier))\b/i,
];

// Composition-of-the-population questions. "Is it a safe area?" is fine and
// common; "is it a [ethnicity] area?" is not.
const STEERING: RegExp[] = [
  /\b(how many|what (?:percentage|proportion)|hvor mange|cuántos|cuantos)\b[^.?!]{0,40}\b(muslims?|jews?|jewish|christians?|gypsies|gypsy|roma|blacks?|africans?|arabs?|moroccans?|immigrants?|foreigners of colour)\b/i,
  /\b(is|are|isn'?t)\b[^.?!]{0,25}\b(a |an |the )?(white|black|muslim|jewish|arab|gypsy|roma|christian)\b[^.?!]{0,15}\b(area|neighbou?rhood|barrio|district|urbani[sz]ation|part of town|community)\b/i,
  /\b(racial|ethnic|religious)\b[^.?!]{0,20}\b(makeup|composition|mix|breakdown|demographics?)\b/i,
  /\b(avoid|stay away from|keep away from)\b[^.?!]{0,30}\b(muslims?|jews?|gypsies|gypsy|roma|blacks?|arabs?|immigrants?)\b/i,
  /\b(crime|criminalit[yé])\b[^.?!]{0,30}\b(by|among|amongst)\b[^.?!]{0,20}\b(race|ethnicity|nationality|immigrants?|foreigners?)\b/i,
];

/** The deterministic law on research_area. Refusal is honest, not silent: the
 *  tool returns a refusal the model must handle (offer the office instead). */
export function screenResearchQuestion(question: string): ResearchVerdict {
  const q = (question ?? '').replace(/[’‘]/g, "'").trim();
  if (!q) return { ok: false, reason: 'empty' };
  if (STEERING.some((re) => re.test(q))) return { ok: false, reason: 'discriminatory_steering' };
  if (PERSON_INTENT.some((re) => re.test(q))) return { ok: false, reason: 'about_a_person' };
  return { ok: true };
}
