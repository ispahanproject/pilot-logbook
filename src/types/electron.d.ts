import type { DbPage, DbFlight, DbCumulativeBase } from '../lib/db';

export interface DbInfo {
  path: string;
  sizeKB: number;
  modifiedAt: string;
}

export interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface MftrPickResult {
  success: boolean;
  filePath?: string;
  rawText?: string;
  error?: string;
}

export interface MftrParseResult {
  success: boolean;
  rawText?: string;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface LogbookAPI {
  getPages: () => Promise<DbPage[]>;
  getFlights: (pageId: number) => Promise<DbFlight[]>;
  createPage: (data: { year: number; month: string; subIndex: number }) => Promise<number>;
  upsertFlight: (flight: DbFlight) => Promise<unknown>;
  getCumulativeBase: () => Promise<DbCumulativeBase | null>;
  setCumulativeBase: (base: Omit<DbCumulativeBase, 'id'>) => Promise<unknown>;

  exportDatabase: () => Promise<ExportResult>;
  importDatabase: () => Promise<ExportResult>;
  revealDbInFinder: () => Promise<void>;
  getDbInfo: () => Promise<DbInfo | null>;

  deletePage: (pageId: number) => Promise<DeleteResult>;
  deleteMonth: (year: number, month: string) => Promise<DeleteResult>;
  clearAllData: () => Promise<DeleteResult>;

  pickMftrPdf: () => Promise<MftrPickResult>;
  parseMftrPdf: (filePath: string) => Promise<MftrParseResult>;
}

declare global {
  interface Window {
    logbookAPI: LogbookAPI;
  }
}
