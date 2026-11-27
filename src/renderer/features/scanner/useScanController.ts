import { useEffect, useRef, useState } from 'react';
import type { ScanProgress, ScanReceipt } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';

export function useScanController(onCompleted: (receipt: ScanReceipt) => Promise<void>, reportError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const activeJob = useRef<string | null>(null);
  const choosing = useRef(false);

  useEffect(function subscribeToProgress() {
    return desktopApi().onScanProgress(update => {
      if (update.jobId === activeJob.current) setProgress(update.progress);
    });
  }, []);

  async function scan() {
    if (choosing.current || activeJob.current) return;
    choosing.current = true;
    reportError('');
    try {
      const folder = await desktopApi().chooseRomFolder();
      if (!folder) return;
      setBusy(true);
      setProgress(null);
      const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      activeJob.current = jobId;
      const receipt = await desktopApi().scanIndexedFolder(folder, jobId);
      await onCompleted(receipt);
      if (receipt.warningCount) {
        reportError(`Scan completed with ${receipt.warningCount} warnings. Some files could not be read.`);
      }
    } catch (reason) {
      if (!String(reason).toLowerCase().includes('cancelled')) reportError(String(reason));
    } finally {
      choosing.current = false;
      activeJob.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  function cancel() {
    if (activeJob.current) {
      void desktopApi().cancelScan(activeJob.current).catch(reason => reportError(String(reason)));
    }
  }

  return { busy, progress, scan, cancel };
}
