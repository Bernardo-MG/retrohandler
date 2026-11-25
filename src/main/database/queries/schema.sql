-- name: inspectObjects
SELECT name
FROM sqlite_master
WHERE name NOT GLOB 'sqlite_*';

-- name: readVersion
SELECT version
FROM schema_version;

-- name: insertVersion
INSERT INTO schema_version (version)
VALUES (?);

-- name: updateVersion
UPDATE schema_version
SET version = ?;
