import React from 'react';
import type { AppSettings, LibraryPreferences } from '../../../shared';
import { formatSize } from '../../utils/format-size';
import { useSettings, type SettingsViewModel, type SettingsPanelProps } from './useSettings';

export function SettingsPanel(props: SettingsPanelProps) {
  const model = useSettings(props);
  return <SettingsPanelView model={model} />;
}

export function SettingsPanelView({ model }: { model: SettingsViewModel }) {
  const {
    draft,
    collections,
    onClose,
    storage,
    storageLoading,
    storageError,
    notice,
    error,
    busy,
    confirmReset,
    panel,
    mappings,
    updateLibrary,
    changeCollection,
    clearFilters,
    keyDown,
    chooseDestination,
    removeMapping,
    refreshStorage,
    cleanup,
    save,
    reset,
    changeTheme,
    clearDestination,
    changeArtwork,
    clearMappings,
    changeMetadataStart,
    changeMetadataArtwork,
    requestReset,
    cancelReset
  } = model;
  return (
    <div className="settings-overlay">
      <section
        ref={panel}
        tabIndex={-1}
        onKeyDown={keyDown}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="metadata-heading">
          <div>
            <h2 id="settings-title">Application settings</h2>
            <small>Preferences are saved on this computer, independently of your ROM library.</small>
          </div>
          <button className="secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
        <fieldset disabled={busy} className="settings-fields">
          <section className="settings-section">
            <h3>Appearance</h3>
            <label>
              Theme{' '}
              <select
                value={draft.appearance.theme}
                onChange={(event) => changeTheme(event.target.value as AppSettings['appearance']['theme'])}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Follow system</option>
              </select>
            </label>
            <p>
              Changes apply when you save. Window size, position and maximized state are saved when the
              application closes.
            </p>
          </section>
          <section className="settings-section">
            <h3>Library</h3>
            <p>RetroHandler remembers the last collection, view, sort order and filters automatically.</p>
            <div className="settings-grid">
              <label>
                Collection{' '}
                <select
                  value={draft.library.selected ?? ''}
                  onChange={(event) => changeCollection(event.target.value || null)}
                >
                  <option value="">All collections</option>
                  {collections.map((collection) => (
                    <option key={collection.rootPath} value={collection.rootPath}>
                      {collection.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Library view{' '}
                <select
                  value={draft.library.view}
                  onChange={(event) =>
                    updateLibrary({ view: event.target.value as LibraryPreferences['view'] })
                  }
                >
                  <option value="list">List / table</option>
                  <option value="grid">Gallery</option>
                </select>
              </label>
              <label>
                Sort by{' '}
                <select
                  value={draft.library.sort}
                  onChange={(event) =>
                    updateLibrary({ sort: event.target.value as LibraryPreferences['sort'] })
                  }
                >
                  <option value="name">Game name</option>
                  <option value="system">System</option>
                  <option value="bytes">File size</option>
                </select>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={draft.library.descending}
                  onChange={(event) => updateLibrary({ descending: event.target.checked })}
                />{' '}
                Descending order
              </label>
            </div>
            <div className="settings-line">
              <p>
                Saved filters: {draft.library.search || 'No search'} · {draft.library.system ?? 'All systems'}{' '}
                · {draft.library.identification ?? 'All identification statuses'}
              </p>
              <button className="secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </section>
          <section className="settings-section">
            <h3>RetroPie export</h3>
            <p>These defaults are also updated when you change a valid option in the export dialog.</p>
            <label>
              Last destination
              <input readOnly value={draft.export.destination} placeholder="Not selected" />
            </label>
            <div className="settings-actions">
              <button className="secondary" onClick={() => void chooseDestination()}>
                Browse…
              </button>
              <button className="secondary" disabled={!draft.export.destination} onClick={clearDestination}>
                Clear destination
              </button>
            </div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={draft.export.includeArtwork}
                onChange={(event) => changeArtwork(event.target.checked)}
              />{' '}
              Include cached artwork by default
            </label>
            <h4>System mapping overrides</h4>
            <p>
              Add or edit mappings in the RetroPie export dialog. Removing an override restores the default
              mapping for that system.
            </p>
            {mappings.length ? (
              <>
                <div className="settings-mappings">
                  {mappings.map(([system, folder]) => (
                    <div className="settings-line" key={system}>
                      <span>
                        {system}: <code>{folder}</code>
                      </span>
                      <button
                        className="secondary"
                        aria-label={`Remove mapping for ${system}`}
                        onClick={() => removeMapping(system)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button className="secondary" onClick={clearMappings}>
                  Clear all overrides
                </button>
              </>
            ) : (
              <p>No custom mappings saved.</p>
            )}
          </section>
          <section className="settings-section">
            <h3>Metadata and artwork</h3>
            <div className="settings-grid">
              <label>
                Game editor opens at{' '}
                <select
                  value={draft.metadata.startWith}
                  onChange={(event) =>
                    changeMetadataStart(event.target.value as AppSettings['metadata']['startWith'])
                  }
                >
                  <option value="manual">Manual metadata fields</option>
                  <option value="launchbox">LaunchBox search</option>
                </select>
              </label>
              <label>
                Artwork section{' '}
                <select
                  value={draft.metadata.artwork}
                  onChange={(event) =>
                    changeMetadataArtwork(event.target.value as AppSettings['metadata']['artwork'])
                  }
                >
                  <option value="libretro">Show Libretro search</option>
                  <option value="saved-only">Show saved artwork; hide search</option>
                </select>
              </label>
            </div>
            <p>
              Both providers remain available. Settings never automatically download or apply metadata or
              artwork.
            </p>
          </section>
          <section className="settings-section">
            <h3>Storage and cache</h3>
            {storageLoading && <p role="status">Reading storage information…</p>}
            {storage && (
              <>
                <dl className="settings-paths">
                  <dt>Library database</dt>
                  <dd>{storage.databasePath}</dd>
                  <dt>Settings file</dt>
                  <dd>{storage.settingsPath}</dd>
                  <dt>Artwork cache</dt>
                  <dd>{storage.artworkPath}</dd>
                </dl>
                <p>
                  Managed cache: {storage.artworkFiles.toLocaleString()} files ·{' '}
                  {formatSize(storage.artworkBytes)}.
                </p>
                <p>
                  Eligible for cleanup: {storage.reclaimableFiles.toLocaleString()} files ·{' '}
                  {formatSize(storage.reclaimableBytes)}.
                </p>
              </>
            )}
            <p>
              Only unreferenced cached artwork at least seven days old and abandoned artwork downloads at
              least one day old can be removed. ROMs, saved metadata, referenced artwork and other files are
              retained.
            </p>
            <div className="settings-actions">
              <button className="secondary" disabled={storageLoading} onClick={() => void refreshStorage()}>
                Refresh storage
              </button>
              <button
                className="secondary"
                disabled={storageLoading || !storage?.reclaimableFiles}
                onClick={() => void cleanup()}
              >
                Clean unused artwork…
              </button>
            </div>
            {notice && (
              <p className="identity-message" role="status">
                {notice}
              </p>
            )}
            {storageError && (
              <p className="error" role="alert">
                {storageError}
              </p>
            )}
          </section>
          <section className="settings-section">
            <h3>Restore defaults</h3>
            <p>
              Reset appearance, library preferences, metadata preferences, export options and window geometry.
              This does not delete ROMs, the database, game metadata, or artwork.
            </p>
            {!confirmReset ? (
              <button className="secondary" onClick={requestReset}>
                Restore defaults…
              </button>
            ) : (
              <div className="settings-line">
                <strong>Discard all saved preferences?</strong>
                <div className="settings-actions">
                  <button className="secondary" onClick={cancelReset}>
                    Cancel
                  </button>
                  <button className="primary" onClick={() => void reset()}>
                    Reset preferences
                  </button>
                </div>
              </div>
            )}
          </section>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-footer">
          <button className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Working…' : 'Save settings'}
          </button>
        </div>
      </section>
    </div>
  );
}
