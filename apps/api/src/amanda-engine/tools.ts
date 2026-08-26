// Amanda engine — the tool registry (design §1 tools + §4 mode enforcement).
// Every tool: an Anthropic schema the model sees, a ToolClass deciding what the
// mode allows, and a real effect on the injected ToolBackends. agency/lead/
// conversation ids are NEVER model-supplied — they come from the turn context.
// book_viewing is deliberately NOT a model tool: booking executes
// deterministically OUTSIDE the loop, from a confirmed pending action (§4
// confirmation law) — the model only ever PROPOSES slots.

import { runActionTool, type AmandaMode, type ToolClass, type ToolResult } from './modes';
import type { LeadStateData } from './lead-state-lib';

export interface PropertySummary {
  id: string;
  ref: string | null;
  title: string | null;
  price: number | null;
  bedrooms: number | null;
  city: string | null;
  type: string | null;
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
  searchProperties(filters: Record<string, unknown>): Promise<PropertySummary[]>;
  getPropertyDetails(refOrId: string): Promise<Record<string, unknown> | null>;
  getAreaInfo(area: string): Promise<string | null>;
  proposeViewingSlots(propertyId: string, preferredISO: string | null): Promise<SlotProposal>;
  askAgency(question: string, propertyId: string | null): Promise<TicketRef>;
  handoffToHuman(reason: string, summary: string): Promise<void>;
  recordLeadIntel(patch: Partial<LeadStateData>): Promise<void>;
}

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
      description: 'Search the agency catalogue. Returns up to 5 matching properties. Rejected properties are filtered automatically.',
      input_schema: {
        type: 'object',
        properties: {
          max_price: { type: 'number' }, min_bedrooms: { type: 'number' },
          city: { type: 'string' }, property_type: { type: 'string' },
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
    name: 'propose_viewing_slots',
    toolClass: 'commitment',
    schema: {
      name: 'propose_viewing_slots',
      description: 'Propose viewing slots for a property. Returns explicit slot labels you MUST echo verbatim. The booking itself only happens after the buyer explicitly confirms a proposed slot — never claim a viewing is booked.',
      input_schema: {
        type: 'object',
        properties: { property_id: { type: 'string' }, preferred_time_iso: { type: 'string' } },
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
        properties: { question: { type: 'string' }, property_id: { type: 'string' } },
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

  const run = (real: () => Promise<unknown>, simulatedData?: unknown) =>
    runActionTool(mode, toolClass, real, { simulatedData });

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
    case 'propose_viewing_slots': {
      const propertyId = str('property_id');
      if (!propertyId) return refuse('missing_property_id');
      result = await run(
        () => backends.proposeViewingSlots(propertyId, str('preferred_time_iso')),
        { simulated: true, slots: [{ label: 'SIMULATED — would propose real slots', startISO: '', pendingActionId: 'simulated' }] },
      );
      break;
    }
    case 'ask_agency': {
      const question = str('question');
      if (!question) return refuse('missing_question');
      result = await run(
        () => backends.askAgency(question, str('property_id')),
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
  if (typeof input.rejected_property_id === 'string') patch.rejected_property_ids = [input.rejected_property_id];
  return patch as Partial<LeadStateData>;
}
