# Amanda Operating Model

> **Status: CANONICAL PRODUCT / ARCHITECTURE DIRECTION.**
> **Implementation: PARTIAL** — only what Part A lists exists. Part B is a gate and Part C is target:
> nothing in Part B or Part C exists unless Part A says so.
> **Current production truth is governed by `FEATURE_STATUS`, `SYSTEM_MAP` and `LAUNCH_READINESS`**
> (the control docs in the AIVENA docs folder), never by this document. Where this document and a
> control doc disagree about what runs today, the control doc wins and this document is corrected.
>
> The three control docs live outside this repository and are not published. From this repository
> alone a reader can check the code on `origin/main` and the label definitions and registered rows
> in `apps/dashboard/lib/feature-truth.json`. A Part A line whose evidence is a control doc, the
> changelog, a live check or the private audit record is the audit session's dated statement, not
> something this repository proves.
>
> Owner: the audit / control-tower session writes it; Christian approves every change.
> Direction adopted by Christian on 2026-09-21. This document was created and first committed on
> 2026-09-22, the day the Launch Readiness decisions register received D-59 to D-63.

## 0. How to read this document

Parts A, B and C each carry one label at their head; a line inside a Part that differs says so in
the line itself. Part D is lineage and carries no label.

| Label | Meaning |
|---|---|
| **VERIFIED CURRENT** | Proven in the code on `origin/main` (commit `64ff11b`) or in the live system on the date given, with the evidence named. A label qualifies the statement, not the capability: a VERIFIED CURRENT line may verify that something exists in code and has never run, and then it says so. **"Exists in code" never means "works".** |
| **TARGET** | The agreed direction. Not built. Nothing in a TARGET section may be presented to an agency, on a screen or in marketing, as existing. |
| **GATED — NOT IMPLEMENTED** | A TARGET whose implementation may not start until the pre-memory gate in Part B is closed and the closure is independently verified. |

Three documents own the adjacent facts and are linked from here. Part A is a snapshot for
orientation, not a second home for production evidence: exact counts, timestamps and incident
narratives live with their owners, and `FEATURE_STATUS` wins whenever a label here and a label
there differ.

- `FEATURE_STATUS.md` owns the evidence label of every feature. The eight labels are named in
  CLAUDE.md and defined in `apps/dashboard/lib/feature-truth.json` (enforced by
  `tools/feature-truth-lint.mjs`). Part A quotes three of them; they grade a feature's evidence in
  that registry, not a statement here: `FALSE_UI_CLAIM` — the interface says or implies something
  untrue, fixed now and never parked; `PARTIAL_UNPROVEN` — parts exist, the path is not proven;
  `EXISTS_BUT_NOT_WIRED` — code exists, no product path reaches it.
- `SYSTEM_MAP.md` owns where things run, how a message flows and the permission layers.
- `LAUNCH_READINESS.md` owns the gates, including the private pre-memory gate set behind Part B,
  and Christian's decisions register.

The private audit / control-tower record owns the detailed security findings behind Part B. They
are deliberately not reproduced here: this repository is public.

The build-time design of the current engine is `DESIGN_v1.2_2026-08-26.md` in this folder, a
snapshot of the Packet 2 design document in the docs folder taken at build start (both are frozen).
This document supersedes it for every question about what Amanda is meant to become; it does not
replace it as the record of how the current engine was specified. Direction changes here, never there.

---

## PART A — CURRENT VERIFIED STATE (snapshot, 2026-09-22)

Everything in Part A is **VERIFIED CURRENT** unless a line says otherwise. Sources: code on
`origin/main` at `64ff11b`; read-only production checks by the audit session on 2026-09-21; the
control docs (`FEATURE_STATUS` truth dated 2026-09-15 unless stated). Code paths are under
`apps/api/src/amanda-engine/` unless another folder is given. This Part states what exists and what
does not; the numbers that prove it belong to the control docs and the changelog.

### A1. What Amanda is today

