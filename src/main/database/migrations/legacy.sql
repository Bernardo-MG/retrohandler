-- name: addCollectionLabel
ALTER TABLE collections ADD COLUMN label TEXT;

-- name: addSystemOverride
ALTER TABLE rom_metadata ADD COLUMN system_override TEXT;

-- name: retireProviders
UPDATE rom_metadata
SET provider = 'manual', provider_id = NULL, provider_slug = NULL
WHERE provider NOT IN ('manual', 'launchbox');
