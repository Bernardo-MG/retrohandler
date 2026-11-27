import type { DesktopApi, ScanProgress, ScanReceipt } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';

type ScanApi = Pick<DesktopApi, 'chooseRomFolder' | 'scanIndexedFolder' | 'cancelScan' | 'onScanProgress'>;
interface ScanState {
  busy: boolean;
  progress: ScanProgress | null;
}

export class ScanController extends ControllerState<ScanState> {
  private choosing = false;
  private activeJob: string | null = null;

  constructor(
    private readonly api: ScanApi,
    private readonly createJobId = () => `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`
  ) {
    super({ busy: false, progress: null });
  }

  public connect(): () => void {
    return this.api.onScanProgress((update) => {
      if (update.jobId === this.activeJob) this.update({ progress: update.progress });
    });
  }

  public async scan(
    onCompleted: (receipt: ScanReceipt) => Promise<void>,
    reportError: (message: string) => void
  ): Promise<void> {
    if (this.choosing || this.activeJob) {
      return;
    }
    this.choosing = true;
    reportError('');
    try {
      const folder = await this.api.chooseRomFolder();
      if (!folder) {
        return;
      }
      const jobId = this.createJobId();
      this.activeJob = jobId;
      this.update({ busy: true, progress: null });
      const receipt = await this.api.scanIndexedFolder(folder, jobId);
      await onCompleted(receipt);
      if (receipt.warningCount) {
        reportError(`Scan completed with ${receipt.warningCount} warnings. Some files could not be read.`);
      }
    } catch (reason) {
      if (!String(reason).toLowerCase().includes('cancelled')) reportError(String(reason));
    } finally {
      this.choosing = false;
      this.activeJob = null;
      this.update({ busy: false, progress: null });
    }
  }

  public async cancel(reportError: (message: string) => void): Promise<void> {
    if (!this.activeJob) {
      return;
    }
    try {
      await this.api.cancelScan(this.activeJob);
    } catch (reason) {
      reportError(String(reason));
    }
  }
}
