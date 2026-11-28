-- Initial release schema. SQLite user_version is set by schema.ts.
CREATE TABLE collections (
  root_path TEXT PRIMARY KEY,
  scanned_at TEXT NOT NULL,
  ignored INTEGER NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  label TEXT
);

CREATE TABLE rom_files (
  source_root TEXT NOT NULL REFERENCES collections(root_path) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  system TEXT NOT NULL,
  extension TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (source_root, relative_path)
);

CREATE INDEX rom_files_source_system
  ON rom_files (source_root, system);

CREATE TABLE dat_sets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE dat_entries (
  dat_id INTEGER NOT NULL REFERENCES dat_sets(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  crc32 TEXT,
  md5 TEXT,
  sha1 TEXT
);

CREATE INDEX dat_entries_sha1 ON dat_entries (sha1, bytes);
CREATE INDEX dat_entries_md5 ON dat_entries (md5, bytes);
CREATE INDEX dat_entries_crc ON dat_entries (crc32, bytes);

CREATE TABLE rom_identifications (
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

CREATE TABLE rom_metadata (
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

CREATE TABLE launchbox_games (
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

CREATE INDEX launchbox_lookup ON launchbox_games (normalized_title);

CREATE TABLE launchbox_staging (
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
