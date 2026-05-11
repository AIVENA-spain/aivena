import 'hono';
import type { Tx } from '../../../../packages/db/client';

declare module 'hono' {
  interface ContextVariableMap {
    user: {
      sub?: string;
      agency_id?: string;
      [key: string]: unknown;
    };
    agencyId: string;
    tx: Tx;
  }
}