Amanda is a WhatsApp reply engine running in **full automation on one demo agency**, which is a
controlled automation test rig, not a real agency. **No real agency is live.** She answers buyers
about the demo catalogue, files questions to the office, escalates to a person and proposes viewing
slots. She does not complete a viewing booking on her own (A5), does not schedule follow-ups (A5),
and has no persistent memory beyond the mechanisms in A3.

- Channel: WhatsApp via Twilio, inbound through an Edge Function, outbound through the send queue.
  Email is not handled by the Amanda engine (`FEATURE_STATUS` labels email `FALSE_UI_CLAIM`, inbound
  inert). The website chat backend exists but is gated to test agencies (`FEATURE_STATUS`).
- Runtime: one Railway worker process polls the inbound queue every 5 seconds
  (`AMANDA_ENGINE_TICK_MS` in `apps/api/src/index.ts`; `SYSTEM_MAP` §2).
- Automation levels: `off` / `shadow` / `approval` / `assisted` / `full`. **Only `full` has ever been
  live-tested.** The other tiers exist in code and are labelled `PARTIAL_UNPROVEN` in
  `FEATURE_STATUS`, which owns the label.

### A2. How a turn flows

The mechanism is documented in `SYSTEM_MAP` §4.1 and is not repeated here. What matters for this
document:

- The agency of a turn is fixed **by the system from the inbound queue row** before the model is
  called, and every database read and write of the turn runs inside a short transaction that sets
  that agency first (`withAgency` in `packages/db/client.ts`, used throughout `process-turn-db.ts`
  and `backends-db.ts`). No transaction is held open across a model call.
- The model never chooses an agency. Whether every path already meets the isolation target in C9 is
  the question of the private pre-memory gate set (Part B).
- The model runs an agentic loop with a hard iteration cap (`agent-loop.ts`). At the cap, or when the
  model stops after tool work without writing text, one final tools-free call asks it to answer from
  the facts its lookups returned; that reply passes the same validators and gates as any draft. Only
  if that also yields nothing does the turn escalate as an empty draft and the deterministic holding
  line goes out. Text the model wrote before a lookup is never sent.

### A3. What Amanda knows at the start of a turn

| Context source | Today | Evidence |
|---|---|---|
| Recent messages | A fixed window of the most recent prior messages, each truncated (`prompt.ts`: `MAX_TURNS`, `MAX_TURN_CHARS`). Anything older is invisible. | `process-turn-db.ts`, `prompt.ts` |
| Buyer profile (`amanda_lead_state`) | Exists and is written by the `record_lead_intel` tool, but is **effectively unused in practice**: the live profile has not grown since the rig's first days. Why (disuse or a silently failing write) is unknown and is part of the pending diagnostic (A7). | DB read 2026-09-21; `backends-db.ts` |
| Agency knowledge notes (`agency_amanda_knowledge`) | A screened, agency-scoped notes table loaded into the prompt with a size cap. **Unused live.** No property scope, no expiry, no reuse path; a superseded-by column exists that no code writes. | DB read 2026-09-21; `knowledge-scrub.ts`, `prompt.ts` |
| Office questions (`amanda_questions`) | Only open questions are loaded, as a "still waiting" note. **Answered questions are never loaded as facts**, so a fact the agency already supplied is effectively invisible once its question closes. | `process-turn-db.ts` |
| Pending work | Carried for two objects only: unexpired viewing-slot proposals and the open office questions above. | `process-turn-db.ts` |
| Property facts | Retrieved per turn by tool from the catalogue; the engine's catalogue reads select no coordinate or address column. | `backends-db.ts` |
| Researched facts, agent-supplied facts, promises, case state | **Not carried between turns.** | code |

### A4. Where Amanda stands on the capability ladder

The ladder is defined in Part C (C3). This is where the current engine sits on it.

