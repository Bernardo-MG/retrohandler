export type Rom = {
  id: string;
  name: string;
  system: string;
  relativePath: string;
  extension: string;
  bytes: number;
};
export type ScanResult = {
  source: string;
  games: Rom[];
  ignored: number;
  scannedAt: string;
};
export interface DesktopApi {
  chooseRomFolder(): Promise<string | null>;
  scanFolder(folder: string): Promise<ScanResult>;
}
