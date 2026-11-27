import React from 'react';
import { FolderOpen, Gamepad2, HardDrive, Library, Settings2, Server, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CollectionPanel } from '../features/collections/CollectionPanel';
import { LibraryWorkspace } from '../features/library/LibraryWorkspace';
import { ScanStatus } from '../features/scanner/ScanStatus';
import { IdentificationStatus } from '../features/identification/IdentificationStatus';
import { RetroPieExport } from '../features/export/RetroPieExport';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import type { AppViewModel } from './useApp';

export function AppView({ model }: { model: AppViewModel }) {
  const { library, scanner, identification, preferences, error, dismissError, showExport, closeExport, showSettings, closeSettings, saveSettings } = model;
  return <div className="app">
    <Sidebar model={model} />
    <main>
      <WorkspaceHeader model={model} />
      {scanner.busy && <ScanStatus progress={scanner.progress} cancel={scanner.cancel} />}
      {identification.identifying && <IdentificationStatus progress={identification.progress} cancel={identification.cancel} />}
      {identification.message && <div className="identity-message" role="status">{identification.message}</div>}
      {error && <div className="error" role="alert">
        <AlertCircle size={18} />
        {error}
        <button className="dismiss-error" onClick={dismissError}>Dismiss</button>
      </div>}
      <LibrarySummary library={library} />
      {library.collections.length
        ? <LibraryWorkspace library={library} metadataPreferences={preferences.settings.metadata} />
        : <EmptyLibrary scan={scanner.scan} disabled={!library.ready || scanner.busy || showSettings} />}
      {showExport && <RetroPieExport
        source={library.preferences.selected}
        preferences={preferences.settings.export}
        onPreferencesChange={preferences.rememberExport}
        onClose={closeExport}
      />}
      {showSettings && <SettingsPanel
        settings={preferences.settings}
        collections={library.collections}
        onClose={closeSettings}
        onSaved={saveSettings}
      />}
      <p className="footnote">Removing a collection only forgets its database entries; your original ROM files are never deleted.</p>
    </main>
  </div>;
}

function Sidebar({ model }: { model: AppViewModel }) {
  const { library, scanner, identification, settingsButton, showSettings, showExport, openSettings } = model;
  return <aside className="sidebar">
    <div className="brand">
      <div className="brand-icon"><Gamepad2 size={22} /></div>
      <div>
        <strong>Retro</strong>
        <span>HANDLER</span>
      </div>
    </div>
    <div className="nav-title">WORKSPACE</div>
    <div className="nav-item active"><Library size={18} /> Game Library</div>
    <div className="nav-item"><HardDrive size={18} /> Metadata <span className="soon">In library</span></div>
    <button
      ref={settingsButton}
      className="nav-item settings-nav"
      disabled={!library.ready || scanner.busy || identification.identifying || showExport || !!library.details || showSettings}
      onClick={openSettings}
    ><Settings2 size={18} /> Application settings</button>
    <div className="nav-item muted"><Server size={18} /> Deployment <span className="soon">Soon</span></div>
    <CollectionPanel
      collections={library.collections}
      selected={library.preferences.selected}
      busy={scanner.busy}
      select={library.selectCollection}
      rename={library.rename}
      remove={library.remove}
      assignSystem={library.assignCollectionSystem}
    />
    <div className="sidebar-bottom"><span className="status-dot" /> Local mode · v0.4</div>
  </aside>;
}

function WorkspaceHeader({ model }: { model: AppViewModel }) {
  const { library, scanner, identification, showSettings, openExport } = model;
  return <header>
    <div>
      <p className="eyebrow">COLLECTION OVERVIEW</p>
      <h1>Game Library</h1>
      <p className="subtitle">Discover and organize the games in your ROM collection.</p>
    </div>
    <div className="identity-actions">
      <button
        className="secondary"
        disabled={!library.ready || scanner.busy || identification.identifying || !library.collections.length || showSettings || !!library.details}
        onClick={openExport}
      >RetroPie export</button>
      <button className="secondary" disabled={scanner.busy || identification.identifying} onClick={identification.importDat}>Import DAT XML</button>
      <button
        className="secondary"
        disabled={scanner.busy || identification.identifying || !library.preferences.selected}
        onClick={identification.identify}
      >Identify collection</button>
    </div>
    <button className="primary" onClick={scanner.scan} disabled={!library.ready || scanner.busy || identification.identifying || showSettings}>
      {scanner.busy ? <RefreshCw className="spin" size={17} /> : <FolderOpen size={17} />} {scanner.busy ? 'Scanning…' : 'Scan ROM folder'}
    </button>
  </header>;
}

function LibrarySummary({ library }: { library: AppViewModel['library'] }) {
  const { statistics, selectedInfo } = library;
  return <>
    <section className="stats">
      <div className="stat">
        <div className="stat-icon"><Gamepad2 /></div>
        <div>
          <span>Games in selection</span>
          <strong>{statistics.selectedCount.toLocaleString()}</strong>
        </div>
      </div>
      <div className="stat">
        <div className="stat-icon"><HardDrive /></div>
        <div>
          <span>Systems detected</span>
          <strong>{statistics.platformTotal}</strong>
        </div>
      </div>
      <div className="stat">
        <div className="stat-icon"><CheckCircle2 /></div>
        <div>
          <span>Identified by folder / format</span>
          <strong>{statistics.identifiedPercent}</strong>
        </div>
      </div>
    </section>
    {selectedInfo && <div className="source">
      <FolderOpen size={16} />
      <span title={selectedInfo.rootPath}>{selectedInfo.rootPath}</span>
      <em>Scanned {new Date(selectedInfo.scannedAt).toLocaleString()}</em>
    </div>}
  </>;
}

function EmptyLibrary({ scan, disabled }: { scan(): Promise<void>; disabled: boolean }) {
  return <section className="empty">
    <div className="empty-graphic"><Gamepad2 size={56} /></div>
    <div className="ready">READY TO START</div>
    <h2>Your retro collection, organized.</h2>
    <p>Select a local or network-mounted ROM folder. RetroHandler will index your collection and remember it between launches.</p>
    <button onClick={scan} disabled={disabled} className="secondary"><FolderOpen size={18} /> Choose collection folder</button>
    <div className="safe"><CheckCircle2 size={15} /> Read-only scan. Your original files stay untouched.</div>
  </section>;
}
