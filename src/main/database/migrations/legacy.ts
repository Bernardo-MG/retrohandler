import { sql } from '../query-loader';
import type { DatabaseHandle } from '../types';

/** Pre-canonical databases require at most two column additions. Missing tables
 * are created from the canonical schema, not recreated using historical DDL. */
export function prepareLegacySchema(db: DatabaseHandle, version: number): void {
  if (version === 1) {
    db.exec(sql('legacy.addCollectionLabel'));
  }
  if (version === 4) {
    db.exec(sql('legacy.addSystemOverride'));
  }
}

/** Preserve the original v5-to-v6 provider retirement without discarding metadata. */
export function finishLegacySchema(db: DatabaseHandle): void {
  db.exec(sql('legacy.retireProviders'));
}
