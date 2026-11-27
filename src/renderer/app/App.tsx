import React from 'react';
import type { SettingsSnapshot } from '../../shared';
import { useApp } from './useApp';
import { AppView } from './AppView';

export function App({ initial }: { initial: SettingsSnapshot }) {
  const model = useApp(initial);
  return <AppView model={model} />;
}
