import { useEffect, useRef, useState } from 'react';
import type { IdentificationProgress } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';

export function useIdentificationController(selected: string | null, onCompleted: () => void, reportError: (message: string) => void) {
  const [identifying, setIdentifying] = useState(false);
  const [progress, setProgress] = useState<IdentificationProgress | null>(null);
  const [message, setMessage] = useState('');
  const activeJob = useRef<string | null>(null);
  const importing = useRef(false);

  useEffect(function subscribeToProgress() {
    return desktopApi().onIdentificationProgress(update => {
      if (update.jobId === activeJob.current) setProgress(update.progress);
    });
  }, []);

  async function importDat() {
    if (importing.current || activeJob.current) return;
    importing.current = true;
    reportError('');
    try {
      const receipt = await desktopApi().importDat();
      if (receipt) {
        setMessage(`Imported ${receipt.count.toLocaleString()} DAT entries from ${receipt.name}. Run Identify to update matches.`);
      }
    } catch (reason) {
      reportError(`DAT import failed: ${String(reason)}`);
    } finally {
      importing.current = false;
    }
  }

  async function identify() {
    if (!selected || activeJob.current || importing.current) return;
    reportError('');
    setIdentifying(true);
    setProgress(null);
    setMessage('');
    const jobId = `identify_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    activeJob.current = jobId;
    try {
      const result = await desktopApi().identifyCollection(selected, jobId);
      setMessage(`Identified ${result.verified} verified, ${result.probable} probable, ${result.ambiguous} ambiguous, ${result.unknown} unknown, ${result.unsupported} unsupported, ${result.errors} errors.`);
      onCompleted();
    } catch (reason) {
      if (!String(reason).toLowerCase().includes('cancelled')) reportError(`Identification failed: ${String(reason)}`);
    } finally {
      activeJob.current = null;
      setIdentifying(false);
      setProgress(null);
    }
  }

  function cancel() {
    if (activeJob.current) {
      void desktopApi().cancelIdentification(activeJob.current).catch(reason => reportError(String(reason)));
    }
  }

  return { identifying, progress, message, importDat, identify, cancel };
}
