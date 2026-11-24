 RetroPie local export (Patch 007)

Choose **RetroPie export** from the library. Select either one indexed collection or **All collections**, choose an output directory and review the proposed paths and size. Change system mappings to match your RetroPie/EmulationStation configuration. The confirmation button is enabled only when the preview has no warnings or conflicts.

The output is under `DESTINATION/roms/<system>/`. Each system contains copied ROM files, `gamelist.xml`, and optionally `images/<cached-artwork-id>`. EmulationStation `<path>` and `<image>` entries are relative to the system folder. The original ROM (including a `.zip`) is copied unmodified; files are **never extracted** during export. No DAT match is required. Metadata may be manual or imported.

Safety and constraints:

- Preview creates no files. Export rechecks the preview and refuses to overwrite any destination file.
- Source directories cannot overlap the destination. Linked source ROMs and redirected output directories are refused.
- No source files are deleted or modified. Destination files created before an error are retained; the operation does not roll back partial exports.
- ROMs from different collections with the same name in the same RetroPie system are collisions and must be resolved before export. No automatic renaming is performed.
- Unknown systems need a folder mapping. A platform mapping does not establish that an emulator supports a given file format; confirm extensions against the configured emulator. RAR and 7z are blocked pending format conversion because RetroPie compatibility is not generally guaranteed; ZIP is copied intact.
- Game artwork is copied from the existing app-data `artwork` cache. Missing artwork is reported in preview. The original ROM directories remain unchanged.
- The export produces ROM-folder gamelists. Existing destination gamelists are never replaced or merged; choose a fresh destination to avoid conflicts.
- Network copying, remote deployment, resuming exports and atomic multi-file rollback are intentionally outside this patch.
