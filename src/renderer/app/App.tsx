import React from 'react';
import type { SettingsSnapshot } from '../../shared';
import { useAppController } from './useAppController';
import { AppView } from './AppView';

export function App({ initial }: { initial: SettingsSnapshot }) {
  const model = useAppController(initial);
  return <AppView model={model} />;
}
