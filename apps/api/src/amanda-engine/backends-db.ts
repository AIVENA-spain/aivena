// Amanda engine — production ToolBackends over the real database. Every method
// opens its own SHORT withAgency transaction (the agent loop spans slow model
// IO — a held-open tx across that would be the calendar-worker anti-pattern).
// All ids come from the turn context, never from the model. House rule honored
// throughout: array params via string_to_array, never ${arr}::type[].

import { sql } from 'drizzle-orm';
import { withAgency } from '../../../../packages/db/client';
import { deleteCalendarEventForBooking } from '../routes/calendar-worker';
import { generalAgentAnswer } from '../routes/amanda-llm';
import { ownSiteUrl } from './site-link';
import { wallClockInZone, resolveDatetimePhrase } from './datetime-resolver';
import { candidateSlots, parseAmandaSettings, slotLabel, type AmandaAgencySettings } from './availability-lib';

export { candidateSlots, parseAmandaSettings, slotLabel, type AmandaAgencySettings } from './availability-lib';
import { mergeExtraction, type LeadStateData } from './lead-state-lib';
import { UUID_RE, type ToolBackends, type PropertySummary, type PropertySearchResult, type SlotProposal, type TicketRef } from './tools';

export interface BackendCtx {
  agencyId: string;
  /** Trading name — the research call answers as this agency's colleague. */
  agencyName: string;
  /** The agency's own web hosts; a listing link is shared ONLY if it is theirs. */
  agencySiteHosts: string[];
  leadId: string;
  conversationId: string;
  leadLanguage: string;
  rejectedPropertyIds: string[];
  settings: AmandaAgencySettings;
  nowMs: () => number;
}

