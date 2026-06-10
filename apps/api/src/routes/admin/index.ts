import { Hono } from 'hono';
import agenciesRoute from './agencies';

/**
 * Admin surface — mounted at /api/v1/admin, gated by requireAivenaStaff.
 * Sub-routers are added per phase (agencies first; settings/branding/team/audit
 * hang off /agencies/:id/* and are added in later phases).
 */
const admin = new Hono();

admin.route('/agencies', agenciesRoute);

export default admin;
