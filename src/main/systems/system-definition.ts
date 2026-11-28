/** Data-only settings; each integration owns the interpretation and validation of its values. */
export type SystemPluginSettings = Readonly<Partial<Record<string, string | readonly string[]>>>;

export interface SystemDefinition {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly enabled: boolean;
  readonly aliases: readonly string[];
  readonly scanning: {
    readonly directories: readonly string[];
    /** Extensions that provide a platform inference hint. */
    readonly extensions: readonly string[];
  };
  readonly identification: {
    readonly extensions: readonly string[];
  };
  readonly plugins: Readonly<Partial<Record<string, SystemPluginSettings>>>;
}

export interface SystemCatalogueDefinition {
  readonly systems: readonly SystemDefinition[];
  /** Recognized ROM formats that do not imply any particular system. */
  readonly additionalFormats: {
    readonly scanning: readonly string[];
    readonly identification: readonly string[];
  };
}
