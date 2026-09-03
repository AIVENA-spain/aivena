import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPORTED_LOCALES,
  USER_PREF_LOCALES,
  USER_PREF_LOCALE_NAMES,
  LOCALE_NAMES,
  catalogLocaleFor,
  catalogLocaleOrNull,
} from "./config";

/**
 * The dashboard shipped THREE complete translations nobody could select
 * (da/fi/pt), because the picker list and the catalogue drifted apart and the
 * DB constraint quietly excluded them. These bind the two together.
 */
describe("every language we ship can actually be chosen", () => {
  const catalogueFiles = readdirSync(join(__dirname, "../../messages"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));

  it("a catalogue exists on disk for every supported locale", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(catalogueFiles, `messages/${loc}.json is missing`).toContain(loc);
    }
  });

  it("EVERY shipped catalogue is reachable from the per-user picker", () => {
    // This is the exact bug: da.json/fi.json/pt.json existed and were complete,
    // but no agent could pick them.
    for (const file of catalogueFiles) {
      const reachable = USER_PREF_LOCALES.some(
        (code) => catalogLocaleFor(code) === file,
      );
      expect(reachable, `messages/${file}.json ships but no picker entry reaches it`).toBe(true);
    }
  });

  it("every picker entry resolves to a catalogue that exists", () => {
    for (const code of USER_PREF_LOCALES) {
      expect(catalogueFiles).toContain(catalogLocaleFor(code));
      expect(USER_PREF_LOCALE_NAMES[code], `no display name for ${code}`).toBeTruthy();
    }
  });

  it("every supported locale has a display name", () => {
    for (const loc of SUPPORTED_LOCALES) expect(LOCALE_NAMES[loc]).toBeTruthy();
  });
});

describe("Norwegian resolves from every code the system stores or receives", () => {
  it("nb (canonical storage), no (catalogue) and nb-NO (browser) all agree", () => {
    expect(catalogLocaleOrNull("nb")).toBe("no");
    expect(catalogLocaleOrNull("no")).toBe("no");
    expect(catalogLocaleOrNull("nb-NO")).toBe("no");
    expect(catalogLocaleOrNull("NB")).toBe("no");
  });

  it("returns null for a language we do not ship, so DETECTION can tell", () => {
    // catalogLocaleFor folds unknown into English, which is right for rendering
    // and wrong for browser detection — that distinction is the whole point.
    expect(catalogLocaleOrNull("zz")).toBeNull();
    expect(catalogLocaleFor("zz")).toBe("en");
  });

  it("other legacy codes normalise the same way the DB trigger does", () => {
    expect(catalogLocaleOrNull("dk")).toBe("da");
    expect(catalogLocaleOrNull("se")).toBe("sv");
    expect(catalogLocaleOrNull("nn")).toBe("no");
  });
});
