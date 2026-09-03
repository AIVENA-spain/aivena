import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BANK_SOURCE_DIGEST, BANK_CARDS } from './studio-bank.generated';

/**
 * The engine's copy of the bank must never drift behind the bank.
 *
 * That drift is not hypothetical — it is the whole reason this work exists. The guardrails were
 * verified, written down, and then protected nothing, because the thing that writes posts could not
 * see them. A generated file with no sync check is the same failure waiting to happen quietly: the
 * bank gets corrected, the engine keeps the old rules, and nobody finds out from a post.
 *
 * Rebuild with:  python3 tools/content-bank/export_for_engine.py
 */
describe('the generated bank is in sync with its sources', () => {
  it('matches the digest of the two bank files', () => {
    const root = join(__dirname, '..', '..', '..', '..', 'tools', 'content-bank');
    const h = createHash('sha256');
    // Order matters and must match export_for_engine.py.
    for (const f of ['seller_bank.json', 'buyer_bank.json']) h.update(readFileSync(join(root, f)));
    expect(h.digest('hex'),
      'the banks changed but studio-bank.generated.ts was not rebuilt — run '
      + 'python3 tools/content-bank/export_for_engine.py').toBe(BANK_SOURCE_DIGEST);
  });

  it('carries the guardrails, not just the count', () => {
    // A generated file that compiled but lost its content would still pass a length check.
    const withRules = BANK_CARDS.filter((c) => c.never.length > 0);
    expect(withRules.length).toBeGreaterThan(100);
    expect(BANK_CARDS.every((c) => typeof c.question === 'string')).toBe(true);
  });
});
