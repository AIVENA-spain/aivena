# Amanda auto-mode — docs

**`OPERATING_MODEL.md` is the CANONICAL Amanda operating model** (product / architecture direction; implementation PARTIAL; every statement labelled VERIFIED CURRENT / TARGET / GATED). Read it before any Amanda design, memory or reliability work. Current production truth is governed by the control docs (Feature Status, System Map, Launch Readiness) in the AIVENA docs folder, never by this folder.

`DESIGN_v1.2_2026-08-26.md` is a FROZEN SNAPSHOT of the build-time design taken at build start (2026-08-26, Christian's build go); its living copy in the Drive-mounted docs folder (`aivena docs/master doc and changelog/AIVENA_Packet2_AmandaWA_AutoMode_Design_2026-08-26.md`) is frozen too and carries the same pointer. It records how the v1.2 engine was specified; the operating model supersedes it for every question about direction. The JSONs are the review/panel findings the design references (v1.0 adversarial review 79 findings · v1.1 ping-spine panel · v1.2 completeness hunt · v1.3 P0 code review · v1.4 conformance audit).

Build path as specified in v1.2 (§8 + §11): lean P0 → P0.5 Live Demo Track (is_test agencies, FULL mode) → P1 SHADOW → P2 → P3. Where the engine actually stands today is Part A of `OPERATING_MODEL.md`.