export function makeDbBackends(ctx: BackendCtx): ToolBackends {
  const A = ctx.agencyId;

  return {
    async searchProperties(filters: Record<string, unknown>): Promise<PropertySearchResult> {
      const maxPrice = typeof filters.max_price === 'number' ? filters.max_price : null;
      const minBeds = typeof filters.min_bedrooms === 'number' ? filters.min_bedrooms : null;
      // cities (array) and city (single) merge into ONE any-of ILIKE list —
      // "near Torrevieja" = Torrevieja + the neighbouring towns the model
      // names. A comma INSIDE an entry splits it into separate towns (models
      // pass "Torrevieja, La Mata" as one string, and "Pilar de la Horadada,
      // Alicante" must not silently become an unmatchable pattern — review).
      // Each core is sanitized of %_ metachars; a core that sanitizes to
      // nothing is DROPPED, never allowed to become a '%%' match-everything
      // (review). CSV seam per the drizzle array law (string_to_array).
      const cityList = [
        ...(Array.isArray(filters.cities) ? filters.cities : []),
        ...(typeof filters.city === 'string' ? [filters.city] : []),
      ]
        .filter((c): c is string => typeof c === 'string')
        .flatMap((c) => c.split(','))
        .map((c) => c.trim().replace(/[%_]/g, ''))
        .filter((core) => core.length > 0)
        .map((core) => `%${core}%`)
        .slice(0, 20);
      const citiesCsv = cityList.join(',');
      const type = typeof filters.property_type === 'string' && filters.property_type.trim() ? `%${filters.property_type.trim().replace(/[%_]/g, '')}%` : null;
      // keywords: EVERY keyword must appear in title+description+features —
      // the vague-reference ladder ("the one near the golf in Quesada"):
      // narrowing traits are conjunctive, like an agent's mental filter.
      const kwCsv = (Array.isArray(filters.keywords) ? filters.keywords : [])
        .filter((k): k is string => typeof k === 'string')
        .flatMap((k) => k.split(','))
        .map((k) => k.trim().replace(/[%_]/g, ''))
        .filter((core) => core.length > 0)
        .map((core) => `%${core}%`)
        .slice(0, 8)
        .join(',');
      const sort = filters.sort === 'newest' || filters.sort === 'price_asc' || filters.sort === 'price_desc' ? (filters.sort as string) : null;
      // Read-seam belt: one non-uuid in the list (legacy/bad data) and the
      // ::uuid[] cast would 22P02 every future search for this lead.
      const rejectedCsv = ctx.rejectedPropertyIds.filter((id) => UUID_RE.test(id)).join(',');
      return withAgency(A, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id, external_id, title, price, bedrooms, location_city, property_type,
                 jsonb_array_length(COALESCE(images, '[]'::jsonb)) AS photo_count,
                 source_url,
                 created_at::date::text AS listed_date,
                 (SELECT count(DISTINCT p2.created_at::date) FROM properties p2
                   WHERE p2.agency_id = current_setting('app.current_agency_id', true)
                     AND (p2.status IS NULL OR p2.status NOT IN ('sold', 'withdrawn', 'inactive', 'archived'))
                 ) AS catalogue_distinct_days,
                 (SELECT min(p2.created_at) < now() - interval '30 days' FROM properties p2
                   WHERE p2.agency_id = current_setting('app.current_agency_id', true)
                     AND (p2.status IS NULL OR p2.status NOT IN ('sold', 'withdrawn', 'inactive', 'archived'))
                 ) AS catalogue_oldest_old
            FROM properties
           WHERE agency_id = current_setting('app.current_agency_id', true)
             AND (status IS NULL OR status NOT IN ('sold', 'withdrawn', 'inactive', 'archived'))
             AND (${maxPrice}::numeric IS NULL OR price <= ${maxPrice}::numeric)
             AND (${minBeds}::int IS NULL OR bedrooms >= ${minBeds}::int)
             AND (${citiesCsv} = '' OR location_city ILIKE ANY (string_to_array(${citiesCsv}, ',')))
             AND (${type}::text IS NULL OR property_type ILIKE ${type})
             AND (${kwCsv} = '' OR (
               SELECT bool_and((COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(features::text,'')) ILIKE k)
               FROM unnest(string_to_array(${kwCsv}, ',')) AS k
             ))
             AND (${rejectedCsv} = '' OR NOT (id = ANY(string_to_array(${rejectedCsv}, ',')::uuid[])))
           ORDER BY
             CASE WHEN ${sort}::text = 'newest' THEN created_at END DESC NULLS LAST,
             CASE WHEN ${sort}::text = 'price_asc' THEN price END ASC NULLS LAST,
             CASE WHEN ${sort}::text = 'price_desc' THEN price END DESC NULLS LAST,
             updated_at DESC NULLS LAST
           LIMIT 5
        `);
        const list = rows as unknown as Array<Record<string, unknown>>;
        // Honesty rider (§2), two distinct truths (review-verified):
        //   · BULK-IMPORT ARTIFACT — 1-2 distinct created dates AND the oldest
        //     is 30+ days back: the dates are import timestamps, not market
        //     reality. Listed dates are WITHHELD (the model would honestly
        //     misstate them) and "newest" is declared unrankable.
        //   · GENUINELY YOUNG catalogue — 1-2 distinct dates, all recent:
        //     the dates are real; everything effectively just came in.
        // General across agencies: real per-listing feeds accumulate many
        // distinct dates and get clean per-result dates with no note.
        const distinctDays = list[0] != null ? Number(list[0].catalogue_distinct_days) : 99;
        const importArtifact = distinctDays <= 2 && list[0] != null && list[0].catalogue_oldest_old === true;
        const results: PropertySummary[] = list.map((r) => ({
          id: String(r.id), ref: (r.external_id as string) ?? null, title: (r.title as string) ?? null,
          price: r.price != null ? Number(r.price) : null, bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
          city: (r.location_city as string) ?? null, type: (r.property_type as string) ?? null,
          photos: r.photo_count != null ? Number(r.photo_count) : 0,
          // Only the agency's OWN listing page — a portal URL would send the
          // buyer to a competitor's site (Christian, 2026-08-28).
          url: ownSiteUrl(r.source_url as string | null, ctx.agencySiteHosts),
          listed: importArtifact ? null : (r.listed_date as string) ?? null,
        }));
        const catalogue_note = importArtifact
          ? 'CATALOGUE CANNOT RANK NEWNESS: all listings entered the system on the same bulk-import date, so "newest" and listing dates are not knowable from this data. Never claim any of these is new, just in, or listed on a date — say honestly that you cannot rank by newness and offer to ask the office what has come in recently.'
          : sort === 'newest' && distinctDays <= 2
            ? 'THE WHOLE CATALOGUE IS BRAND NEW: everything came in within the last day or two, so all of these are effectively just in — say that honestly rather than ranking them against each other.'
            : null;
        return { results, catalogue_note };
      });
    },

    async getPropertyDetails(refOrId: string): Promise<Record<string, unknown> | null> {
      const needle = refOrId.trim();
      return withAgency(A, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id, external_id AS ref, title, property_type, status, price, price_currency,
                 jsonb_array_length(COALESCE(images, '[]'::jsonb)) AS photo_count,
                 source_url,
                 bedrooms, bathrooms, area_sqm, area_built_sqm, area_plot_sqm,
                 location_city, location_region, raw_payload->>'zone' AS zone,
                 features, left(description, 900) AS description, updated_at,
                 (updated_at < now() - interval '45 days') AS is_stale
            FROM properties
           WHERE agency_id = current_setting('app.current_agency_id', true)
             AND (external_id = ${needle} OR id::text = ${needle})
           LIMIT 1
        `);
        const r = (rows as unknown as Array<Record<string, unknown>>)[0];
        if (!r) return null;
        // Replace the raw source URL with the shareable one (null unless it is
        // the agency's own site) so a portal link can never reach the model.
        r.url = ownSiteUrl(r.source_url as string | null, ctx.agencySiteHosts);
        delete r.source_url;
        // §2 staleness guard: a listing untouched for 45+ days gets an explicit
        // hedge instruction riding the tool result (the model treats tool data
        // as law; the honest framing is deterministic, not hoped-for).
        if (r.is_stale) {
          // No first-person promise in the hedge: "I'll confirm with the
          // office" without a filed ask_agency is exactly the empty promise
          // the office-promise law rejects (live demo 2026-08-27).
          r.staleness_note = 'LISTING NOT UPDATED FOR 45+ DAYS: frame price/availability as "listed at ..." and, if current status matters to the buyer, OFFER to double-check with the office ("want me to confirm the current status with the office?") — file ask_agency only if they say yes. Never state price/availability as certain, and never say you are checking with the office unless you actually filed the question.';
        }
        delete r.is_stale;
        return r;
      });
    },

    // Live local research — reuses the SAME production path the website
    // assistant already runs (Claude + server-side web search, output-safety
    // screened). AREA knowledge only: it can never return property facts, and
    // the engine's own gates still hold every number in the final reply.
    async researchArea(question: string): Promise<{ answer: string; needsTeam: boolean } | null> {
      const res = await generalAgentAnswer({ agencyName: ctx.agencyName, question, lang: undefined });
      if (!res.ok || !res.answer) return null;
      return { answer: res.answer, needsTeam: Boolean(res.needsTeam) };
    },

    async getAreaInfo(area: string): Promise<string | null> {
      // P0: grounded-but-modest — live catalogue presence in the area. Rich
      // precomputed locality guides are the P1 backlog item (design §1); the
      // model is instructed to frame area talk as general local context.
      const like = `%${area.trim().replace(/[%_]/g, '')}%`;
      return withAgency(A, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT count(*)::int AS n, min(price)::numeric AS min_price
            FROM properties
           WHERE agency_id = current_setting('app.current_agency_id', true)
             AND (status IS NULL OR status NOT IN ('sold', 'withdrawn', 'inactive', 'archived'))
             AND (location_city ILIKE ${like} OR location_region ILIKE ${like} OR raw_payload->>'zone' ILIKE ${like})
        `);
        const r = (rows as unknown as Array<{ n: number; min_price: string | null }>)[0];
        if (!r || r.n === 0) return null;
        return `The agency currently lists ${r.n} propert${r.n === 1 ? 'y' : 'ies'} in/around ${area.trim()}${r.min_price ? `, from ${Math.round(Number(r.min_price))} EUR` : ''}.`;
      });
    },

    async proposeViewingSlots(propertyId: string, preferredTimePhrase: string | null): Promise<SlotProposal> {
      const s = ctx.settings;
      const nowMs = ctx.nowMs();
      const candidates: number[] = [];
      if (preferredTimePhrase) {
        // Design §4: the model passes the buyer's WORDS; the deterministic
        // resolver converts (agency tz, fresh now). Ambiguous/unparseable →
        // fall back to canned slots; the explicit echo prevents silent drift.
        const r = resolveDatetimePhrase(preferredTimePhrase, nowMs, s.timezone);
        if (r.ok) {
          const t = Date.parse(r.utcISO);
          if (t > nowMs + s.viewingNoticeHours * 3600_000) candidates.push(t);
        }
      }
      candidates.push(...candidateSlots(nowMs, s));

      // Phase 1 (one tx): sweep dead holds, find free slots, create the pending
      // actions. Holds are inserted in phase 2, OUTSIDE this tx: an EXCLUDE
      // violation (23P01) aborts its transaction, and ON CONFLICT does not
      // support exclusion constraints — a contested hold must never destroy the
      // pending actions themselves (reviewer-confirmed).
      const created = await withAgency(A, async (tx) => {
        await tx.execute(sql`
          DELETE FROM viewing_slot_holds
           WHERE agency_id = current_setting('app.current_agency_id', true) AND expires_at <= now()
        `);
        const free: number[] = [];
        for (const startMs of candidates) {
          if (free.length >= 2) break;
          if (free.some((f) => Math.abs(f - startMs) < s.viewingDurationMin * 60_000)) continue;
          const startISO = new Date(startMs).toISOString();
          const endISO = new Date(startMs + s.viewingDurationMin * 60_000).toISOString();
          const conflicts = await tx.execute(sql`
            SELECT 1 FROM bookings
             WHERE agency_id = current_setting('app.current_agency_id', true)
               AND status IN ('requested'::booking_status, 'confirmed'::booking_status, 'rescheduled'::booking_status)
               AND tstzrange(scheduled_at, scheduled_at + make_interval(mins => COALESCE(duration_minutes, 60)), '[)')
                   && tstzrange(${startISO}::timestamptz, ${endISO}::timestamptz, '[)')
            UNION ALL
            SELECT 1 FROM viewing_slot_holds h
             LEFT JOIN amanda_pending_actions pa ON pa.id = h.pending_action_id
             WHERE h.agency_id = current_setting('app.current_agency_id', true)
               AND h.expires_at > now()
               AND h.slot && tstzrange(${startISO}::timestamptz, ${endISO}::timestamptz, '[)')
               AND (pa.conversation_id IS NULL OR pa.conversation_id <> ${ctx.conversationId}::uuid)
            LIMIT 1
          `);
          if ((conflicts as unknown as unknown[]).length === 0) free.push(startMs);
        }

        const slots: SlotProposal['slots'] = [];
        for (const startMs of free) {
          const startISO = new Date(startMs).toISOString();
          const endISO = new Date(startMs + s.viewingDurationMin * 60_000).toISOString();
          const rows = await tx.execute(sql`
            INSERT INTO amanda_pending_actions (agency_id, conversation_id, lead_id, property_id, action_type, slot, payload, expires_at)
            VALUES (
              ${A}, ${ctx.conversationId}::uuid, ${ctx.leadId}::uuid, ${propertyId}::uuid, 'book_viewing',
              tstzrange(${startISO}::timestamptz, ${endISO}::timestamptz, '[)'),
              jsonb_build_object('label', ${slotLabel(startMs, s.timezone)}::text),
              now() + interval '24 hours'
            )
            RETURNING id
          `);
          const paId = String((rows as unknown as Array<{ id: string }>)[0].id);
          slots.push({ label: slotLabel(startMs, s.timezone), startISO, pendingActionId: paId });
        }
        return slots;
      });

      // Phase 2: best-effort soft holds (TTL 15 min), each in its own tx — the
      // EXCLUDE constraint at execution time stays the arbiter regardless.
      for (const slot of created) {
        const endISO = new Date(Date.parse(slot.startISO) + s.viewingDurationMin * 60_000).toISOString();
        await withAgency(A, async (tx) => {
          await tx.execute(sql`
            INSERT INTO viewing_slot_holds (agency_id, agent_key, slot, pending_action_id, expires_at)
            VALUES (${A}, 'agency', tstzrange(${slot.startISO}::timestamptz, ${endISO}::timestamptz, '[)'), ${slot.pendingActionId}::uuid, now() + interval '15 minutes')
          `);
        }).catch(() => { /* contested hold (23P01) = fine; the arbiter decides at booking */ });
      }
      return { slots: created };
    },

    async askAgency(question: string, propertyId: string | null, category?: string | null): Promise<TicketRef> {
      const q = question.slice(0, 800);
      const propId = propertyId && UUID_RE.test(propertyId) ? propertyId : null;
      const cat = category && /^[a-z_]{3,32}$/i.test(category) ? category.toLowerCase() : null;
      // A 23505 (concurrent mint of the same live short_code, partial unique
      // index) aborts its transaction — the single retry must be a FRESH tx.
      const attempt = (): Promise<TicketRef> => withAgency(A, async (tx) => {
        // Retry-idempotency (reviewer): a crashed turn re-runs its tools — the
        // same question on the same conversation within 24h reuses the ticket
        // instead of re-pinging the agency.
        const existing = await tx.execute(sql`
          SELECT id, short_code FROM amanda_questions
           WHERE conversation_id = ${ctx.conversationId}::uuid
             AND question_text = ${q}
             AND (status IN ('open', 'clarifying', 'escalated') OR created_at > now() - interval '24 hours')
           LIMIT 1
        `);
        const dup = (existing as unknown as Array<{ id: string; short_code: number }>)[0];
        if (dup) return { ticketId: String(dup.id), shortCode: Number(dup.short_code) };

        const rows = await tx.execute(sql`
          WITH next_code AS (
            SELECT COALESCE(MIN(candidate), 1) AS code FROM (
              SELECT gs AS candidate FROM generate_series(1, 999) gs
              WHERE gs NOT IN (
                SELECT short_code FROM amanda_questions
                 WHERE agency_id = current_setting('app.current_agency_id', true)
                   AND (status IN ('open', 'clarifying', 'escalated') OR created_at > now() - interval '7 days')
              )
            ) c
          )
          INSERT INTO amanda_questions (agency_id, short_code, conversation_id, lead_id, property_id, question_text, question_lang, question_category, next_ping_at)
          SELECT ${A}, code, ${ctx.conversationId}::uuid, ${ctx.leadId}::uuid, ${propId}::uuid, ${q}, ${ctx.leadLanguage}, ${cat}, now()
            FROM next_code
          RETURNING id, short_code
        `);
        const r = (rows as unknown as Array<{ id: string; short_code: number }>)[0];
        await tx.execute(sql`
          INSERT INTO amanda_question_events (agency_id, question_id, event_type, detail)
          VALUES (${A}, ${r.id}::uuid, 'filed', jsonb_build_object('question', ${q}::text))
        `);
        // Mirror into dashboard_tasks so the ticket is visible on /tasks today
        // (the dedicated "Questions from Amanda" surface is the P2 build).
        // task_type 'amanda_question' is NOT 'suggested_reply', so the approve
        // RPC can never send it to the buyer.
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}, 'amanda_question',
            ${'Amanda needs an answer (Q' + r.short_code + ')'}, ${q},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object('amanda_question_id', ${r.id}::uuid, 'short_code', ${r.short_code}::int)
          )
        `);
        await tx.execute(sql`
          INSERT INTO amanda_funnel_events (agency_id, lead_id, conversation_id, property_id, event_type, amanda_attributed, metadata)
          VALUES (${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}::uuid, ${propId}::uuid, 'question_ticket', true, jsonb_build_object('question_id', ${r.id}::uuid))
        `);
        return { ticketId: String(r.id), shortCode: Number(r.short_code) };
      });
      try {
        return await attempt();
      } catch (err) {
        const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
        if (code !== '23505') throw err;
        return attempt();
      }
    },

    async recordLeadIntel(patch: Partial<LeadStateData>): Promise<void> {
      const atISO = new Date(ctx.nowMs()).toISOString();
      await withAgency(A, async (tx) => {
        // Advisory lock closes the read-modify-write race for BOTH the update
        // and the first-write case (SELECT FOR UPDATE can't lock a missing row).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.leadId}))`);
        const rows = await tx.execute(sql`
          SELECT state FROM amanda_lead_state WHERE lead_id = ${ctx.leadId}::uuid
        `);
        const existing = ((rows as unknown as Array<{ state: LeadStateData }>)[0]?.state ?? {}) as LeadStateData;
        const merged = mergeExtraction(existing, patch, atISO, 'engine');
        await tx.execute(sql`
          INSERT INTO amanda_lead_state (lead_id, agency_id, state, updated_at)
          VALUES (${ctx.leadId}::uuid, ${A}, ${JSON.stringify(merged)}::jsonb, now())
          ON CONFLICT (lead_id) DO UPDATE
            SET state = EXCLUDED.state, version = amanda_lead_state.version + 1, updated_at = now()
        `);
        // §11.4 data pack: intel capture is a funnel event (slot keys only, no values).
        await tx.execute(sql`
          INSERT INTO amanda_funnel_events (agency_id, lead_id, conversation_id, event_type, amanda_attributed, metadata)
          VALUES (${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}::uuid, 'intel_captured', true, jsonb_build_object('slots', ${Object.keys(patch).join(',')}::text))
        `);
      });
    },

    async listUpcomingViewings(): Promise<Array<{ id: string; label: string }>> {
      return withAgency(A, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT b.id, b.scheduled_at, p.title, p.external_id AS ref
            FROM bookings b
            LEFT JOIN properties p ON p.id = b.property_id
           WHERE b.lead_id = ${ctx.leadId}::uuid
             AND b.status IN ('requested'::booking_status, 'confirmed'::booking_status, 'rescheduled'::booking_status)
             AND b.scheduled_at > now()
           ORDER BY b.scheduled_at ASC LIMIT 5
        `);
        return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          label: `${slotLabel(Date.parse(String(r.scheduled_at)), ctx.settings.timezone)}${r.title ? ` · ${String(r.title)}` : ''}${r.ref ? ` (${String(r.ref)})` : ''}`,
        }));
      });
    },

    async cancelViewing(bookingId: string): Promise<{ cancelled: boolean }> {
      if (!UUID_RE.test(bookingId)) return { cancelled: false };
      const done = await withAgency(A, async (tx) => {
        // cancel_viewing RPC PERFORMs require_role — the worker tx claims the
        // staff role exactly like the booking path (booking-exec.ts).
        await tx.execute(sql`
          SELECT set_config('app.current_user_role', 'aivena_staff', true),
                 set_config('app.current_user_id', 'amanda_engine', true)
        `);
        await tx.execute(sql`SELECT * FROM cancel_viewing(${bookingId}::uuid, ${'Cancelled by the buyer via Amanda'})`);
        return true;
      });
      // Fire-and-forget calendar cleanup (never blocks the reply) — same path
      // the dashboard cancel uses.
      void deleteCalendarEventForBooking(bookingId, A);
      return { cancelled: done };
    },

    async fileCancelRequest(summary: string): Promise<void> {
      await withAgency(A, async (tx) => {
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}, 'human_review_needed',
            'Buyer wants to cancel a viewing', ${summary.slice(0, 500)},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object('via', 'amanda_engine', 'kind', 'cancel_request')
          )
        `);
      });
    },

    async handoffToHuman(reason: string, summary: string): Promise<void> {
      await withAgency(A, async (tx) => {
        await tx.execute(sql`
          UPDATE conversations
             SET ai_muted_at = now(), ai_muted_by = ${'amanda_engine:' + reason.slice(0, 80)}, updated_at = now()
           WHERE id = ${ctx.conversationId}::uuid
        `);
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}, 'human_review_needed',
            'Amanda handed this conversation to a human', ${summary.slice(0, 800)},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object('reason', ${reason.slice(0, 120)}::text, 'via', 'amanda_engine')
          )
        `);
        await tx.execute(sql`
          INSERT INTO amanda_funnel_events (agency_id, lead_id, conversation_id, event_type, amanda_attributed, metadata)
          VALUES (${A}, ${ctx.leadId}::uuid, ${ctx.conversationId}::uuid, 'handoff', true, jsonb_build_object('reason', ${reason.slice(0, 120)}::text))
        `);
      });
    },
  };
}
