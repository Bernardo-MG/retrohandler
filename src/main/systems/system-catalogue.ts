import type { SystemCatalogueDefinition, SystemDefinition } from './system-definition';
import { validateSystemCatalogue } from './system-validator';

/** A validated catalogue snapshot. Disabled systems remain addressable by stable ID. */
export class SystemCatalogue {
  private readonly definition: SystemCatalogueDefinition;
  private readonly byId: ReadonlyMap<string, SystemDefinition>;

  constructor(definition: unknown) {
    this.definition = validateSystemCatalogue(definition);
    this.byId = new Map(this.definition.systems.map((system) => [system.id, system]));
  }

  public get(id: string): SystemDefinition | undefined {
    return this.byId.get(id);
  }

  public list(): readonly SystemDefinition[] {
    return this.definition.systems;
  }

  public snapshot(): SystemCatalogueDefinition {
    return this.definition;
  }
}
