import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initializeApplication } from './app/bootstrap';
import './styles/library.css';
import './styles/preferences.css';

const root = createRoot(document.getElementById('root')!);
void initializeApplication().then((initial) => {
  root.render(
    <React.StrictMode>
      <App initial={initial} />
    </React.StrictMode>
  );
});
