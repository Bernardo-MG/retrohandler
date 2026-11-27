# RetroHandler

A local Windows desktop ROM collection manager and RetroPie configuration exporter.
ROMs are never copied or modified by configuration export.

## Development

```powershell
npm ci
npm run dev
```

## Build Windows installer

Close any running unpacked RetroHandler build before building. From the repository root:

```powershell
npm ci
npm run build
```

The installer is `release/RetroHandler-Setup-<version>-x64.exe`.

The manual **Windows package** GitHub Actions workflow also builds and uploads an installer
artifact without publishing a release.

## Formatting commands

```powershell
npm run format
npm run format:check
```

## Validation

```powershell
npm run validate
```
