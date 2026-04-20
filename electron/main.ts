import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { extractLayoutText } from './mftrPdf';

const isDev = process.env.NODE_ENV === 'development';
let db: Database.Database;
let dbPath: string;
let mainWindow: BrowserWindow | null = null;

function hasColumn(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some(r => r.name === col);
}

function migrateAddColumn(table: string, col: string, def: string) {
  if (!hasColumn(table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`Migration: ${table}.${col} added`);
  }
}

function initDatabase() {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'logbook.db');
  console.log('DB location:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month TEXT NOT NULL,
      sub_index INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, month, sub_index)
    );

    CREATE TABLE IF NOT EXISTS flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL,
      date TEXT,
      takeoffs INTEGER,
      landings INTEGER,
      total_min INTEGER,
      pic_total_min INTEGER,
      sic_total_min INTEGER,
      pic_min INTEGER,
      pic_xc_min INTEGER,
      pic_nt_min INTEGER,
      sic_min INTEGER,
      co_dual_min INTEGER,
      xc_min INTEGER,
      night_min INTEGER,
      hood_min INTEGER,
      sim_min INTEGER,
      train_min INTEGER,
      imc_min INTEGER,
      other_min INTEGER,
      aircraft TEXT,
      registration TEXT,
      flight_no TEXT,
      route TEXT,
      notes TEXT,
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
      UNIQUE(page_id, row_index)
    );

    CREATE TABLE IF NOT EXISTS cumulative_base (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      takeoffs INTEGER DEFAULT 0,
      landings INTEGER DEFAULT 0,
      total_min INTEGER DEFAULT 0,
      pic_total_min INTEGER DEFAULT 0,
      sic_total_min INTEGER DEFAULT 0,
      pic_min INTEGER DEFAULT 0,
      pic_xc_min INTEGER DEFAULT 0,
      pic_nt_min INTEGER DEFAULT 0,
      sic_min INTEGER DEFAULT 0,
      co_dual_min INTEGER DEFAULT 0,
      xc_min INTEGER DEFAULT 0,
      night_min INTEGER DEFAULT 0,
      hood_min INTEGER DEFAULT 0,
      sim_min INTEGER DEFAULT 0,
      train_min INTEGER DEFAULT 0,
      imc_min INTEGER DEFAULT 0,
      other_min INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO cumulative_base (id) VALUES (1);
  `);

  // --- マイグレーション: 既存DBに新5列を追加 ---
  for (const table of ['flights', 'cumulative_base']) {
    const intDef = table === 'flights' ? 'INTEGER' : 'INTEGER DEFAULT 0';
    migrateAddColumn(table, 'pic_total_min', intDef);
    migrateAddColumn(table, 'sic_total_min', intDef);
    migrateAddColumn(table, 'co_dual_min',   intDef);
    migrateAddColumn(table, 'hood_min',      intDef);
    migrateAddColumn(table, 'train_min',     intDef);
  }
  // takeoffs_night / landings_night: 夜間の "N1" 表記用フラグ (0/1)
  migrateAddColumn('flights', 'takeoffs_night', 'INTEGER DEFAULT 0');
  migrateAddColumn('flights', 'landings_night', 'INTEGER DEFAULT 0');

  console.log('Database initialized');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#020617',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ========================================
// 基本の IPC ハンドラ（DB CRUD）
// ========================================

ipcMain.handle('db:getPages', () => {
  return db.prepare('SELECT * FROM pages ORDER BY year, month, sub_index').all();
});

ipcMain.handle('db:getFlights', (_, pageId: number) => {
  return db.prepare('SELECT * FROM flights WHERE page_id = ? ORDER BY row_index').all(pageId);
});

ipcMain.handle('db:createPage', (_, { year, month, subIndex }) => {
  const stmt = db.prepare('INSERT INTO pages (year, month, sub_index) VALUES (?, ?, ?)');
  const result = stmt.run(year, month, subIndex);
  return result.lastInsertRowid;
});

ipcMain.handle('db:upsertFlight', (_, flight) => {
  const stmt = db.prepare(`
    INSERT INTO flights (
      page_id, row_index, date, takeoffs, landings, takeoffs_night, landings_night, total_min,
      pic_total_min, sic_total_min,
      pic_min, pic_xc_min, pic_nt_min,
      sic_min, co_dual_min, xc_min, night_min,
      hood_min, sim_min, train_min, imc_min, other_min,
      aircraft, registration, flight_no, route, notes
    ) VALUES (
      @page_id, @row_index, @date, @takeoffs, @landings, @takeoffs_night, @landings_night, @total_min,
      @pic_total_min, @sic_total_min,
      @pic_min, @pic_xc_min, @pic_nt_min,
      @sic_min, @co_dual_min, @xc_min, @night_min,
      @hood_min, @sim_min, @train_min, @imc_min, @other_min,
      @aircraft, @registration, @flight_no, @route, @notes
    )
    ON CONFLICT(page_id, row_index) DO UPDATE SET
      date=@date, takeoffs=@takeoffs, landings=@landings,
      takeoffs_night=@takeoffs_night, landings_night=@landings_night, total_min=@total_min,
      pic_total_min=@pic_total_min, sic_total_min=@sic_total_min,
      pic_min=@pic_min, pic_xc_min=@pic_xc_min, pic_nt_min=@pic_nt_min,
      sic_min=@sic_min, co_dual_min=@co_dual_min, xc_min=@xc_min, night_min=@night_min,
      hood_min=@hood_min, sim_min=@sim_min, train_min=@train_min,
      imc_min=@imc_min, other_min=@other_min,
      aircraft=@aircraft, registration=@registration, flight_no=@flight_no,
      route=@route, notes=@notes
  `);
  return stmt.run(flight);
});

ipcMain.handle('db:getCumulativeBase', () => {
  return db.prepare('SELECT * FROM cumulative_base WHERE id = 1').get();
});

ipcMain.handle('db:setCumulativeBase', (_, base) => {
  const stmt = db.prepare(`
    UPDATE cumulative_base SET
      takeoffs=@takeoffs, landings=@landings, total_min=@total_min,
      pic_total_min=@pic_total_min, sic_total_min=@sic_total_min,
      pic_min=@pic_min, pic_xc_min=@pic_xc_min, pic_nt_min=@pic_nt_min,
      sic_min=@sic_min, co_dual_min=@co_dual_min, xc_min=@xc_min, night_min=@night_min,
      hood_min=@hood_min, sim_min=@sim_min, train_min=@train_min,
      imc_min=@imc_min, other_min=@other_min
    WHERE id = 1
  `);
  return stmt.run(base);
});

// ========================================
// Export / Import ハンドラ
// ========================================

ipcMain.handle('db:export', async () => {
  if (!mainWindow) return { success: false, error: 'No window' };

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const defaultName = `logbook-backup-${dateStr}.db`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Logbook Database',
    defaultPath: defaultName,
    filters: [{ name: 'Database File', extensions: ['db'] }],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }

  try {
    await db.backup(result.filePath);
    return { success: true, path: result.filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:import', async () => {
  if (!mainWindow) return { success: false, error: 'No window' };

  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['キャンセル', 'インポート実行'],
    defaultId: 0,
    cancelId: 0,
    title: 'データのインポート',
    message: '現在のデータがすべて上書きされます',
    detail: 'この操作は取り消せません。\n実行前に現在のデータをExportしておくことを強く推奨します。\n\n続行しますか？',
  });

  if (confirm.response !== 1) {
    return { success: false, error: 'Cancelled by user' };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Logbook Database',
    filters: [{ name: 'Database File', extensions: ['db'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }

  const sourcePath = result.filePaths[0];

  try {
    const testDb = new Database(sourcePath, { readonly: true });
    const check = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='flights'").get();
    testDb.close();

    if (!check) {
      return { success: false, error: 'このファイルは Pilot Logbook のDBではありません' };
    }

    const autoBackupPath = dbPath + '.before-import-' + Date.now();
    fs.copyFileSync(dbPath, autoBackupPath);
    console.log('Auto-backup saved to:', autoBackupPath);

    db.close();

    fs.copyFileSync(sourcePath, dbPath);

    app.relaunch();
    app.exit(0);

    return { success: true };
  } catch (err: any) {
    initDatabase();
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:revealInFinder', () => {
  shell.showItemInFolder(dbPath);
});

// ========================================
// 削除系: ページ単位 / 月単位 / 全削除
// ON DELETE CASCADE は foreign_keys=OFF だと発火しないので
// flights → pages を明示的に transaction で削除する
// ========================================

// 同月の sub_index を 1..N に詰め直す (歯抜け防止)
function renumberMonthSubIndices(year: number, month: string) {
  const remaining = db.prepare(
    'SELECT id, sub_index FROM pages WHERE year = ? AND month = ? ORDER BY sub_index'
  ).all(year, month) as { id: number; sub_index: number }[];
  const upd = db.prepare('UPDATE pages SET sub_index = ? WHERE id = ?');
  remaining.forEach((p, i) => {
    const newIdx = i + 1;
    if (p.sub_index !== newIdx) upd.run(newIdx, p.id);
  });
}

ipcMain.handle('db:deletePage', (_, pageId: number) => {
  try {
    const page = db.prepare('SELECT year, month FROM pages WHERE id = ?').get(pageId) as
      | { year: number; month: string } | undefined;
    if (!page) return { success: false, error: 'Page not found' };

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM flights WHERE page_id = ?').run(pageId);
      db.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
      renumberMonthSubIndices(page.year, page.month);
    });
    tx();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:deleteMonth', (_, { year, month }: { year: number; month: string }) => {
  try {
    const tx = db.transaction(() => {
      const pageIds = db.prepare(
        'SELECT id FROM pages WHERE year = ? AND month = ?'
      ).all(year, month) as { id: number }[];
      const delF = db.prepare('DELETE FROM flights WHERE page_id = ?');
      const delP = db.prepare('DELETE FROM pages WHERE id = ?');
      for (const { id } of pageIds) {
        delF.run(id);
        delP.run(id);
      }
    });
    tx();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:clearAllData', () => {
  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM flights').run();
      db.prepare('DELETE FROM pages').run();
      db.prepare(`UPDATE cumulative_base SET
        takeoffs=0, landings=0, total_min=0,
        pic_total_min=0, sic_total_min=0,
        pic_min=0, pic_xc_min=0, pic_nt_min=0,
        sic_min=0, co_dual_min=0, xc_min=0, night_min=0,
        hood_min=0, sim_min=0, train_min=0,
        imc_min=0, other_min=0
        WHERE id = 1`).run();
    });
    tx();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ========================================
// MFTR PDF 取り込み: ファイル選択 + テキスト抽出
// パース (parseMftrLayout) は renderer 側で行う
// ========================================

ipcMain.handle('mftr:pickPdf', async () => {
  if (!mainWindow) return { success: false, error: 'No window' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'MFTR PDF を選択',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }

  const filePath = result.filePaths[0];
  try {
    const rawText = await extractLayoutText(filePath);
    return { success: true, filePath, rawText };
  } catch (err: any) {
    return { success: false, error: `PDF 読み込み失敗: ${err.message}` };
  }
});

ipcMain.handle('mftr:parsePdf', async (_, filePath: string) => {
  try {
    const rawText = await extractLayoutText(filePath);
    return { success: true, rawText };
  } catch (err: any) {
    return { success: false, error: `PDF 読み込み失敗: ${err.message}` };
  }
});

ipcMain.handle('db:getDbInfo', () => {
  try {
    const stats = fs.statSync(dbPath);
    return {
      path: dbPath,
      sizeKB: Math.round(stats.size / 1024),
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
});

// ========================================
// App lifecycle
// ========================================

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) db.close();
});
