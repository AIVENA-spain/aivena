import { describe, it, expect } from "vitest";
import { formatDay, formatScoredAt, urgencyMessages } from "./scoring-display";

describe("urgency reads beside the score, never inside it", () => {
  it("picks one message per signal, with its values", () => {
    expect(
      urgencyMessages(
        [
          { kind: "waiting_for_reply", days: 12 },
          { kind: "viewing_date_passed", date: "2026-09-03" },
        ],
        (d) => `day:${d}`,
      ),
    ).toEqual([
      { key: "urgencyWaiting", values: { days: 12 } },
      { key: "urgencyViewingPassed", values: { date: "day:2026-09-03" } },
    ]);
    expect(urgencyMessages([{ kind: "inactive", days: 34 }, { kind: "dormant", days: 74 }])).toEqual([
      { key: "urgencyInactive", values: { days: 34 } },
      { key: "urgencyDormant", values: { days: 74 } },
    ]);
  });
  it("waiting since today has its own message", () => {
    expect(urgencyMessages([{ kind: "waiting_for_reply", days: 0 }])).toEqual([{ key: "urgencyWaitingToday", values: {} }]);
  });
  it("no signals, or none sent, means nothing to show", () => {
    expect(urgencyMessages([])).toEqual([]);
    expect(urgencyMessages(undefined)).toEqual([]);
  });
  it("dates read in the viewer's language", () => {
    expect(formatDay("2026-09-03", "en-GB")).toBe("3 Sept");
    expect(formatScoredAt("2026-09-13T10:02:00Z", "en-GB")).toMatch(/13 Sept/);
  });
});
