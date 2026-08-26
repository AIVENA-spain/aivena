// Amanda golden-conversation harness (design §7: "the promotion gate and
// regression harness ... run as ONE command"). This file provides the scripted
// machinery: a FakeBackends with an effect journal (so tests PROVE what was and
// wasn't written), a ScriptedModel (deterministic ModelResponse queue), and a
// scenario context factory. The deterministic core suite runs offline in CI;
// live-model conversational-quality scenarios ride the same scenarios with a
// real caller behind AMANDA_GOLDEN_LIVE=true (P1).

import type { ModelCall, ModelResponse, ContentBlock } from '../agent-loop';
import type { ToolBackends, PropertySummary, SlotProposal, TicketRef } from '../tools';
import type { TurnContext } from '../prompt';
import type { TurnDeps, PendingActionView, InboundMessage } from '../turn';
import type { LeadStateData } from '../lead-state-lib';

// ── Fixtures: the demo catalogue (real IC-28746 shape, fake data) ────────────
export const CHALET: Record<string, unknown> = {
  id: 'prop-1', ref: 'IC-28746', title: 'Chalet in San Javier', property_type: 'villa',
  price: 245000, currency: 'EUR', bedrooms: 3, bathrooms: 2, area_sqm: 120,
  location_city: 'San Javier', zone: 'Santiago de la Ribera',
  features: ['private pool', 'terrace', 'air conditioning'], description: 'Bright chalet near the Mar Menor.',
};
export const APARTMENT: Record<string, unknown> = {
  id: 'prop-2', ref: 'IC-30112', title: 'Apartment in Torrevieja', property_type: 'apartment',
  price: 128000, currency: 'EUR', bedrooms: 2, bathrooms: 1, area_sqm: 65,
  location_city: 'Torrevieja', zone: 'Playa del Cura', features: ['communal pool', 'lift'],
  description: 'Walkable to the beach.',
};

export interface EffectJournalEntry { effect: string; detail: Record<string, unknown> }

/** Fake backends: reads serve fixtures; every WRITE lands in the journal. The
 *  journal is how scenarios prove "shadow wrote nothing". */
export class FakeBackends implements ToolBackends {
  journal: EffectJournalEntry[] = [];
  nextTicket: TicketRef = { ticketId: 'ticket-1', shortCode: 3 };
  slotCounter = 0;

  async searchProperties(filters: Record<string, unknown>): Promise<PropertySummary[]> {
    void filters;
    return [CHALET, APARTMENT].map((p) => ({
      id: p.id as string, ref: p.ref as string, title: p.title as string,
      price: p.price as number, bedrooms: p.bedrooms as number,
      city: p.location_city as string, type: p.property_type as string,
    }));
  }
  async getPropertyDetails(refOrId: string): Promise<Record<string, unknown> | null> {
    return [CHALET, APARTMENT].find((p) => p.ref === refOrId || p.id === refOrId) ?? null;
  }
  async getAreaInfo(area: string): Promise<string | null> {
    return `${area}: family-friendly coastal town, sandy beaches, good international schools nearby.`;
  }
  async proposeViewingSlots(propertyId: string, preferredISO: string | null): Promise<SlotProposal> {
    this.slotCounter += 1;
    const id = `pa-${this.slotCounter}`;
    this.journal.push({ effect: 'propose_slots', detail: { propertyId, preferredISO, pendingActionId: id } });
    return {
      pendingActionId: id,
      slots: [
        { label: 'Friday 28 August, 17:00', startISO: '2026-08-28T15:00:00.000Z' },
        { label: 'Saturday 29 August, 11:00', startISO: '2026-08-29T09:00:00.000Z' },
      ],
    };
  }
  async askAgency(question: string, propertyId: string | null): Promise<TicketRef> {
    this.journal.push({ effect: 'ask_agency', detail: { question, propertyId } });
    return this.nextTicket;
  }
  async handoffToHuman(reason: string, summary: string): Promise<void> {
    this.journal.push({ effect: 'handoff', detail: { reason, summary } });
  }
  async recordLeadIntel(patch: Partial<LeadStateData>): Promise<void> {
    this.journal.push({ effect: 'record_intel', detail: { patch } });
  }
  writes(): EffectJournalEntry[] {
    return this.journal;   // every entry IS a write-or-effect record
  }
}

