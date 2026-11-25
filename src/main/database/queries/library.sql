-- name: countGames
SELECT COUNT(*) AS total
FROM rom_files r
LEFT JOIN rom_metadata m
  ON m.source_root = r.source_root
  AND m.relative_path = r.relative_path
{{where}};

-- name: pageGames
SELECT
  r.source_root AS source,
  r.id,
  r.name,
  COALESCE(NULLIF(m.system_override, ''), r.system) AS system,
  r.relative_path AS relativePath,
  r.extension,
  r.bytes,
  i.status AS identificationStatus,
  i.title AS identifiedTitle,
  i.dat_name AS datName,
  m.title AS metadataTitle,
  m.description AS metadataDescription,
  m.released AS metadataReleased,
  m.developer AS metadataDeveloper,
  m.publisher AS metadataPublisher,
  m.genre AS metadataGenre,
  m.provider AS metadataProvider,
  m.provider_id AS metadataProviderId,
  m.provider_slug AS metadataProviderSlug,
  m.artwork_id AS metadataArtworkId,
  m.system_override AS metadataSystemOverride
FROM rom_files r
LEFT JOIN rom_identifications i
  ON i.source_root = r.source_root
  AND i.relative_path = r.relative_path
LEFT JOIN rom_metadata m
  ON m.source_root = r.source_root
  AND m.relative_path = r.relative_path
{{where}}
ORDER BY {{order}} {{direction}}, r.source_root ASC, r.relative_path ASC
LIMIT ? OFFSET ?;

-- name: listSystems
SELECT COALESCE(NULLIF(m.system_override, ''), r.system) AS system, COUNT(*) AS count
FROM rom_files r
LEFT JOIN rom_metadata m
  ON m.source_root = r.source_root
  AND m.relative_path = r.relative_path
{{where}}
GROUP BY COALESCE(NULLIF(m.system_override, ''), r.system)
ORDER BY system COLLATE NOCASE;

-- name: bulkTargets
SELECT r.source_root AS source, r.relative_path AS relativePath, r.name
FROM rom_files r
LEFT JOIN rom_metadata m
  ON m.source_root = r.source_root
  AND m.relative_path = r.relative_path
{{where}}
ORDER BY r.source_root, r.relative_path
LIMIT 250001;

-- name: filterSource
r.source_root = ?

-- name: filterSystem
COALESCE(NULLIF(m.system_override, ''), r.system) = ?

-- name: filterSearch
(r.name LIKE ? ESCAPE '!' OR r.relative_path LIKE ? ESCAPE '!')

-- name: filterPending
NOT EXISTS (
  SELECT 1
  FROM rom_identifications x
  WHERE x.source_root = r.source_root
    AND x.relative_path = r.relative_path
)

-- name: filterStatus
EXISTS (
  SELECT 1
  FROM rom_identifications x
  WHERE x.source_root = r.source_root
    AND x.relative_path = r.relative_path
    AND x.status = ?
)

-- name: sortName
r.name COLLATE NOCASE

-- name: sortSystem
COALESCE(NULLIF(m.system_override, ''), r.system) COLLATE NOCASE

-- name: sortBytes
r.bytes
