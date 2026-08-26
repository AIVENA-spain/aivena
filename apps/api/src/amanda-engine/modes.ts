// Amanda auto-mode engine — tool-layer mode enforcement (design §4: "Mode
// enforced in the tool layer, not the prompt").
//
// The dial: off → shadow → approval → assisted → full. The MODEL never sees the
// mode; it always "acts". What its action tools actually DO is decided here,
// deterministically, per (mode × tool class):
//   - SHADOW:   action tools return simulated "would have done X" results.
//               ZERO writes besides conversation/telemetry — enforced by the
//               structural test in modes.test.ts, not by convention.
//   - APPROVAL: replies become drafts; action tools return "queued as draft".
//   - ASSISTED: conversational replies may send; commitment-class actions
//               (booking family) queue for one-tap agent approval.
//   - FULL:     validator-gated real execution.
//   - OFF / unknown / missing: FAIL CLOSED — nothing executes, nothing sends.
//
// ask_agency and handoff_to_human are internal-write tools (they send nothing
// to the buyer themselves), so they execute for real in every live mode and are
// simulated only in SHADOW (design §3b: "the ticket is still created for real"
// applies from APPROVAL upward).

export const AMANDA_MODES = ['off', 'shadow', 'approval', 'assisted', 'full'] as const;
export type AmandaMode = (typeof AMANDA_MODES)[number];

export function parseAmandaMode(raw: unknown): AmandaMode {
  return AMANDA_MODES.includes(raw as AmandaMode) ? (raw as AmandaMode) : 'off';
}

// Tool classes decide dispatch; individual tools declare membership once.
export type ToolClass =
  | 'read'            // search_properties, get_property_details, get_lead_profile, get_area_info...
  | 'reply'           // the outbound conversational message itself
  | 'commitment'      // book_viewing, reschedule_viewing, cancel_viewing
  | 'internal_write'  // ask_agency, handoff_to_human, cannot_answer, lead-state updates
  ;

export type DispatchDecision =
  | { kind: 'execute' }                          // run the real effect
  | { kind: 'simulate' }                         // return a synthetic result; no effect
  | { kind: 'queue_draft' }                      // store as draft for agent approval
  | { kind: 'queue_one_tap' }                    // store as pending one-tap action
  | { kind: 'refuse'; reason: string }           // fail closed
  ;

/**
 * The single deterministic authority for what a tool call may do in a mode.
 * Every action tool MUST route through this before touching its real effect.
 */
export function dispatchDecision(mode: AmandaMode, toolClass: ToolClass): DispatchDecision {
  switch (mode) {
    case 'shadow':
      // Reads are safe and needed for realistic drafts; everything else simulates.
      return toolClass === 'read' ? { kind: 'execute' } : { kind: 'simulate' };
    case 'approval':
      if (toolClass === 'read' || toolClass === 'internal_write') return { kind: 'execute' };
      if (toolClass === 'reply') return { kind: 'queue_draft' };
      return { kind: 'queue_draft' };            // commitment actions ride the draft too
    case 'assisted':
      if (toolClass === 'commitment') return { kind: 'queue_one_tap' };
      return { kind: 'execute' };
    case 'full':
      return { kind: 'execute' };
    case 'off':
      return { kind: 'refuse', reason: 'amanda_mode_off' };
    default: {
      // Unreachable via parseAmandaMode, but the tool layer fails closed anyway.
      const _exhaustive: never = mode;
      return { kind: 'refuse', reason: `unknown_mode:${String(_exhaustive)}` };
    }
  }
}

export interface ToolResult {
  ok: boolean;
  simulated: boolean;
  queued: 'draft' | 'one_tap' | null;
  refused: string | null;
  data: unknown;
}

/**
 * Wrap a real effect so the mode decides whether it runs. `executeReal` is the
 * ONLY path to side effects; simulate/queue/refuse never invoke it — that is
 * the structural guarantee the shadow-mode test pins.
 */
export async function runActionTool<T>(
  mode: AmandaMode,
  toolClass: ToolClass,
  executeReal: () => Promise<T>,
  opts?: {
    simulatedData?: unknown;                     // what the model sees in shadow
    queue?: (kind: 'draft' | 'one_tap') => Promise<unknown>;
  },
): Promise<ToolResult> {
  const decision = dispatchDecision(mode, toolClass);
  switch (decision.kind) {
    case 'execute':
      return { ok: true, simulated: false, queued: null, refused: null, data: await executeReal() };
    case 'simulate':
      return { ok: true, simulated: true, queued: null, refused: null, data: opts?.simulatedData ?? { simulated: true } };
    case 'queue_draft':
    case 'queue_one_tap': {
      const kind = decision.kind === 'queue_draft' ? 'draft' : 'one_tap';
      const data = opts?.queue ? await opts.queue(kind) : { queued: kind };
      return { ok: true, simulated: false, queued: kind, refused: null, data };
    }
    case 'refuse':
      return { ok: false, simulated: false, queued: null, refused: decision.reason, data: null };
  }
}
