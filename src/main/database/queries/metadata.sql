-- name: updateSystemOverride
UPDATE rom_metadata
SET system_override = ?
WHERE source_root = ?
  AND relative_path = ?;

-- name: insertSystemOverride
INSERT INTO rom_metadata (
  source_root, relative_path, title, description, released, developer,
  publisher, genre, provider, provider_id, provider_slug, artwork_id, system_override
)
VALUES (?, ?, ?, '', '', '', '', '', 'manual', NULL, NULL, NULL, ?)
ON CONFLICT (source_root, relative_path) DO UPDATE SET
  system_override = excluded.system_override;

-- name: getArtworkId
SELECT artwork_id AS artworkId
FROM rom_metadata
WHERE source_root = ?
  AND relative_path = ?;

-- name: getSystemOverride
SELECT system_override AS systemOverride
FROM rom_metadata
WHERE source_root = ?
  AND relative_path = ?;

-- name: saveMetadata
INSERT INTO rom_metadata (
  source_root, relative_path, title, description, released, developer,
  publisher, genre, provider, provider_id, provider_slug, artwork_id, system_override
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (source_root, relative_path) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  released = excluded.released,
  developer = excluded.developer,
  publisher = excluded.publisher,
  genre = excluded.genre,
  provider = excluded.provider,
  provider_id = excluded.provider_id,
  provider_slug = excluded.provider_slug,
  artwork_id = excluded.artwork_id,
  system_override = excluded.system_override;

-- name: referencedArtwork
SELECT DISTINCT artwork_id AS id
FROM rom_metadata
WHERE artwork_id IS NOT NULL;