| Rung | Today |
|---|---|
| **A — already known from conversation / saved state** | **Weakest rung** (A3): a short message window, an unused profile, answered questions not reused. |
| **B — available in agency / AIVENA data** | Catalogue tools exist and run; whether their answers are correct is not measured (A7). Fails for facts the agency already gave through an office question. Two tool descriptions promise more than they return (`search_properties`, `get_property_details`; C8). |
| **C — computable or researchable** | `research_area` exists (model plus web search, output-screened) behind a deterministic screen (`research-screen.ts`) that refuses two classes: looking up a private person, and describing an area by its residents' race, religion, nationality or ethnicity. The legal / tax / mortgage / immigration exclusion is tool-description text only, not enforced. Distances and travel times are **not** computed from any geographic source. `get_area_info` describes itself as an area guide but returns a listing count (C8). |
| **D — needs one piece of human knowledge** | `ask_agency` files a durable question with the property attached and does **not** pause Amanda. An agent-ping spine exists (roster, picker, sender, re-ping cap, event log). **The agent WhatsApp round-trip is not live-proven: no ping has ever been delivered** (`FEATURE_STATUS`, agent pings, `EXISTS_BUT_NOT_WIRED`). |
| **E — true human takeover** | Amanda pauses until a person hands the conversation back, on any of four stops (`pause-lib.ts`, `3056bf4`, D-56); exercised live by the audit session (its changelog entry). `FEATURE_STATUS` carries no row for the pause yet; its nearest row is `PARTIAL_UNPROVEN`, and that label stands until the registry is updated. |

**Engine escalation and takeover are not separated in the product.** A gate failure or an empty
draft files the same human-review task as a real `handoff_to_human` takeover, and both pause Amanda;
they differ only in what the buyer receives. A filed office question (rung D) is separated and does
not pause her. What is not separated is "the engine could not finish" — often a rung-D need for one
fact — from a true rung-E takeover. Part C separates D (keep the conversation) from E (pause); where
an engine escalation belongs is a design decision C6 still owes.

### A5. What Amanda does not do today (so nobody claims it)

- **Autonomous buyer viewing booking does not currently work.** A buyer confirming a proposed slot in
  plain text has never completed a booking in any engine version. The booking executor exists in code
  (`booking-exec.ts`) and has never been proven end to end; a button confirmation is half-built (the
  inbound half exists, no outbound path has ever sent a button). This is a latent design gap since the
  engine's first version, not a regression (audit verdict 2026-09-20, changelog). Public-site and
  dashboard copy were corrected and deployed on 2026-09-20 (`2e51640`, `64ff11b`; deploy identities in
  the changelog). `SYSTEM_MAP` and the changelog own live deploy state.
