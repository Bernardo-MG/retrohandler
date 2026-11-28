import type { DesktopApi, ExportOptions, ExportPlan, ExportPreferences } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';
import { normalizedOverrides, summarizePlan } from './export-model';

type ExportApi = Pick<
  DesktopApi,
  'listSystems' | 'chooseExportFolder' | 'previewRetroPieExport' | 'runRetroPieExport'
>;
interface ExportState extends ExportPreferences {
  systems: string[];
  plan: ExportPlan | null;
  busy: boolean;
  error: string;
  done: string;
  completed: { plan: ExportPlan; backups: string[] } | null;
}

export class ExportController extends ControllerState<ExportState> {
  private source: string | null;
  private previewSource: string | null = null;

  constructor(
    private readonly api: ExportApi,
    source: string | null,
    preferences: ExportPreferences
  ) {
    super({ ...preferences, systems: [], plan: null, busy: false, error: '', done: '', completed: null });
    this.source = source;
  }

  public async loadSystems(source: string | null, signal: AbortSignal): Promise<void> {
    if (source !== this.source) {
      this.source = source;
      this.update({ plan: null, systems: [] });
    }
    try {
      const rows = await this.api.listSystems(source);
      if (!signal.aborted && source === this.source) {
        this.update({ systems: rows.map((row) => row.system) });
      }
    } catch (reason) {
      if (!signal.aborted && source === this.source) {
        this.update({ error: String(reason) });
      }
    }
  }

  public readonly changeArtwork = (includeArtwork: boolean): void => {
    if (!this.getSnapshot().busy) {
      this.update({ includeArtwork, plan: null });
    }
  };

  public readonly changeMapping = (system: string, value: string): void => {
    const { busy, overrides } = this.getSnapshot();
    if (!busy) {
      this.update({ overrides: { ...overrides, [system]: value.toLowerCase() }, plan: null });
    }
  };

  public readonly choose = (): Promise<void> =>
    this.execute(async () => {
      const destination = await this.api.chooseExportFolder();
      if (destination) {
        this.update({ destination, plan: null, done: '', completed: null });
      }
    });

  public requestPreview(source: string | null): Promise<void> {
    return this.execute(async () => {
      this.update({ done: '', completed: null, plan: null });
      const plan = await this.api.previewRetroPieExport(this.options(source));
      if (source === this.source) {
        this.previewSource = source;
        this.update({ plan });
      }
    });
  }

  public run(source: string | null): Promise<void> | undefined {
    const { plan } = this.getSnapshot();
    if (!plan || this.previewSource !== source || !summarizePlan(plan).canGenerate) {
      return;
    }
    return this.execute(async () => {
      const receipt = await this.api.runRetroPieExport(this.options(source), plan.fingerprint);
      const { reused } = summarizePlan(plan);
      this.update({
        done: `RetroPie configuration generated: ${receipt.copied} XML/artwork files written, ${reused} reused, ${plan.skippedRoms} ROMs skipped. No ROMs were copied.`,
        completed: { plan, backups: receipt.backups ?? [] },
        plan: null
      });
    });
  }

  private options(source: string | null): ExportOptions {
    const { destination, includeArtwork, overrides } = this.getSnapshot();
    return { source, destination, includeArtwork, overrides: normalizedOverrides(overrides) };
  }

  private async execute(operation: () => Promise<void>): Promise<void> {
    if (this.getSnapshot().busy) {
      return;
    }
    this.update({ busy: true, error: '' });
    try {
      await operation();
    } catch (reason) {
      this.update({ plan: null, error: String(reason) });
    } finally {
      this.update({ busy: false });
    }
  }
}
