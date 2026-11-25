-- name: existingRows
SELECT id, name, system, relative_path, extension, bytes
FROM rom_files
WHERE source_root = ?;

-- name: upsertRom
INSERT INTO rom_files (source_root, relative_path, id, name, system, extension, bytes)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (source_root, relative_path) DO UPDATE SET
  id = excluded.id,
  name = excluded.name,
  system = excluded.system,
  extension = excluded.extension,
  bytes = excluded.bytes;

-- name: deleteRom
DELETE FROM rom_files
WHERE source_root = ?
  AND relative_path = ?;

-- name: lastScanGames
SELECT id, name, system, relative_path, extension, bytes
FROM rom_files
WHERE source_root = ?
ORDER BY system, name, relative_path;

-- name: findTarget
SELECT source_root AS source, relative_path AS relativePath, name
FROM rom_files
WHERE source_root = ?
  AND relative_path = ?;

-- name: exists
SELECT 1 AS found
FROM rom_files
WHERE source_root = ?
  AND relative_path = ?;