- **Automatic follow-ups:** no product path schedules one (`FEATURE_STATUS`, `EXISTS_BUT_NOT_WIRED`).
- **Future promises:** an interim guard (`validators.ts`) blocks every promise of Amanda's **own**
  later action, because nothing exists that would wake her. An **office** promise ("I'll check with
  the office") is permitted only in a turn where an office question was filed, is still open, or is
  being answered. The guard is a safety mechanism, not the intended behaviour (C7).
- **Persistent structured case state and a Knowledge Bank:** do not exist (A3). Their implementation
  is gated (Part B).

### A6. Multi-agency isolation as it stands

- **Engine and API role.** Tenant isolation for the engine/API database role is primarily enforced by
  applicable agency-scoped row-level-security policies and a role that cannot bypass RLS. The agency
  in the session context is set by the system from the inbound row before each transaction (A2). FORCE
  RLS is enabled on the core Amanda tables and provides additional owner-level enforcement, but it is
  not the sole or load-bearing boundary for the engine role. A missing agency context yields no rows
  (fail-closed), not all rows. Verified live by the audit session on 2026-09-21; the per-table facts
  are owned by `SYSTEM_MAP` §6 (Permission layers), which is to be updated to carry them.
- **Elevated paths.** Edge Functions using the service role, and database functions that run with
  their owner's privileges, are not fenced by those policies; each relies on its own checks. The
  2026-09-21 review found unresolved tenant-isolation gaps; they are recorded in the private gate set
  and audit record (Part B), not here.
- **Adversarial coverage.** A two-agency adversarial tenancy suite is designed and has not been run;
  no engine or tenancy test runs in CI today (`ci.yml` is manual-trigger only; the only automatic
  workflow is the feature-truth lint). It is not the
  test-rig rehearsal that `LAUNCH_READINESS` gate G1 also numbers T1–T9; the two share numbering only.

### A7. Quality: what is measured today

No quality metric has a baseline. Per-turn telemetry records what a turn did (outcome, gate
failures, tool-call count, tokens, latency), not whether an escalation or a clarification was
necessary, so none of the C10 metrics or invariants is measured. A bounded diagnostic replay of the
September failures and an offline evaluation set are prepared and pending. Until a baseline exists,
every reliability claim about Amanda is **unknown**, not fine.

---

## PART B — THE PRE-MEMORY GATE

**The capabilities this gate holds back — persistent structured case state (C4), the Knowledge Bank
(C5), the durable quick-question record (C6) and durable promises (C7) — are GATED — NOT
IMPLEMENTED.** The gate itself is stated here only at the level of truth this public document may
carry.

### B1. The gate truth

- The multi-agency architecture review of 2026-09-21 returned the verdict
  **EXTEND_ONLY_AFTER_GAPS_CLOSE**: the shape is right (the system, never the model, decides the
  agency; engine retrieval is fenced by verified RLS), but unresolved tenant-isolation gaps exist
  outside that fence.
- **No persistent buyer memory, no Knowledge Bank and no durable quick-question state goes live until
  the private pre-memory gate set is closed and independently verified** by the audit session
  (Christian, 2026-09-21, D-59). Those gaps are architectural prerequisites for durable memory, not
  general clean-up.
- Each production fix reaches production only as an individually reviewed and approved diff.
- Closure is proven, not asserted: by reviewed diffs and by a two-agency adversarial tenancy suite
  that starts with a policy drift check against production, so a local pass with weaker policies is
  a failure, not a success (D-60).
- Agent replies to quick-question pings are to bind only to the exact quoted ping, and unquoted
  replies are to be refused even when only one question is open (D-61, a rule binding the C6 build).

### B2. Where the detail lives

The gate set (each requirement, its current status, the evidence that closes it) is recorded under
gate G6 of `LAUNCH_READINESS.md`. The findings behind it (exact seams, routes, mechanics,
remediation evidence) are in the private audit record. Neither is published, and this document does
not enumerate which controls currently fall short.

### B3. The controlled build sequence

Christian's sequence, unchanged by this document. The architecture is designed toward the north-star
now; that is not permission to build everything at once, and nothing later in the list starts because
an earlier item became clear.

1. The bounded reliability diagnostic (replay of the September failures).
2. Exact root cause and the reliability checkpoint. The checkpoint must state explicitly whether the
   proposed context/state foundation moves Amanda toward the north-star of C1 and can later carry
   every field of the C4 case state, so that the design chosen now does not paint us into a corner. A
   narrow patch that resolves the September failures without that foundation is recorded as a patch,
   not as progress toward the north-star.
3. The context-memory recommendation (the C4 case state is the shape it must fit).
4. A realistic evaluation baseline with the C10 metrics and invariants.
5. The smallest safe engine fixes.
6. The pre-memory gate set, each fix as a reviewed diff.
7. **Only then**: approval to implement persistent memory and the Knowledge Bank.

Position as of 2026-09-22: step 1 has not run (A7); the gate set in step 6 is not met; the approval in
step 7 has not been given. Preparatory artefacts exist without closing anything (the evaluation set
for step 4 and the tenancy suite for step 6, neither run).

---

## PART C — TARGET OPERATING MODEL / NORTH-STAR

**All of Part C is TARGET.** It describes what Amanda is to become. It grants no capability. Where a
section has a current counterpart, a "Today" line points at Part A so the two are never confused.

### C1. The north-star

Amanda is intended to behave like a highly capable real-estate employee for each individual agency:

> A resourceful real-estate agent who remembers the buyer and property context, uses agency data and
> available tools to find answers herself, asks a human only when the information genuinely cannot be
> determined safely, and remains responsible for the conversation until a true takeover is required.

She is to: remember buyer and property context · use information already available before asking
again · investigate objective facts herself · ask humans only when genuinely necessary · remain
responsible for the conversation while waiting on a small human answer · use true takeover only when
required · learn reusable agency and property knowledge over time · never fabricate · never mix
agencies.

The goal is not "make her safe by handing everything to a human". That would destroy the product.
Her intelligence is to come from having more ways to actually find things out, not from letting the
model invent connections. **Be resourceful before escalating, but never fabricate.**

*Today: A1, A4.*

### C2. The core distinction

> **"Amanda does not already know" is not "Amanda cannot find out."**

Not knowing immediately is never an escalation reason. For a nearby school she is to research; for a
distance, calculate; for a listing fact, check the catalogue; for conversation context, remember; for
agency knowledge, check what the agency has already told her; for information only the listing agent
holds, ask that agent a small question; for risky legal, financial or contractual decisions, stay
within stricter boundaries (C8).

### C3. The capability ladder

Five rungs, to be tried in order. **D and E are different states and must never collapse into one
"escalation".**

| Rung | Situation | Amanda is to |
|---|---|---|
| **A** | Already known from the conversation or saved case state | Answer. |
| **B** | Available in agency or AIVENA data (catalogue, CRM, viewing availability, previous messages, agency instructions, saved facts) | Retrieve and answer. |
| **C** | Objectively computable or researchable from a trusted source (distances, travel times, nearby schools, beaches, airports, opening hours, public facts) | Investigate and answer, citing the source. |
| **D** | Exists only with a human (would the owner accept an offer; can we view at 8 on Sunday; why are the owners selling; has the community approved the terrace enclosure) | Ask the right agent a small, structured question **while keeping the conversation**. |
| **E** | High-risk or relationship-sensitive; a person must own the relationship or make a sensitive decision | Hand over: true human takeover. Amanda pauses (D-56). |

The executable retrieval order behind rungs A–C — the sequence to be checked before she researches or
asks anyone: conversation / case state → verified property knowledge → agency Knowledge Bank → AIVENA
internal data → trusted research or computation → structured quick question to an agent (D) → true
takeover (E).

*Today: A4 (rung A weakest; D and E not separated for engine escalations).*

### C4. Structured case state — GATED — NOT IMPLEMENTED

The LLM is to reason over **structured state**, not reconstruct everything from raw chat history on
every turn. The persistent case state must be able to represent, per conversation and always bound to
one agency:

1. agency identity
2. buyer / lead
3. active property
4. previously discussed properties
5. buyer requirements and preferences
6. answered questions
7. unanswered questions
8. viewing proposals
9. pending actions
10. pending agent questions
11. outstanding promises
12. conversation summary / state
13. takeover state

Agent-supplied facts and researched facts with their sources are to be referenced from the case state
by identity (they live in the Knowledge Bank, C5) so that memory and knowledge do not diverge. Buyer
identity is to be one lead per agency with a deterministic merge rule and an audit trail; memory is
never keyed by phone number or name.

*Today: A3 (no case state; an unused lead profile).*

### C5. Persistent Knowledge Bank — GATED — NOT IMPLEMENTED

Amanda is to learn appropriate reusable facts permanently. **This is explicit AIVENA data, never "the
LLM remembers."**

Required scopes: **platform / public** · **agency** · **property** · **buyer / conversation**.

Every reusable fact is to carry provenance: scope · agency · property where applicable · source
(catalogue / agent / research / system) · source person when a human supplied it · timestamp ·
confidence or verification level · expiry or review date where appropriate · whether Amanda may reuse
it autonomously · a link to the original question and answer where relevant · superseded-by and
history when the fact changes.

Rules:

- Long-lived facts (address, plot, parking, orientation, community rules, procedures, listing-agent
  assignment) may become reusable. Time-sensitive facts (price, availability, seller willingness,
  fees, viewing restrictions) carry an expiry and are reconfirmed.
- **Never auto-promoted:** temporary negotiation comments, subjective opinions, uncertain agent
  remarks, anything about another buyer, anything an agent says about a person.
- New verified information supersedes old information **without deleting the audit history**; the
  bank must support expiry, contradiction and supersession.
- Retrieval is to be scoped to the agency **before** any similarity or search step (C9). A fact
  learned in one agency must be technically unreachable from another.
- Before researching externally or asking an agent, Amanda is always to check, in order: the current
  conversation and case state · verified property knowledge · verified agency knowledge · previously
  learned agent-supplied facts · reusable researched facts where appropriate.

Worked example (**cannot happen today**): a buyer asks whether a pool gets sun in winter. Amanda
cannot establish it safely, so she asks the listing agent (C6). The agent answers "roughly 11:00 to
16:00 in winter". Amanda answers the buyer and, because it is a long-lived property fact from a named
agent, records it with its provenance. The next buyer who asks gets the answer immediately and the
agent is not asked again.

*Today: A3 (an agency-scoped notes table, unused; no property scope, no expiry, no reuse path).*

### C6. Agent quick-question model

The path for rung D, and the part of AIVENA that should feel most unlike a normal "AI to human
hand-off". The durable record it needs is **GATED — NOT IMPLEMENTED** (Part B); the flow it is to run:

buyer asks something Amanda genuinely cannot determine → a **durable pending-question record** is
created → structurally bound to the exact agency, conversation, property (if applicable), intended
agent and a unique question id → a concise **WhatsApp** ping to the relevant agent, carrying the
minimum the agent needs (property reference, the question, at most the buyer's first name; never the
buyer's number or the conversation) → the agent replies **to that exact ping** → the answer resolves
the exact pending question → Amanda wakes → the buyer gets the answer → where appropriate the fact
enters the Knowledge Bank.

- **WhatsApp is the intended primary quick-answer channel (TARGET).** The dashboard is to mirror the
  question, assigned agent, status, answer, provenance and timestamps, and is the fallback only when
  WhatsApp delivery is unavailable. An agent must never have to open the dashboard to answer a simple
  question. Pilot scope is owned by the Launch Readiness register (D-63: quick-question pings enter
  pilot scope once the required binding and tenancy gates are closed and the round-trip is
  live-proven), not by this document.
- **Binding is structural, never by timing, fuzzy text or "the most recent open question."** The rule
  (D-61): quoted ping → exact message id → exact question id → exact agency, agent, conversation,
  property → resolve. No quote → do not guess → ask the agent to reply to the ping.
- **A quick fact request is not a human takeover.** It is to have its own state and never inherit
  the D-56 pause. While waiting, Amanda stays active: "I'm checking that with the agent now — is
  there anything else you'd like to know about the property or the area meanwhile?" That sentence is
  permitted only when the pending-question object actually exists and can wake her (C7).
- **Two states on every surface.** The agency-facing product must show a pending quick question
  (Amanda still handling, waiting on one fact) and a takeover (a person owns this, Amanda paused) as
  two distinct states, never one undifferentiated "needs a human" queue; a buyer must never receive
  the takeover holding line while a quick question is what is actually pending. Which of the two
  states an engine escalation (gate failure, empty draft) belongs to is a design decision still owed.
- **Regression guard (TARGET — not yet written).** A test that filing a pending question leaves all
  four D-56 pause fields untouched, and that a true takeover sets exactly one. Today the separation
  rests on convention: `ask_agency` writes none of the four, but no test covers the filing path.
- The agent is not asked to "take over this lead"; the agent gets "quick question: does the owner
  accept pets?", answers in seconds and goes back to work.
- Design decisions still owed before implementation: agent assignment rule (listing agent first, then
  language and shift), fallback when no listing agent exists (the question stays with the office and
  the buyer is told honestly), expiry and unanswered behaviour, duplicate answers, reassignment,
  wrong-agent protection (roster check immediately before send and again on reply), audit trail.
  The durable record is to be built as an **extension of the existing questions table**, not a
  parallel object.

*Today: A4 rung D (question record and ping spine exist; the round-trip is not live-proven; engine
escalations and takeovers share one queue).*

### C7. Durable future promises — GATED — NOT IMPLEMENTED

Amanda may promise a future action **only when a durable pending-work object exists that can actually
complete or resume the work**: a pending agent question, a scheduled follow-up, a pending research
job, a pending booking or action. The permitted sentence is tied to the object type.

The current guard that blocks "I'll check and come back" is an **interim safety mechanism**, not the
final product behaviour. Once the durable mechanism exists and is proven, Amanda is again to be
allowed to say naturally that she will check and return, because the system guarantees the return.
The reverse also holds: if a pending object exists, the buyer is told once.

*Today: A5 (own-action promises blocked; office promises allowed only behind a filed question).*

### C8. Research: objective and grounded

Amanda is to be resourceful with objective, source-grounded questions: distance, travel time, nearby
schools, supermarkets, hospitals, beaches, airports, factual location and opening information, other
source-citable facts. Every researched answer must be grounded in an actual tool result and the source
recorded with the fact.

For subjective questions ("is this a nice area?", "is it safe?") she must not invent a lifestyle
judgement. She is to give useful sourced facts (amenities, transport, distances, schools) and qualify
any conclusion.

**Regulated topics.** Amanda must not provide personalised legal, tax, mortgage, immigration or
licensing advice from open-ended research. She may provide objective factual information from
explicitly approved official or agency sources where product policy permits it. If the question
requires interpretation, individualised advice, a legal conclusion, or information she cannot
establish safely, she asks the appropriate human or qualified source.

**Tool honesty:** a tool's name and description must match its real capability. Tools whose
descriptions promise more than they return are to be fixed or renamed before the model is asked to
rely on them; A4 names the three current cases (`get_area_info`, `search_properties`,
`get_property_details`), all open, and the model already relies on them on the rig.

*Today: A4 rung C (web research exists behind a deterministic screen for two refused classes; the
regulated-topic exclusion is description text only, and no approved-source list exists; no geographic
computation; three tool-honesty cases open).*

### C9. Multi-agency isolation: a structural boundary, not a prompt

Non-negotiable, and part of the canonical model since the tenancy review of 2026-09-21. These are
architectural requirements; nothing in this section is evidence that a requirement holds today —
A6 records the current position and Part B the gate.

- **The system, never the LLM, determines the agency before any retrieval or action.** Amanda is
  handed only that agency's permitted context; she is never asked to "ignore other agencies".
- **Cross-agency leakage target: zero.** Agency knowledge, property facts, buyer memory, pending
  questions, bookings and actions must remain structurally tenant-bound.
- **Scope at retrieval.** Knowledge retrieval, including any semantic search, must filter by agency
  before similarity, never globally followed by a filter.
- **Consistency must be validated where participating objects exist:**
  `conversation.agency_id = lead.agency_id = property.agency_id = agent.agency_id = pending_action.agency_id`,
  and any mismatch fails closed.
- Recipient verification must happen immediately before any send to an agent or a buyer.
- Privileged database functions that touch tenant data must read the agency from the session context
  and validate cross-object agency equality inside the function.
- The two-agency adversarial suite must run before every release, starting with a policy drift check
  against production. The bar in every assertion: the other agency's data must be **absent, not
  merely unused**.

*Today: A6.*

### C10. Quality metrics and hard invariants

First-class capability metrics (targets before the pilot):

- **Unnecessary human escalation ≤ 3%** — Amanda asked a human for something she could reasonably
  have obtained from rungs A–C.
- **Unnecessary buyer clarification ≤ 2%** — Amanda asked the buyer for information already available
  in the case state, CRM, catalogue, agency knowledge or another approved source. Canonical failure:
  asking a buyer for a price range the agency had already given (September 2026, on the rig).

Hard invariants — required value zero, on the rig and for any real agency; unlike the two metrics
they are never traded:

- cross-agency leakage or action = **0**
- wrong-property or wrong-context consequential action = **0**
- fabricated grounded fact = **0**
- future-action promise without durable work behind it = **0**

Part A (A7) records that none of the metrics or invariants has a baseline today: this section states
what must hold, not what has been measured.

**Escalation metrics must never be improved by making Amanda more willing to guess.** Escalating
less while hallucinating more is a failure, not an improvement; the evaluation is to report the two
metrics and the four invariants together, and an improvement in one metric with any invariant
non-zero is a regression.

### C11. Implementation split

| The LLM owns | AIVENA owns, deterministically |
|---|---|
| understanding language | tenancy |
| flexible reasoning | identity |
| conversational behaviour | permissions |
| selecting useful capabilities and tools | structured state |
| | persistent memory |
| | fact provenance |
| | property consistency |
| | pending work |
| | recipient validation |
| | bookings and actions |
| | durable promises |
| | audit trail |

The model proposes; deterministic code disposes. Nothing on the right-hand side is ever to be left to
the model's judgement. *Today: tenancy follows the shape on the engine path — the system fixes the
agency from the inbound row (A2). Identity does not yet: buyer identity (one lead per agency, merge
rule, audit trail) is C4, GATED. Every other row of the right-hand column is a requirement, not a
status: what exists today of each is only what Part A describes, and none is claimed to meet its
requirement.*

### C12. What this model does not promise

- It does not claim autonomous viewing booking. The claim may be made only when the full path is
  proven end to end on the rig, with the consistency guard of C9 in front of it.
- It does not claim persistent memory or a Knowledge Bank exist (Part B).
- It does not permit a prompt-only rule to stand in for a deterministic responsibility in C11.
- It does not permit any screen, tile or marketing line to describe a TARGET as a capability. The
  three governing laws in CLAUDE.md apply: real data or an honest empty state; no dead controls;
  friendly errors, honest logs.

---

## PART D — LINEAGE

Inputs, linked rather than copied:

- `DESIGN_v1.2_2026-08-26.md` (this folder; a snapshot of the frozen Packet 2 design document in the
  docs folder): the build-time spec of the current engine. Its §1 three-layer memory and §3
  escalation and ping spine are the ancestors of C4 and C6.
- Christian's north-star statement (2026-09-20) and his adoption decisions (2026-09-21), recorded in
  the Launch Readiness decisions register as D-59 to D-63 on 2026-09-22 (the ids cited above).
- The Amanda engine vs buyer-research gap map (2026-08-28) and the buyer-conversation research it
  answers (docs folder).
- The Packet 2 reliability plan and north-star capability-ladder design (2026-09-19 to 2026-09-21),
  which carry the requirement ids the audit review assigned and the tenancy suite T1–T9.
- The multi-agency architecture review (audit session, 2026-09-21): verdict
  EXTEND_ONLY_AFTER_GAPS_CLOSE, with production verification of the role and policy facts in A6.
  Detailed findings are private.
- The booking provenance verdict (audit session, 2026-09-20): latent since the first engine version;
  not a regression.

Change log of this document:

| Date | Change | Approved by |
|---|---|---|
| 2026-09-22 | Created and first committed. Direction adopted 2026-09-21. Parts A–D with status labels; Part B at the high-level gate truth only; Part A as a snapshot, not an evidence store. Reviewed by two adversarial passes before commit. | Christian |
