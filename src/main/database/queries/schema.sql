-- name: inspectObjects
SELECT name
FROM sqlite_master
WHERE name NOT GLOB 'sqlite_*';

-- name: readVersion
PRAGMA user_version;
