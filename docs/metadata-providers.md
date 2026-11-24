# Patch 008 — retro metadata providers (no API key)

RetroHandler supports three **manual, per-game** metadata operations:

1. **LaunchBox Games Database (offline):** Download `Metadata.zip` from
   https://gamesdb.launchbox-app.com/Metadata.zip, extract `Metadata.xml` using
   Windows Explorer / 7-Zip, then use **Import LaunchBox Metadata.xml** in a
   game's **Add details / Edit details** dialogue. This imports descriptive
   records into RetroHandler's own SQLite catalogue. It does not import ROMs
   or media files. Afterwards, use **Search LaunchBox**, check platform and
   edition, and explicitly select **Use this match**. No API key is required.
   The catalogue is reused offline, and another import replaces it only if
   parsing completes successfully. Do not choose `Metadata.zip` in the dialog.
2. **Libretro Thumbnails:** Use **Find Libretro box art** for a game with an
   assigned, supported platform. RetroHandler looks up box art using the ROM
   filename and title, caches the verified image locally, and previews it.
   Click **Save manual metadata** to retain the image association. No API
   key is required. Missing media returns a message instead of filling an
   unrelated image. Supported platforms are explicitly allowlisted in
   `src/main/metadata/libretro.ts`. Artwork is served from
   https://thumbnails.libretro.com; image licensing/attribution vary by image.
3. **RAWG (optional):** Select RAWG and provide your personal API key for an
   explicitly requested search. The key is not saved.

LaunchBox is a **local XML import**, not an undocumented public API. It is
intentionally not a background scraper. Importing XML does not modify any
existing game metadata. Applying a result does not change manual platform
assignments and preserves a previously cached artwork ID. The library keeps
ROM files read-only. Export to RetroPie still generates configuration only.

Matching is candidate-based, not automatic, to avoid confusing identically
named games on different platforms. Search uses normalized exact and prefix
matches; uncommon alternate titles may need manual searches. Check publisher,
year and platform before choosing a result. Libretro art uses filename-based
matching and is not guaranteed for every ROM revision or region. Covers are
not downloaded until you explicitly request them.

LaunchBox metadata is community-contributed. Respect its database and media
terms for your use, and the respective rights of artwork contributors.
