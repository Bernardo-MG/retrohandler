/** Metadata and paths in the EmulationStation document, not library records. */
export type GameListEntry = {
  path: string;
  name: string;
  description?: string;
  image?: string | null;
  released?: string;
  developer?: string;
  publisher?: string;
  genre?: string;
};
