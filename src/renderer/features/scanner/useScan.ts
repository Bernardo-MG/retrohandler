import { useEffect } from 'react';
import type { ScanReceipt } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { ScanController } from './ScanController';

export function useScan(
  onCompleted: (receipt: ScanReceipt) => Promise<void>,
  reportError: (message: string) => void
) {
  const [controller, state] = useControllerState(() => new ScanController(desktopApi()));
  useEffect(() => controller.connect(), [controller]);
  return {
    ...state,
    scan: () => controller.scan(onCompleted, reportError),
    cancel: () => controller.cancel(reportError)
  };
}
