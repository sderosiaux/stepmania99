import type { Difficulty, TimingSource } from '../types';

// ============================================================================
// Song manifest: everything song select needs, without parsing every simfile.
// Built by scripts/generate-songs-manifest.ts with the same parser the game uses.
// ============================================================================

export const MANIFEST_VERSION = 2;

export interface ChartMeta {
  difficulty: Difficulty;
  level: number;
  steps: number;
}

export interface SongEntry {
  id: string;
  pack: string;
  /** Folder under public/songs */
  path: string;
  /** Simfile name inside the folder */
  file: string;
  title: string;
  subtitle?: string;
  artist: string;
  musicFile: string;
  silent?: boolean;
  banner?: string;
  background?: string;
  jacket?: string;
  previewStart: number;
  previewLength: number;
  bpmMin: number;
  bpmMax: number;
  /** Song-level timing, so menus can pulse on the preview's beat before the simfile is loaded */
  timing: TimingSource;
  charts: ChartMeta[];
}

export interface SongManifest {
  version: number;
  generated: string;
  songs: SongEntry[];
}
