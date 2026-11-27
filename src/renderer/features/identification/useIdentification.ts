import { useEffect } from 'react';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { IdentificationController } from './IdentificationController';

export function useIdentification(selected: string | null, onCompleted: () => void, reportError: (message: string) => void) {
  const [controller, state] = useControllerState(() => new IdentificationController(desktopApi()));
  useEffect(() => controller.connect(), [controller]);
  return {
    ...state,
    importDat: () => controller.importDat(reportError),
    identify: () => controller.identify(selected, onCompleted, reportError),
    cancel: () => controller.cancel(reportError)
  };
}
