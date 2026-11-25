-- name: clearStaging
DELETE FROM launchbox_staging;

-- name: insertStagingGame
INSERT OR REPLACE INTO launchbox_staging (
  id, title, platform, released, description, developer, publisher, genre, normalized_title
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: countStaging
SELECT COUNT(*) AS n
FROM launchbox_staging;

-- name: publishStaging
DELETE FROM launchbox_games;
INSERT INTO launchbox_games
SELECT * FROM launchbox_staging;
DELETE FROM launchbox_staging;

-- name: search
SELECT id, title, platform, released
FROM launchbox_games
WHERE normalized_title = ?
   OR normalized_title LIKE ? ESCAPE '!'
LIMIT 300;

-- name: getGame
SELECT id, title, platform, released, description, developer, publisher, genre
FROM launchbox_games
WHERE id = ?;
