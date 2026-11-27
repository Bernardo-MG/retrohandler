import type { DesktopApi, IdentificationProgress } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';

type IdentificationApi = Pick<
  DesktopApi,
  'importDat' | 'identifyCollection' | 'cancelIdentification' | 'onIdentificationProgress'
>;
interface IdentificationState {
  identifying: boolean;
  progress: IdentificationProgress | null;
  message: string;
}

export class IdentificationController extends ControllerState<IdentificationState> {
  private activeJob: string | null = null;
  private importing = false;

  constructor(
    private readonly api: IdentificationApi,
    private readonly createJobId = () => `identify_${Date.now()}_${Math.random().toString(36).slice(2)}`
  ) {
    super({ identifying: false, progress: null, message: '' });
  }

  public connect(): () => void {
    return this.api.onIdentificationProgress((update) => {
      if (update.jobId === this.activeJob) {
        this.update({ progress: update.progress });
      }
    });
  }

  public async importDat(reportError: (message: string) => void): Promise<void> {
    if (this.importing || this.activeJob) {
      return;
    }
    this.importing = true;
    reportError('');
    try {
      const receipt = await this.api.importDat();
      if (receipt) {
        this.update({
          message: `Imported ${receipt.count.toLocaleString()} DAT entries from ${receipt.name}. Run Identify to update matches.`
        });
      }
    } catch (reason) {
      reportError(`DAT import failed: ${String(reason)}`);
    } finally {
      this.importing = false;
    }
  }

  public async identify(
    selected: string | null,
    onCompleted: () => void,
    reportError: (message: string) => void
  ): Promise<void> {
    if (!selected || this.activeJob || this.importing) {
      return;
    }
    const jobId = this.createJobId();
    this.activeJob = jobId;
    reportError('');
    this.update({ identifying: true, progress: null, message: '' });
    try {
      const result = await this.api.identifyCollection(selected, jobId);
      this.update({
        message: `Identified ${result.verified} verified, ${result.probable} probable, ${result.ambiguous} ambiguous, ${result.unknown} unknown, ${result.unsupported} unsupported, ${result.errors} errors.`
      });
      onCompleted();
    } catch (reason) {
      if (!String(reason).toLowerCase().includes('cancelled')) {
        reportError(`Identification failed: ${String(reason)}`);
      }
    } finally {
      this.activeJob = null;
      this.update({ identifying: false, progress: null });
    }
  }

  public async cancel(reportError: (message: string) => void): Promise<void> {
    if (!this.activeJob) {
      return;
    }
    try {
      await this.api.cancelIdentification(this.activeJob);
    } catch (reason) {
      reportError(String(reason));
    }
  }
}
