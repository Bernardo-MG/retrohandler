-- name: upsertCollection
INSERT INTO collections (root_path, scanned_at, ignored, warnings_json)
VALUES (?, ?, ?, ?)
ON CONFLICT (root_path) DO UPDATE SET
  scanned_at = excluded.scanned_at,
  ignored = excluded.ignored,
  warnings_json = excluded.warnings_json;

-- name: lastScan
SELECT root_path, scanned_at, ignored, warnings_json
FROM collections
ORDER BY scanned_at DESC, root_path ASC
LIMIT 1;

-- name: listCollections
SELECT
  c.root_path AS rootPath,
  COALESCE(c.label, '') AS label,
  c.scanned_at AS scannedAt,
  c.ignored,
  (
    SELECT COUNT(*)
    FROM rom_files r
    WHERE r.source_root = c.root_path
  ) AS gameCount,
  c.warnings_json AS warningsJson
FROM collections c
ORDER BY c.scanned_at DESC, c.root_path ASC;

-- name: renameCollection
UPDATE collections
SET label = ?
WHERE root_path = ?;

-- name: removeCollection
DELETE FROM collections
WHERE root_path = ?;
