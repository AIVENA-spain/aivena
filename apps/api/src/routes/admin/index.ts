import { Hono } from 'hono';
import agenciesRoute from './agencies';
import scoringCheckRoute from './scoring-check';

/**
 * Admin surface — mounted at /api/v1/admin, gated by requireAivenaStaff.
 * Sub-routers are added per phase (agencies first; settings/branding/team/audit
 * hang off /agencies/:id/* and are added in later phases).
 */
const admin = new Hono();

admin.route('/agencies', agenciesRoute);
// Internal lead-scoring check (Stage 1, 2026-09-11): fixtures only, writes nothing. Staff-only via requireAivenaStaff.
admin.route('/scoring-check', scoringCheckRoute);

export default admin;