/** Deterministic model: a queue of responses, consumed per call. Requests are
 *  captured for assertions (what context/tools the model actually saw). */
export class ScriptedModel {
  requests: Array<{ system: string; messages: unknown[]; tools: unknown[] }> = [];
  private queue: ModelResponse[];
  constructor(responses: ModelResponse[]) {
    this.queue = [...responses];
  }
  call: ModelCall = async (req) => {
    this.requests.push(req as never);
    const next = this.queue.shift();
    if (!next) throw new Error('ScriptedModel exhausted — scenario asked for more model calls than scripted');
    return next;
  };
}

export function textResponse(text: string): ModelResponse {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 40 } };
}
export function toolResponse(name: string, input: Record<string, unknown>, preText?: string): ModelResponse {
  const content: ContentBlock[] = [];
  if (preText) content.push({ type: 'text', text: preText });
  content.push({ type: 'tool_use', id: `tu-${name}-${Math.abs(JSON.stringify(input).length)}`, name, input });
  return { content, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 60 } };
}

// ── Scenario context + deps ──────────────────────────────────────────────────
export function baseContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    agencyName: 'Mediterráneo Costa Homes',
    agencyKnowledge: ['Viewings need 24h notice.', 'Commission questions go to the office.'],
    workingHoursLine: 'Mon-Fri 09:30-19:00, Sat 10:00-14:00 (Europe/Madrid)',
    leadFirstName: 'Marte',
    leadLanguage: 'en',
    leadState: {},
    recentTurns: [],
    episodicSummary: null,
    pendingActionEcho: null,
    openTicketNote: null,
    mirrorTargetWords: null,
    ...overrides,
  };
}

export interface DispatchJournal {
  sent: string[];
  drafts: Array<{ text: string; kind: 'draft' | 'one_tap' }>;
  bookings: string[];
  released: Array<{ id: string; reason: string }>;
  escalations: Array<{ reason: string; detail: string }>;
}

export function makeDeps(model: ScriptedModel, backends: FakeBackends): { deps: TurnDeps; journal: DispatchJournal } {
  const journal: DispatchJournal = { sent: [], drafts: [], bookings: [], released: [], escalations: [] };
  const deps: TurnDeps = {
    callModel: model.call,
    backends,
    verifier: null,
    async executeBooking(pendingActionId) {
      journal.bookings.push(pendingActionId);
      return { bookingId: `bk-${pendingActionId}`, echo: 'Friday 28 August, 17:00 · Chalet IC-28746' };
    },
    async releasePendingAction(id, reason) {
      journal.released.push({ id, reason });
    },
    async sendReply(text) {
      journal.sent.push(text);
      return { providerMessageId: `SM-${journal.sent.length}` };
    },
    async queueDraft(text, kind) {
      journal.drafts.push({ text, kind });
    },
    async escalateToHuman(reason, detail) {
      journal.escalations.push({ reason, detail });
    },
  };
  return { deps, journal };
}

export function inbound(text: string, opts: Partial<InboundMessage> = {}): InboundMessage {
  return { text, buttonPayload: null, providerMessageId: `SM-in-${text.length}`, atMs: Date.UTC(2026, 7, 26, 10, 0), ...opts };
}

export function pending(id = 'pa-1', echoText = 'Friday 28 August, 17:00 · Chalet IC-28746'): PendingActionView {
  return { id, echo: echoText, expiresAtMs: Date.UTC(2026, 7, 26, 12, 0) };
}
