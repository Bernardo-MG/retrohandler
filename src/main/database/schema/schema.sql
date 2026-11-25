-- Canonical schema. The version row is initialized by schema.ts, not by DDL.
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  root_path TEXT PRIMARY KEY,
  scanned_at TEXT NOT NULL,
  ignored INTEGER NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  label TEXT
);

CREATE TABLE IF NOT EXISTS rom_files (
  source_root TEXT NOT NULL REFERENCES collections(root_path) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  system TEXT NOT NULL,
  extension TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (source_root, relative_path)
);

CREATE INDEX IF NOT EXISTS rom_files_source_system
  ON rom_files (source_root, system);

CREATE TABLE IF NOT EXISTS dat_sets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dat_entries (
  dat_id INTEGER NOT NULL REFERENCES dat_sets(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  crc32 TEXT,
  md5 TEXT,
  sha1 TEXT
);

CREATE INDEX IF NOT EXISTS dat_entries_sha1 ON dat_entries (sha1, bytes);
CREATE INDEX IF NOT EXISTS dat_entries_md5 ON dat_entries (md5, bytes);
CREATE INDEX IF NOT EXISTS dat_entries_crc ON dat_entries (crc32, bytes);

CREATE TABLE IF NOT EXISTS rom_identifications (
  source_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  dat_name TEXT,
  bytes INTEGER,
  modified_ms REAL,
  crc32 TEXT,
  md5 TEXT,
  sha1 TEXT,
  PRIMARY KEY (source_root, relative_path),
  FOREIGN KEY (source_root, relative_path)
    REFERENCES rom_files(source_root, relative_path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rom_metadata (
  source_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  released TEXT NOT NULL,
  developer TEXT NOT NULL,
  publisher TEXT NOT NULL,
  genre TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT,
  provider_slug TEXT,
  artwork_id TEXT,
  system_override TEXT,
  PRIMARY KEY (source_root, relative_path),
  FOREIGN KEY (source_root, relative_path)
    REFERENCES rom_files(source_root, relative_path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS launchbox_games (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  released TEXT NOT NULL,
  description TEXT NOT NULL,
  developer TEXT NOT NULL,
  publisher TEXT NOT NULL,
  genre TEXT NOT NULL,
  normalized_title TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS launchbox_lookup ON launchbox_games (normalized_title);

CREATE TABLE IF NOT EXISTS launchbox_staging (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  released TEXT NOT NULL,
  description TEXT NOT NULL,
  developer TEXT NOT NULL,
  publisher TEXT NOT NULL,
  genre TEXT NOT NULL,
  normalized_title TEXT NOT NULL
);
