import defaults from './default-systems.json';
import { SystemCatalogue } from './system-catalogue';

/** Bundled data is validated by the same contract as future user configuration. */
export function createDefaultSystemCatalogue(): SystemCatalogue {
  return new SystemCatalogue(defaults);
}
