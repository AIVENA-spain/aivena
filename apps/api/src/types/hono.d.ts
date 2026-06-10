import 'hono';
import type { Tx } from '../../../../packages/db/client';
import type { AuthenticatedUser } from '../middleware/auth';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthenticatedUser;
    agencyId: string;
    role: string;
    /** Caller's raw JWT, stashed by requireAivenaStaff for admin routes. */
    jwt: string;
    tx: Tx;
  }
}
