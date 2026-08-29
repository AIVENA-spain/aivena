// Amanda engine — the tool registry (design §1 tools + §4 mode enforcement).
// Every tool: an Anthropic schema the model sees, a ToolClass deciding what the
// mode allows, and a real effect on the injected ToolBackends. agency/lead/
// conversation ids are NEVER model-supplied — they come from the turn context.
// book_viewing is deliberately NOT a model tool: booking executes
// deterministically OUTSIDE the loop, from a confirmed pending action (§4
// confirmation law) — the model only ever PROPOSES slots.

import { runActionTool, type AmandaMode, type ToolClass, type ToolResult } from './modes';
import { screenResearchQuestion } from './research-screen';
import type { LeadStateData } from './lead-state-lib';

export interface PropertySummary {
  id: string;
  ref: string | null;
  title: string | null;
  price: number | null;
  bedrooms: number | null;
  city: string | null;
  type: string | null;
  /** How many photos the agency holds for this property. She may SAY the count
   *  and offer to have them sent; the URLs are deliberately never exposed —
   *  they point at a third-party site (see the share-page decision). */
  photos: number;
  /** The agency's OWN listing page, or null when the catalogue's link belongs
   *  to a third-party portal (then she offers photos/a viewing instead). */
  url: string | null;
  /** Date the listing entered the AGENCY'S CATALOGUE (YYYY-MM-DD) — "in our
   *  catalogue since", not necessarily its first day on the market. Null when
   *  the backend detects the dates are a bulk-import artifact. */
  listed: string | null;
}

export interface PropertySearchResult {
  results: PropertySummary[];
  /** Deterministic honesty rider (e.g. "catalogue cannot rank newness — all
   *  listings share one import date") — the model treats tool data as law. */
  catalogue_note: string | null;
}

export interface SlotProposal {
  /** One pending action PER SLOT: a buyer's button tap or pick can never book
   *  the wrong one, and a bare "yes" against 2 open proposals is ambiguous by
   *  construction (the confirmation law re-asks). Labels are the explicit echo
   *  forms the model MUST use verbatim ("Friday 28 August, 17:00"). */
  slots: Array<{ label: string; startISO: string; pendingActionId: string }>;
}

export interface TicketRef { ticketId: string; shortCode: number }

