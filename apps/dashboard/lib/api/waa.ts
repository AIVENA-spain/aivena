"use client";

import { useMemo } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * useWAA — read-side data hooks for the AIVENA Assistant (WAA).
 *
 * The 6 WAA RPCs are SECURITY INVOKER, so they apply RLS against the calling
 * user's own session — we call them browser-direct via the existing Supabase
 * browser client. The write/orchestration side (the actual LLM call, audit-log
 * writes, rate limiting, system prompt) lives behind Hono once the Anthropic
 * DPA gate opens; these read hooks stay browser-direct. Clean separation.
 *
 * Every method returns { data, error } with a FRIENDLY error string (Law-2) —
 * raw Postgres errors are logged to the console for debugging, never surfaced.
 */

export type WaaContext = { agency_id: string; user_id: string };

export type WaaLead = {
  id: string;
  full_name: string | null;
  language: string | null;
  status: string | null;
  opt_in_status: string | null;
  last_contact_at: string | null;
  created_at: string;
};

export type WaaLeadDetail = WaaLead & {
  phone: string | null;
  email: string | null;
  source: string | null;
  recent_event_count: number;
  conversation_message_count: number;
};

export type WaaMessage = {
  id: string;
  direction: string;
  message_type: string | null;
  content: string | null;
  sent_at: string | null;
  sent_by: string | null;
  read_at: string | null;
  status: string | null;
};

export type WaaProperty = {
  id: string;
  title: string | null;
  property_type: string | null;
  status: string | null;
  price: number | null;
  price_currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  location_city: string | null;
  location_region: string | null;
};

export type WaaPropertyDetail = WaaProperty & {
  external_id: string | null;
  description: string | null;
  location_country: string | null;
  lat: number | null;
  lng: number | null;
  features: unknown;
  images: unknown;
  source_url: string | null;
  scraped_at: string | null;
};

export type WaaResult<T> = { data: T | null; error: string | null };
export type WaaListResult<T> = { data: T[]; error: string | null };

function logRaw(scope: string, e: unknown) {
  // Debug-only; never returned to the user.
  if (e) console.error(`[WAA] ${scope}`, e);
}

export function useWAA() {
  const supabase = useMemo(() => createClient(), []);

  return useMemo(
    () => ({
      /** Establish + validate the caller's agency/user context (first RPC). */
      async requireContext(): Promise<WaaResult<WaaContext>> {
        const { data, error } = await supabase.rpc("waa_require_context");
        if (error) {
          logRaw("requireContext", error);
          return { data: null, error: "Couldn't load your workspace. Please refresh and try again." };
        }
        const row = (Array.isArray(data) ? data[0] : data) as WaaContext | undefined;
        return row
          ? { data: row, error: null }
          : { data: null, error: "No workspace is linked to your account yet." };
      },

      async searchLeads(filter: Record<string, unknown> = {}, limit = 10): Promise<WaaListResult<WaaLead>> {
        const { data, error } = await supabase.rpc("waa_search_leads", { p_filter: filter, p_limit: limit });
        if (error) {
          logRaw("searchLeads", error);
          return { data: [], error: "Couldn't search leads right now." };
        }
        return { data: (data as WaaLead[]) ?? [], error: null };
      },

      async getLeadDetail(leadId: string): Promise<WaaResult<WaaLeadDetail>> {
        const { data, error } = await supabase.rpc("waa_get_lead_detail", { p_lead_id: leadId });
        if (error) {
          logRaw("getLeadDetail", error);
          return { data: null, error: "Couldn't open that lead right now." };
        }
        const row = (Array.isArray(data) ? data[0] : data) as WaaLeadDetail | undefined;
        return { data: row ?? null, error: row ? null : "That lead wasn't found." };
      },

      async getConversation(leadId: string, limit = 30): Promise<WaaListResult<WaaMessage>> {
        const { data, error } = await supabase.rpc("waa_get_conversation", { p_lead_id: leadId, p_limit: limit });
        if (error) {
          logRaw("getConversation", error);
          return { data: [], error: "Couldn't load that conversation right now." };
        }
        return { data: (data as WaaMessage[]) ?? [], error: null };
      },

      async searchProperties(filter: Record<string, unknown> = {}, limit = 10): Promise<WaaListResult<WaaProperty>> {
        const { data, error } = await supabase.rpc("waa_search_properties", { p_filter: filter, p_limit: limit });
        if (error) {
          logRaw("searchProperties", error);
          return { data: [], error: "Couldn't search properties right now." };
        }
        return { data: (data as WaaProperty[]) ?? [], error: null };
      },

      async getPropertyDetail(propertyId: string): Promise<WaaResult<WaaPropertyDetail>> {
        const { data, error } = await supabase.rpc("waa_get_property_detail", { p_property_id: propertyId });
        if (error) {
          logRaw("getPropertyDetail", error);
          return { data: null, error: "Couldn't open that property right now." };
        }
        const row = (Array.isArray(data) ? data[0] : data) as WaaPropertyDetail | undefined;
        return { data: row ?? null, error: row ? null : "That property wasn't found." };
      },
    }),
    [supabase],
  );
}
