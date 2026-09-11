import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
// Every file the internal scoring check runs through.
const CHECK_PATH = ['types.ts', 'rubric.ts', 'evidence.ts', 'prompt.ts', 'extract.ts', 'explain.ts', 'score-conversation.ts', 'fixtures.ts', 'check.ts'];
const DB = /packages\/db\/client|from ['"]drizzle-orm['"]/;

describe('the internal scoring check cannot touch real leads', () => {
  it("none of the check's files can reach the database", () => {
    for (const f of CHECK_PATH) expect(read(`./${f}`), f).not.toMatch(DB);
  });
  it("the check's admin route cannot reach the database either (the key comes from Amanda's getLlmKey)", () => {
    expect(read('../routes/admin/scoring-check.ts')).not.toMatch(DB);
  });
  it("the fixtures carry no real person's name (this repository is public)", () => {
    expect(read('./fixtures.ts')).not.toMatch(/Marte|Brenno/);
  });
});

describe('staff only', () => {
  it('the check lives under /api/v1/admin, behind the staff gate that answers everyone else with 404', () => {
    const index = read('../index.ts');
    const gate = index.indexOf("app.use('/api/v1/admin/*', requireAivenaStaff)");
    const mount = index.indexOf("app.route('/api/v1/admin', adminRoute)");
    expect(gate).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(gate);
    expect(read('../routes/admin/index.ts')).toMatch(/admin\.route\('\/scoring-check', scoringCheckRoute\)/);
  });
});

describe('the real-lead scorer is off', () => {
  it('index.ts starts it only behind shouldStartScoringWorker(), which is false while no agency is allowed', () => {
    expect(read('../index.ts')).toMatch(/if \(shouldStartScoringWorker\(\)\)/);
  });
});