/** The seam: real implementations hit the db/RPCs; the golden harness fakes them. */
export interface ToolBackends {
  searchProperties(filters: Record<string, unknown>): Promise<PropertySearchResult>;
  getPropertyDetails(refOrId: string): Promise<Record<string, unknown> | null>;
  getAreaInfo(area: string): Promise<string | null>;
  /** Live local research (Claude + web search — the SAME production path the
   *  website assistant uses). Returns general AREA knowledge only. */
  researchArea(question: string): Promise<{ answer: string; needsTeam: boolean } | null>;
  proposeViewingSlots(propertyId: string, preferredTimePhrase: string | null): Promise<SlotProposal>;
  askAgency(question: string, propertyId: string | null, category?: string | null): Promise<TicketRef>;
  handoffToHuman(reason: string, summary: string): Promise<void>;
  recordLeadIntel(patch: Partial<LeadStateData>): Promise<void>;
  /** Upcoming (future, active) viewings for THIS lead — the cancel law's input. */
  listUpcomingViewings(): Promise<Array<{ id: string; label: string }>>;
  /** Cancel one viewing (deterministic; calendar cleanup rides along). */
  cancelViewing(bookingId: string): Promise<{ cancelled: boolean }>;
  /** Non-FULL modes: file the cancel request as a human task instead. */
  fileCancelRequest(summary: string): Promise<void>;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ToolSpec {
  name: string;
  toolClass: ToolClass;
  schema: { name: string; description: string; input_schema: Record<string, unknown> };
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'search_properties',
    toolClass: 'read',
    schema: {
      name: 'search_properties',
      description: 'Search the agency catalogue. Returns up to 5 matches, each with the date it was listed. Rejected properties are filtered automatically. For "near X" requests pass cities as a list of X plus its neighbouring towns.',
      input_schema: {
        type: 'object',
        properties: {
          max_price: { type: 'number' }, min_bedrooms: { type: 'number' },
          city: { type: 'string' },
          cities: { type: 'array', items: { type: 'string' }, description: 'One or more towns to search at once — use for areas ("Torrevieja and around")' },
          property_type: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Distinguishing words from the buyer\'s description — features or landmarks ("golf", "sea view", "pool", "penthouse", "corner plot"). Every keyword must appear in the listing\'s title, description, or features. Use to pin down a vaguely-referenced property.' },
          sort: { type: 'string', enum: ['newest', 'price_asc', 'price_desc'], description: 'newest = most recently added to the catalogue; omit for best match' },
        },
      },
    },
  },
  {
    name: 'get_property_details',
    toolClass: 'read',
    schema: {
      name: 'get_property_details',
      description: 'Full listing data for one property by reference (e.g. IC-28746) or id. Property facts may ONLY come from this data.',
      input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    },
  },
  {
    name: 'get_area_info',
    toolClass: 'read',
    schema: {
      name: 'get_area_info',
      description: 'Local area/lifestyle guide for a town or zone (beaches, schools, amenities, vibe).',
      input_schema: { type: 'object', properties: { area: { type: 'string' } }, required: ['area'] },
    },
  },
  {
    name: 'research_area',
    toolClass: 'read',
    schema: {
      name: 'research_area',
      description:
        "Look up a LOCAL or AREA question you cannot answer from the catalogue or the agency notes — where a school, hospital, beach or landmark actually is, what a town or urbanisation is like, distances and travel times, local context. Researches current sources and returns general local information. Use this INSTEAD of ask_agency for anything that is public knowledge rather than something only the agency knows. It NEVER returns property facts (price, size, rooms, features) — those come only from the catalogue. Present what it returns as general local knowledge, and offer to have the office confirm anything the buyer would travel or decide on. Never use it for legal, tax, mortgage or immigration advice — those go to the professionals.",
      input_schema: {
        type: 'object',
        properties: { question: { type: 'string', description: 'The local question in plain English, e.g. "Where exactly is the Norwegian school near Ciudad Quesada?"' } },
        required: ['question'],
      },
    },
  },
  {
    // internal_write, NOT commitment: proposing slots writes internal state and
    // sends nothing to the buyer by itself (the reply dispatch decides that).
    // The COMMITMENT is the booking, governed by the deterministic confirmation
    // pre-step in turn.ts. As commitment-class, approval/assisted would hand
    // the model a stub with no real slot labels — and invented times pass every
    // gate (reviewer-confirmed). Shadow still simulates (no writes).
    name: 'propose_viewing_slots',
    toolClass: 'internal_write',
    schema: {
      name: 'propose_viewing_slots',
      description: 'Propose viewing slots for a property. Returns explicit slot labels you MUST echo verbatim. The booking itself only happens after the buyer explicitly confirms a proposed slot — never claim a viewing is booked. If the buyer already named a day/time, pass their words in preferred_time_phrase.',
      input_schema: {
        type: 'object',
        properties: { property_id: { type: 'string' }, preferred_time_phrase: { type: 'string', description: "The buyer's own words for when, e.g. 'viernes a las 17' — the system resolves it, never you" } },
        required: ['property_id'],
      },
    },
  },
  {
    name: 'ask_agency',
    toolClass: 'internal_write',
    schema: {
      name: 'ask_agency',
      description: 'File a question only the agency can answer (price negotiability, commission, furniture, exceptions). Tell the buyer you will check with the office and come back — then keep helping them with other things.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string' }, property_id: { type: 'string' },
          category: { type: 'string', description: 'One word: negotiability, commission, furniture, availability, viewing_exception, rules, other' },
        },
        required: ['question'],
      },
    },
  },
  {
    name: 'record_lead_intel',
    toolClass: 'internal_write',
    schema: {
      name: 'record_lead_intel',
      description: 'Record something the buyer told you about their search (budget, areas, timeline, financing, purpose, trip dates, a rejected property). Call whenever you learn something new.',
      input_schema: {
        type: 'object',
        properties: {
          budget_max: { type: 'number' }, areas: { type: 'array', items: { type: 'string' } },
          bedrooms_min: { type: 'number' }, timeline: { type: 'string' }, financing: { type: 'string' },
          purpose: { type: 'string' },
          trip_from: { type: 'string' }, trip_to: { type: 'string' },
          rejected_property_id: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'handoff_to_human',
    toolClass: 'internal_write',
    schema: {
      name: 'handoff_to_human',
      description: 'Hand the conversation to a human — ONLY for: explicit request for a human, complaints, distress, legal/tax/financial advice, live offer negotiation. For agency-answerable facts use ask_agency instead and keep the conversation.',
      input_schema: {
        type: 'object',
        properties: { reason: { type: 'string' }, summary: { type: 'string' } },
        required: ['reason', 'summary'],
      },
    },
  },
  {
    // Commitment class: FULL executes under the exactly-one law (several
    // upcoming viewings → the tool returns candidates and the model asks
    // WHICH); assisted/approval file a human task instead (the agent cancels
    // via /viewings); shadow simulates. Reschedule v1 = cancel + propose fresh
    // slots (calendar PATCH-reschedule is the P2 polish).
    name: 'cancel_viewing',
    toolClass: 'commitment',
    schema: {
      name: 'cancel_viewing',
      description: 'Cancel an upcoming viewing the buyer explicitly asked to cancel. Call WITHOUT booking_id first — if several viewings exist you get the list and must ask the buyer which one. For a reschedule: cancel, then propose_viewing_slots for fresh times.',
      input_schema: { type: 'object', properties: { booking_id: { type: 'string' } } },
    },
  },
  {
    name: 'cannot_answer',
    toolClass: 'internal_write',
    schema: {
      name: 'cannot_answer',
      description: 'Declare that you genuinely cannot answer the question from the data you have. Use it instead of guessing — the engine decides what happens next.',
      input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
];

export const TOOL_CLASS_BY_NAME: Record<string, ToolClass> =
  Object.fromEntries(TOOL_SPECS.map((t) => [t.name, t.toolClass]));

export interface ToolEvent {
  tool: string;
  input: Record<string, unknown>;
  result: ToolResult;
}

/**
 * Execute one model-requested tool call under the mode law. Unknown tool →
 * refuse (fail closed). Returns what the model should see + the audit event.
 */
export async function executeToolCall(
  mode: AmandaMode,
  backends: ToolBackends,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolEvent> {
  const toolClass = TOOL_CLASS_BY_NAME[name];
  const refuse = (reason: string): ToolEvent => ({
    tool: name, input,
    result: { ok: false, simulated: false, queued: null, refused: reason, data: null },
  });
  if (!toolClass) return refuse('unknown_tool');

  const str = (k: string): string | null => (typeof input[k] === 'string' && (input[k] as string).trim() ? (input[k] as string).trim() : null);

  // A throwing backend must cost ONE tool call, never the turn: the model sees
  // an error result and can route around it (ask_agency / cannot_answer).
  const run = async (real: () => Promise<unknown>, simulatedData?: unknown): Promise<ToolResult> => {
    try {
      return await runActionTool(mode, toolClass, real, { simulatedData });
    } catch (err) {
      console.error('[amanda-tools] backend failed', name, err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'error');
      return { ok: false, simulated: false, queued: null, refused: 'backend_error', data: null };
    }
  };
  // Variant with a QUEUE effect whose result the model should see (cancel law:
  // non-FULL modes file a human task and the model reassures the buyer).
  const runActionToolSafe = async (
    real: () => Promise<unknown>,
    simulatedData: unknown,
    queueEffect: () => Promise<unknown>,
  ): Promise<ToolResult> => {
    try {
      const r = await runActionTool(mode, toolClass, real, { simulatedData });
      if (r.queued) {
        const data = await queueEffect();
        return { ...r, data };
      }
      return r;
    } catch (err) {
      console.error('[amanda-tools] backend failed', name, err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'error');
      return { ok: false, simulated: false, queued: null, refused: 'backend_error', data: null };
    }
  };

  let result: ToolResult;
  switch (name) {
    case 'search_properties':
      result = await run(() => backends.searchProperties(input));
      break;
    case 'get_property_details': {
      const ref = str('ref');
      if (!ref) return refuse('missing_ref');
      result = await run(() => backends.getPropertyDetails(ref));
      break;
    }
    case 'get_area_info': {
      const area = str('area');
      if (!area) return refuse('missing_area');
      result = await run(() => backends.getAreaInfo(area));
      break;
    }
    case 'research_area': {
      const question = str('question');
      if (!question) return refuse('missing_question');
      // Deterministic law on WHAT may be researched (Christian's condition):
      // surveillance of a person and discriminatory area-steering are refused
      // before the question ever leaves the building. The model sees the
      // refusal and routes it honestly (office / cannot_answer).
      const screen = screenResearchQuestion(question);
      if (!screen.ok) return refuse(`research_refused:${screen.reason}`);
      result = await run(() => backends.researchArea(question));
      break;
    }
    case 'propose_viewing_slots': {
      const propertyRef = str('property_id');
      if (!propertyRef) return refuse('missing_property_id');
      result = await run(
        async () => {
          // Models pass refs (IC-28746) as readily as ids — resolve to the real
          // uuid; an unvalidated cast would 22P02 the whole query (reviewer).
          let propertyId = propertyRef;
          if (!UUID_RE.test(propertyId)) {
            const details = await backends.getPropertyDetails(propertyRef);
            const resolved = details && typeof details.id === 'string' && details.id ? details.id : null;
            if (!resolved) throw new Error('property_not_found');
            propertyId = resolved;   // our own lookup's id — authoritative by construction
          }
          return backends.proposeViewingSlots(propertyId, str('preferred_time_phrase'));
        },
        { simulated: true, slots: [{ label: 'SIMULATED — would propose real slots', startISO: '', pendingActionId: 'simulated' }] },
      );
      break;
    }
    case 'ask_agency': {
      const question = str('question');
      if (!question) return refuse('missing_question');
      result = await run(
        async () => {
          // Resolve ref codes (IC-28746) to the real uuid exactly like
          // propose_viewing_slots — the downstream general-facts-only teach
          // guard keys on property_id, so silently dropping a ref-addressed
          // binding would let one-property answers into standing knowledge
          // (review-caught LAW 2 bypass). Unresolvable ref → ticket still
          // files, just unbound (the guard's category belt still applies).
          let propertyId = str('property_id');
          if (propertyId && !UUID_RE.test(propertyId)) {
            const details = await backends.getPropertyDetails(propertyId).catch(() => null);
            propertyId = details && typeof details.id === 'string' && details.id ? details.id : null;
          }
          return backends.askAgency(question, propertyId, str('category'));
        },
        { simulated: true, ticketId: 'simulated', shortCode: 0 },
      );
      break;
    }
    case 'record_lead_intel': {
      result = await run(() => backends.recordLeadIntel(intelPatchFromInput(input)).then(() => ({ recorded: true })), { simulated: true, recorded: true });
      break;
    }
    case 'handoff_to_human': {
      const reason = str('reason');
      const summary = str('summary');
      if (!reason || !summary) return refuse('missing_reason_or_summary');
      result = await run(() => backends.handoffToHuman(reason, summary).then(() => ({ handedOff: true })), { simulated: true, handedOff: true });
      break;
    }
    case 'cancel_viewing': {
      const bookingId = str('booking_id');
      result = await runActionToolSafe(
        async () => {
          const upcoming = await backends.listUpcomingViewings();
          if (upcoming.length === 0) return { none: true, note: 'no upcoming viewing found — nothing to cancel' };
          const target = bookingId
            ? upcoming.find((v) => v.id === bookingId)
            : upcoming.length === 1 ? upcoming[0] : undefined;
          if (!target) return { candidates: upcoming, note: 'several upcoming viewings — ask the buyer WHICH one, then call again with its booking_id' };
          const r = await backends.cancelViewing(target.id);
          return { cancelled: r.cancelled, label: target.label };
        },
        { simulated: true, cancelled: true },
        async () => {
          await backends.fileCancelRequest(`Buyer asked to cancel${bookingId ? ` viewing ${bookingId}` : ' their viewing'} — please handle it from the Viewings page.`);
          return { queuedForHuman: true, note: 'the office will handle the cancellation — reassure the buyer it is being taken care of' };
        },
      );
      break;
    }
    case 'cannot_answer':
      // Pure signal — no effect in any mode; the orchestrator reads it from events.
      result = { ok: true, simulated: false, queued: null, refused: null, data: { acknowledged: true } };
      break;
    default:
      return refuse('unknown_tool');
  }
  return { tool: name, input, result };
}

/** Map the model's flat intel input onto the lead-state patch shape. */
export function intelPatchFromInput(input: Record<string, unknown>): Partial<LeadStateData> {
  const patch: Record<string, unknown> = {};
  const at = ''; // timestamps are stamped by the merge caller
  if (typeof input.budget_max === 'number') patch.budget_max = { value: input.budget_max, at };
  if (Array.isArray(input.areas)) patch.areas = { value: input.areas.filter((a) => typeof a === 'string'), at };
  if (typeof input.bedrooms_min === 'number') patch.bedrooms_min = { value: input.bedrooms_min, at };
  if (typeof input.timeline === 'string') patch.timeline = { value: input.timeline, at };
  if (typeof input.financing === 'string') patch.financing = { value: input.financing, at };
  if (typeof input.purpose === 'string') patch.purpose = { value: input.purpose, at };
  if (typeof input.trip_from === 'string' && typeof input.trip_to === 'string') {
    patch.trip_dates = { value: { from: input.trip_from, to: input.trip_to }, at };
  }
  // Only real uuids may enter rejected_property_ids — the read seam casts the
  // list ::uuid[], so one model-passed ref would poison every future search.
  if (typeof input.rejected_property_id === 'string' && UUID_RE.test(input.rejected_property_id)) {
    patch.rejected_property_ids = [input.rejected_property_id];
  }
  return patch as Partial<LeadStateData>;
}
