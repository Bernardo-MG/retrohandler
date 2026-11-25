-- name: insertDatSet
INSERT INTO dat_sets (name)
VALUES (?)
ON CONFLICT (name) DO NOTHING;

-- name: findDatSet
SELECT id
FROM dat_sets
WHERE name = ?;

-- name: deleteDatEntries
DELETE FROM dat_entries
WHERE dat_id = ?;

-- name: insertDatEntry
INSERT INTO dat_entries (dat_id, game, filename, bytes, crc32, md5, sha1)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: entriesForIdentification
SELECT source_root AS source, relative_path AS relativePath, id, name, system, extension, bytes
FROM rom_files
WHERE source_root = ?
ORDER BY relative_path ASC;

-- name: cachedFingerprint
SELECT bytes, modified_ms AS modifiedMs, crc32, md5, sha1
FROM rom_identifications
WHERE source_root = ?
  AND relative_path = ?
  AND bytes = ?
  AND modified_ms = ?
  AND sha1 IS NOT NULL;

-- name: matchFingerprint
SELECT
  d.game,
  s.name AS datName,
  CASE
    WHEN d.sha1 = ? THEN 'sha1'
    WHEN d.md5 = ? THEN 'md5'
    ELSE 'crc'
  END AS evidence
FROM dat_entries d
JOIN dat_sets s ON s.id = d.dat_id
WHERE d.bytes = ?
  AND (d.sha1 = ? OR d.md5 = ? OR d.crc32 = ?);

-- name: saveIdentification
INSERT INTO rom_identifications (
  source_root, relative_path, status, title, dat_name,
  bytes, modified_ms, crc32, md5, sha1
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (source_root, relative_path) DO UPDATE SET
  status = excluded.status,
  title = excluded.title,
  dat_name = excluded.dat_name,
  bytes = excluded.bytes,
  modified_ms = excluded.modified_ms,
  crc32 = excluded.crc32,
  md5 = excluded.md5,
  sha1 = excluded.sha1;
