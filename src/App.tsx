import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plane, TrendingUp, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  BarChart3, Target, Award, Moon, CloudFog, Download, Calendar, Upload, FolderOpen,
  Settings, Pencil, Check, X, FileText, AlertTriangle, Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DbInfo } from './types/electron';
import {
  parseMftrLayout,
  computeTotalsFromFlights,
  validateAgainstFooter,
  validateAgainstBodyTotal,
  mftrFlightToRow,
  type MftrParseResult,
  type ValidationDiff,
} from './lib/mftrParser';
import {
  type Row,
  type RowKey,
  type Cumulative,
  type Page,
  type DbFlight,
  toMin,
  fromMin,
  fmtCum,
  emptyRow,
  zeroCumulative,
  sumRows,
  addCumulative,
  dbFlightToRow,
  rowToDbFlight,
  dbCumBaseToCumulative,
  cumulativeToDbCumBase,
  sortPages,
  monthKey as monthKeyOf,
  isSimTrainingRow,
} from './lib/db';

// ========================================
// Constants
// ========================================

type TabId = 'page' | 'dashboard' | 'analysis' | 'goals' | 'settings';

type UserMode = 'captain' | 'fo';

const USER_MODE_KEY = 'pilotLogbook.userMode';
const USER_AIRCRAFT_KEY = 'pilotLogbook.defaultAircraft';
const USER_NAME_KEY = 'pilotLogbook.userName';
const AIRCRAFT_OPTIONS = ['B738', 'B767', 'B777', 'B787', 'A350'] as const;
type AircraftOption = typeof AIRCRAFT_OPTIONS[number];
const DEFAULT_AIRCRAFT_FALLBACK: AircraftOption = 'B738';
const isAircraftOption = (v: string): v is AircraftOption =>
  (AIRCRAFT_OPTIONS as readonly string[]).includes(v);

type ColGroup = 'info' | 'legs' | 'time' | 'roleTotal' | 'pus' | 'co' | 'special' | 'notes';

interface ColumnDef {
  key: RowKey;
  label: string;
  width: number;
  type: 'text' | 'num' | 'time';
  align: 'left' | 'center' | 'right';
  group: ColGroup;
  // group 境界とは独立に divider を強制 ON/OFF したいときの上書き
  dividerBefore?: boolean;
}

// 新順序: 月日 / 型式 / 登録記号 / 区間 / 便名 / 離着陸 / 飛行時間 / PIC / SIC / PUS系 / CO系 / HOOD / INST / SIM / OTHER / RMKS
const COLUMNS: ColumnDef[] = [
  { key: 'date',     label: '月日',      width: 70,  type: 'text', align: 'center', group: 'info'      },
  { key: 'aircraft', label: '型式',      width: 90,  type: 'text', align: 'center', group: 'info'      },
  { key: 'reg',      label: '登録記号',  width: 90,  type: 'text', align: 'center', group: 'info'      },
  { key: 'route',    label: 'LEG',          width: 110, type: 'text', align: 'center', group: 'info'      },
  { key: 'flightNo', label: 'FLIGHT or SIM', width: 110, type: 'text', align: 'center', group: 'info'      },
  { key: 'to',       label: '離陸',      width: 50,  type: 'num',  align: 'center', group: 'legs'      },
  { key: 'ldg',      label: '着陸',      width: 50,  type: 'num',  align: 'center', group: 'legs'      },
  { key: 'total',    label: '飛行時間',  width: 92,  type: 'time', align: 'center', group: 'time'      },
  { key: 'picTotal', label: 'PIC',       width: 75,  type: 'time', align: 'center', group: 'roleTotal' },
  { key: 'sicTotal', label: 'SIC',       width: 75,  type: 'time', align: 'center', group: 'roleTotal' },
  { key: 'pic',      label: 'PUS',       width: 75,  type: 'time', align: 'center', group: 'pus', dividerBefore: false },
  { key: 'picXC',    label: 'PUS(X/C)',  width: 85,  type: 'time', align: 'center', group: 'pus', dividerBefore: true  },
  { key: 'picNT',    label: 'NGT',       width: 70,  type: 'time', align: 'center', group: 'pus'       },
  { key: 'sic',      label: 'CO',        width: 70,  type: 'time', align: 'center', group: 'co'        },
  { key: 'coDual',   label: '同乗',      width: 70,  type: 'time', align: 'center', group: 'co'        },
  { key: 'xc',       label: 'CO(X/C)',   width: 85,  type: 'time', align: 'center', group: 'co', dividerBefore: true  },
  { key: 'night',    label: 'NGT',       width: 70,  type: 'time', align: 'center', group: 'co'        },
  { key: 'hood',     label: 'HOOD',      width: 70,  type: 'time', align: 'center', group: 'special'   },
  { key: 'imc',      label: 'INST',      width: 70,  type: 'time', align: 'center', group: 'special'   },
  { key: 'sim',      label: 'SIM',       width: 70,  type: 'time', align: 'center', group: 'special'   },
  { key: 'other',    label: 'OTHER',     width: 70,  type: 'time', align: 'center', group: 'special'   },
  { key: 'notes',    label: 'RMKS',      width: 200, type: 'text', align: 'center', group: 'notes'     },
];

// グループ境界かどうか (dividerBefore による上書きを優先)
const isGroupStart = (idx: number): boolean => {
  if (idx === 0) return false;
  const c = COLUMNS[idx];
  if (c.dividerBefore !== undefined) return c.dividerBefore;
  return c.group !== COLUMNS[idx - 1].group;
};

// 各グループの薄い背景色（データ行とヘッダで色を変える）
// `time` は主役カラムなので他より一段強いハイライト。
const groupTintCell = (g: ColGroup): string => {
  if (g === 'legs')      return 'bg-emerald-400/[0.03]';
  if (g === 'time')      return 'bg-amber-400/[0.06]';
  if (g === 'pus')       return 'bg-amber-400/[0.03]';
  if (g === 'co')        return 'bg-cyan-400/[0.03]';
  if (g === 'roleTotal') return 'bg-slate-800/30';
  return '';
};
const groupTintHeader = (g: ColGroup): string => {
  if (g === 'legs')      return 'bg-emerald-400/10';
  if (g === 'time')      return 'bg-amber-400/20';
  if (g === 'pus')       return 'bg-amber-400/10';
  if (g === 'co')        return 'bg-cyan-400/10';
  if (g === 'roleTotal') return 'bg-slate-700/50';
  return '';
};
const groupTextHeader = (g: ColGroup): string => {
  if (g === 'legs')      return 'text-emerald-300';
  if (g === 'time')      return 'text-amber-300 font-semibold';
  if (g === 'pus')       return 'text-amber-300';
  if (g === 'co')        return 'text-cyan-300';
  if (g === 'roleTotal') return 'text-slate-200';
  return 'text-slate-300';
};

// グループ境界に引く太めの左罫線
const GROUP_DIVIDER = 'border-l-2 border-l-slate-600';

const ROWS_PER_PAGE = 15;

const YEARS = Array.from({ length: 15 }, (_, i) => 2020 + i);
const MONTHS: { val: string; label: string; ja: string }[] = [
  { val: '01', label: 'JAN', ja: '1月' }, { val: '02', label: 'FEB', ja: '2月' },
  { val: '03', label: 'MAR', ja: '3月' }, { val: '04', label: 'APR', ja: '4月' },
  { val: '05', label: 'MAY', ja: '5月' }, { val: '06', label: 'JUN', ja: '6月' },
  { val: '07', label: 'JUL', ja: '7月' }, { val: '08', label: 'AUG', ja: '8月' },
  { val: '09', label: 'SEP', ja: '9月' }, { val: '10', label: 'OCT', ja: '10月' },
  { val: '11', label: 'NOV', ja: '11月' }, { val: '12', label: 'DEC', ja: '12月' },
];

const DEBOUNCE_MS = 500;

// ========================================
// DB load / seed
// ========================================

async function loadAllFromDb(): Promise<{ pages: Page[]; cumBase: Cumulative }> {
  const api = window.logbookAPI;

  const dbCumBase = await api.getCumulativeBase();
  const dbPages = await api.getPages();

  const cumBase = dbCumBaseToCumulative(dbCumBase);

  const pages: Page[] = await Promise.all(
    dbPages.map(async dp => {
      const flights = await api.getFlights(dp.id);
      const rows: Row[] = Array.from({ length: ROWS_PER_PAGE }, emptyRow);
      flights.forEach(f => {
        if (f.row_index >= 0 && f.row_index < ROWS_PER_PAGE) {
          rows[f.row_index] = dbFlightToRow(f);
        }
      });
      return {
        id: dp.id,
        year: dp.year,
        month: dp.month,
        subIndex: dp.sub_index,
        rows,
      };
    }),
  );

  return { pages: sortPages(pages), cumBase };
}

// ========================================
// Main component
// ========================================

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('page');
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<Page[]>([]);
  const [cumBase, setCumBase] = useState<Cumulative>(zeroCumulative());
  const [currentPageIdx, setCurrentPageIdx] = useState(0);

  // --- User mode (CAPT / FO) ---
  const [userMode, setUserModeRaw] = useState<UserMode>(() => {
    if (typeof window === 'undefined') return 'fo';
    const saved = window.localStorage.getItem(USER_MODE_KEY);
    return saved === 'captain' || saved === 'fo' ? saved : 'fo';
  });
  const setUserMode = (m: UserMode) => {
    setUserModeRaw(m);
    try { window.localStorage.setItem(USER_MODE_KEY, m); } catch { /* ignore */ }
  };

  // --- Default aircraft (型式) ---
  // ユーザーが日常的に乗る機種を1つ設定 → 新規行の型式列に自動挿入
  const [userAircraft, setUserAircraftRaw] = useState<AircraftOption>(() => {
    if (typeof window === 'undefined') return DEFAULT_AIRCRAFT_FALLBACK;
    const saved = window.localStorage.getItem(USER_AIRCRAFT_KEY) ?? '';
    return isAircraftOption(saved) ? saved : DEFAULT_AIRCRAFT_FALLBACK;
  });
  const setUserAircraft = (v: AircraftOption) => {
    setUserAircraftRaw(v);
    try { window.localStorage.setItem(USER_AIRCRAFT_KEY, v); } catch { /* ignore */ }
  };

  // --- Pilot name (header に表示) ---
  const [userName, setUserNameRaw] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(USER_NAME_KEY) ?? '';
  });
  const setUserName = (v: string) => {
    setUserNameRaw(v);
    try { window.localStorage.setItem(USER_NAME_KEY, v); } catch { /* ignore */ }
  };
  const displayName = userName.trim() || 'Pilot';
  const avatarChar = (userName.trim()[0] || 'P').toUpperCase();

  // モード別の自動転記
  //   FO   + 1/1        → PUS (pic) + PUS(X/C) (picXC)
  //   FO   + それ以外   → CO  (sic) + CO(X/C)  (xc)       ※離着陸ブランク含む
  //   CAPT + 1/1        → PIC (picTotal) のみ
  //   CAPT + それ以外   → PIC (picTotal) + PUS(X/C) (picXC) ※離着陸ブランク含む
  // 離着陸ブランクは parseInt('')||0 = 0 で自然に「1/1 ではない」扱いになる
  const applyAutoFill = (r: Row, mode: UserMode): Row => {
    if (!r.total) return r;
    // "N1" / "1N" など夜間表記を許容して数値抽出
    const parseLeg = (s: string): number => {
      const m = (s || '').trim().match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    const to  = parseLeg(r.to);
    const ldg = parseLeg(r.ldg);
    const single = to === 1 && ldg === 1;

    if (mode === 'fo') {
      if (single) {
        // FO + 1/1 → PUS + PUS(X/C)、RMKS が空なら "PUS" を自動記載
        const notes = r.notes && r.notes.trim() ? r.notes : 'PUS';
        return { ...r, pic: r.total, picXC: r.total, sic: '', xc: '', notes };
      }
      // FO + それ以外 → CO + CO(X/C)
      return { ...r, sic: r.total, xc: r.total, pic: '', picXC: '' };
    }

    // CAPT モード
    if (single) {
      // CAPT + 1/1 → PIC のみ（単脚は X/C 付かず）
      return { ...r, picTotal: r.total, picXC: '' };
    }
    // CAPT + それ以外 → PIC + PUS(X/C)
    return { ...r, picTotal: r.total, picXC: r.total };
  };

  // 初回ロード
  useEffect(() => {
    (async () => {
      try {
        const { pages, cumBase } = await loadAllFromDb();
        setPages(pages);
        setCumBase(cumBase);
        if (pages.length > 0) setCurrentPageIdx(pages.length - 1);
      } catch (err) {
        console.error('DB load failed', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- 保存のデバウンス管理 ---
  // 1行ごとにタイマーを持つ: key = `${pageId}:${rowIdx}`
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleSaveRow = (pageId: number, rowIdx: number, row: Row) => {
    const key = `${pageId}:${rowIdx}`;
    const prev = saveTimers.current.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      const flight: DbFlight = rowToDbFlight(row, pageId, rowIdx);
      window.logbookAPI.upsertFlight(flight).catch(err => console.error('upsertFlight failed', err));
      saveTimers.current.delete(key);
    }, DEBOUNCE_MS);
    saveTimers.current.set(key, t);
  };

  // アンマウント時に保留中タイマーを flush
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, []);

  // --- Derived: 各ページの「前項まで」累計 ---
  const pagePrevCumulatives = useMemo<Cumulative[]>(() => {
    const out: Cumulative[] = [];
    let running = cumBase;
    for (const p of pages) {
      out.push(running);
      running = addCumulative(running, sumRows(p.rows));
    }
    return out;
  }, [pages, cumBase]);

  const page = pages[currentPageIdx];
  const pagePrev = page ? pagePrevCumulatives[currentPageIdx] : zeroCumulative();

  const pageSum = useMemo(() => (page ? sumRows(page.rows) : zeroCumulative()), [page]);

  const monthTotal = useMemo(() => {
    if (!page) return { sum: zeroCumulative(), pageCount: 0 };
    const mk = monthKeyOf(page);
    const sameMonthPages = pages.filter(p => monthKeyOf(p) === mk);
    const allRows = sameMonthPages.flatMap(p => p.rows);
    return { sum: sumRows(allRows), pageCount: sameMonthPages.length };
  }, [pages, page]);

  const cumulative = useMemo<Cumulative>(() => addCumulative(pagePrev, pageSum), [pagePrev, pageSum]);

  // --- Derived: 月ごとにページをグループ化（ページセレクタ用） ---
  const monthsIndex = useMemo(() => {
    const map = new Map<string, { year: number; month: string; subPages: { page: Page; idx: number }[]; totalMin: number }>();
    pages.forEach((p, idx) => {
      const key = monthKeyOf(p);
      if (!map.has(key)) map.set(key, { year: p.year, month: p.month, subPages: [], totalMin: 0 });
      const entry = map.get(key)!;
      entry.subPages.push({ page: p, idx });
      entry.totalMin += sumRows(p.rows).total;
    });
    return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month < b.month ? -1 : 1;
    });
  }, [pages]);

  const currentMonthKey = page ? monthKeyOf(page) : '';
  const currentMonthEntry = monthsIndex.find(m => m.key === currentMonthKey);

  const pageName = (p: Page): string => {
    const m = MONTHS.find(x => x.val === p.month);
    const base = `${p.year}${m ? m.label : p.month}`;
    return p.subIndex > 1 ? `${base}-${p.subIndex}` : base;
  };

  // 時間カラムの blur 時に `HHMM` を `HH:MM` に再フォーマット
  // - 3桁以上の数字のみ → 末尾2桁=分、それ以外=時（例: 143 → 1:43、1234 → 12:34）
  // - `:` や `.` を含む入力、1-2桁の数字は触らない
  const normalizeTimeOnBlur = (rowIdx: number, key: RowKey, value: string) => {
    const col = COLUMNS.find(c => c.key === key);
    if (!col || col.type !== 'time') return;
    const t = value.trim();
    if (!/^\d{3,}$/.test(t)) return;
    const mm = t.slice(-2);
    const hh = t.slice(0, -2);
    const normalized = `${parseInt(hh, 10)}:${mm}`;
    if (normalized !== value) {
      updateCell(rowIdx, key, normalized);
    }
  };

  // 月日カラムの blur 時に `MM.DD` (ゼロ埋め2桁ずつ) に再フォーマット
  // - "5"      → 現ページ月で補完 (例: 12月ページなら "12.05")
  // - "12"     → 現ページ月 + 12日 (例: "12.12")
  // - "1205"   → "12.05"
  // - "12.5"   / "12/5" / "12-5" → "12.05"
  // - 既に "MM.DD" → 触らない
  const normalizeDateOnBlur = (rowIdx: number, value: string) => {
    if (!page) return;
    const t = value.trim();
    if (!t) return;
    if (/^\d{2}\.\d{2}$/.test(t)) return;

    let mm: string | null = null;
    let dd: string | null = null;

    const sep = t.match(/^(\d{1,2})[./\-](\d{1,2})$/);
    if (sep) {
      mm = sep[1].padStart(2, '0');
      dd = sep[2].padStart(2, '0');
    } else if (/^\d{1,2}$/.test(t)) {
      mm = page.month;
      dd = t.padStart(2, '0');
    } else if (/^\d{4}$/.test(t)) {
      mm = t.slice(0, 2);
      dd = t.slice(2);
    } else if (/^\d{3}$/.test(t)) {
      mm = '0' + t[0];
      dd = t.slice(1);
    }

    if (!mm || !dd) return;
    const normalized = `${mm}.${dd}`;
    if (normalized !== value) updateCell(rowIdx, 'date', normalized);
  };

  const updateCell = (rowIdx: number, key: RowKey, value: string) => {
    if (!page) return;
    const pageId = page.id;

    setPages(prev => prev.map(p => {
      if (p.id !== pageId) return p;
      const newRows = [...p.rows];
      let updated: Row = { ...newRows[rowIdx], [key]: value };
      // 離着陸 / 飛行時間 の編集時にモード別の自動転記を適用
      if (key === 'to' || key === 'ldg' || key === 'total') {
        updated = applyAutoFill(updated, userMode);
      }
      // 型式列が空の行で他列を編集した瞬間、デフォルト機種を自動挿入
      // （型式列自体の編集時は空文字を許可 = ユーザーの意思を尊重）
      if (
        key !== 'aircraft' &&
        !updated.aircraft &&
        userAircraft &&
        value.trim() !== ''
      ) {
        updated = { ...updated, aircraft: userAircraft };
      }
      newRows[rowIdx] = updated;
      // この行だけ保存キューへ（最新 row を渡す）
      scheduleSaveRow(pageId, rowIdx, updated);
      return { ...p, rows: newRows };
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const target = e.currentTarget;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIdx + 1}-${colIdx}"]`);
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIdx - 1}-${colIdx}"]`);
      next?.focus();
    } else if (e.key === 'ArrowRight' && target.selectionStart === target.value.length) {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIdx}-${colIdx + 1}"]`);
      next?.focus();
    } else if (e.key === 'ArrowLeft' && target.selectionStart === 0) {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIdx}-${colIdx - 1}"]`);
      next?.focus();
    }
  };

  // --- NEW PAGE ダイアログ ---
  const [showNewPageDialog, setShowNewPageDialog] = useState(false);
  const [newPageYear, setNewPageYear] = useState(2025);
  const [newPageMonth, setNewPageMonth] = useState('12');

  const openNewPageDialog = () => {
    if (page) {
      setNewPageYear(page.year);
      setNewPageMonth(page.month);
    }
    setShowNewPageDialog(true);
  };

  const createNewPage = async () => {
    const sameMonthCount = pages.filter(p => p.year === newPageYear && p.month === newPageMonth).length;
    const subIndex = sameMonthCount + 1;
    try {
      const newId = await window.logbookAPI.createPage({
        year: newPageYear,
        month: newPageMonth,
        subIndex,
      });
      const newPage: Page = {
        id: Number(newId),
        year: newPageYear,
        month: newPageMonth,
        subIndex,
        rows: Array.from({ length: ROWS_PER_PAGE }, emptyRow),
      };
      setPages(prev => {
        const merged = sortPages([...prev, newPage]);
        const idx = merged.findIndex(p => p.id === newPage.id);
        if (idx >= 0) setCurrentPageIdx(idx);
        return merged;
      });
      setShowNewPageDialog(false);
    } catch (err) {
      console.error('createPage failed', err);
      alert('ページ作成に失敗しました: ' + (err as Error).message);
    }
  };

  // --- Delete page / month / all ---
  const countRowsWithData = (rows: Row[]) =>
    rows.filter(r => r.date || r.total || r.flightNo || r.route).length;

  const deletePage = async () => {
    if (!page) return;
    const rowCount = countRowsWithData(page.rows);
    const ok = window.confirm(
      `${pageName(page)} を削除します。\n` +
      `フライト ${rowCount} 件が消えます。\n` +
      `同月の他のサブページは番号が詰められます。\n` +
      `この操作は取り消せません。続行しますか？`
    );
    if (!ok) return;
    try {
      const res = await window.logbookAPI.deletePage(page.id);
      if (!res.success) {
        alert('削除失敗: ' + (res.error || 'unknown'));
        return;
      }
      const { pages: newPages, cumBase: newCumBase } = await loadAllFromDb();
      setPages(newPages);
      setCumBase(newCumBase);
      setCurrentPageIdx(prev => Math.min(prev, Math.max(0, newPages.length - 1)));
    } catch (err) {
      console.error('deletePage failed', err);
      alert('削除失敗: ' + (err as Error).message);
    }
  };

  const deleteCurrentMonth = async () => {
    if (!page) return;
    const year = page.year;
    const month = page.month;
    const sameMonth = pages.filter(p => p.year === year && p.month === month);
    const rowCount = sameMonth.reduce((s, p) => s + countRowsWithData(p.rows), 0);
    const monthLabel = MONTHS.find(m => m.val === month)?.label || month;
    const ok = window.confirm(
      `${year}年 ${monthLabel} の全 ${sameMonth.length} ページ` +
      `（フライト ${rowCount} 件）を削除します。\n` +
      `この操作は取り消せません。続行しますか？`
    );
    if (!ok) return;
    try {
      const res = await window.logbookAPI.deleteMonth(year, month);
      if (!res.success) {
        alert('削除失敗: ' + (res.error || 'unknown'));
        return;
      }
      const { pages: newPages, cumBase: newCumBase } = await loadAllFromDb();
      setPages(newPages);
      setCumBase(newCumBase);
      setCurrentPageIdx(prev => Math.min(prev, Math.max(0, newPages.length - 1)));
    } catch (err) {
      console.error('deleteMonth failed', err);
      alert('削除失敗: ' + (err as Error).message);
    }
  };

  const clearAllData = async () => {
    const totalPages = pages.length;
    const totalFlights = pages.reduce((s, p) => s + countRowsWithData(p.rows), 0);
    const phrase = 'DELETE';
    const input = window.prompt(
      `全データを削除します（${totalPages} ページ・フライト ${totalFlights} 件・累計値もゼロに）。\n` +
      `この操作は取り消せません。\n\n` +
      `続行するには "${phrase}" と入力してください:`
    );
    if (input !== phrase) return;
    try {
      const res = await window.logbookAPI.clearAllData();
      if (!res.success) {
        alert('全削除失敗: ' + (res.error || 'unknown'));
        return;
      }
      const { pages: newPages, cumBase: newCumBase } = await loadAllFromDb();
      setPages(newPages);
      setCumBase(newCumBase);
      setCurrentPageIdx(0);
    } catch (err) {
      console.error('clearAllData failed', err);
      alert('全削除失敗: ' + (err as Error).message);
    }
  };

  // --- CSV ---
  const exportCSV = () => {
    if (!page) return;
    const headers = COLUMNS.map(c => c.label).join(',');
    const rows = page.rows.map(r => COLUMNS.map(c => `"${r[c.key] || ''}"`).join(',')).join('\n');
    const csv = `${pageName(page)}\n${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageName(page)}.csv`;
    a.click();
  };

  // --- View helpers ---
  const TabButton = ({ id, icon: Icon, label }: { id: TabId; icon: LucideIcon; label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium tracking-wide transition-all border-b-2 ${
        activeTab === id ? 'text-amber-400 border-amber-400' : 'text-slate-400 border-transparent hover:text-slate-200'
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );

  const totalWidth = COLUMNS.reduce((s, c) => s + c.width, 0) + 40;
  const colorFor = (key: RowKey): string => {
    // 離着陸カウント
    if (key === 'to' || key === 'ldg') return 'text-emerald-300/90';
    // PIC 系（機長）
    if (key === 'picTotal') return 'text-amber-300';
    if (key === 'pic' || key === 'picXC' || key === 'picNT') return 'text-amber-400/90';
    // SIC 系（副操縦士）
    if (key === 'sicTotal') return 'text-cyan-300';
    if (key === 'sic' || key === 'coDual' || key === 'xc') return 'text-cyan-400/90';
    // 夜間
    if (key === 'night') return 'text-violet-400/90';
    // 計器
    if (key === 'imc') return 'text-rose-400/90';
    if (key === 'hood') return 'text-rose-300/80';
    // 訓練系
    if (key === 'sim')   return 'text-slate-300';
    if (key === 'train') return 'text-slate-400';
    // 飛行時間（主役）
    if (key === 'total') return 'text-white font-semibold';
    return 'text-slate-300';
  };

  const currentMonthLabel = page ? (MONTHS.find(m => m.val === page.month)?.ja || page.month) : '';

  // Settings
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  useEffect(() => {
    if (activeTab === 'settings') {
      window.logbookAPI.getDbInfo().then(setDbInfo);
    }
  }, [activeTab]);

  // --- MFTR PDF インポート ---
  interface MftrImportState {
    filePath: string;
    parsed: MftrParseResult;
    bodyChecks: ValidationDiff[];
    footerChecks: ValidationDiff[];
    allOk: boolean;
  }
  const [mftrImport, setMftrImport] = useState<MftrImportState | null>(null);
  const [mftrLoading, setMftrLoading] = useState(false);
  const [mftrError, setMftrError] = useState<string | null>(null);

  const runMftrImport = async () => {
    setMftrError(null);
    setMftrLoading(true);
    try {
      const pick = await window.logbookAPI.pickMftrPdf();
      if (!pick.success) {
        if (pick.error && pick.error !== 'Cancelled') setMftrError(pick.error);
        return;
      }
      if (!pick.rawText || !pick.filePath) {
        setMftrError('PDFの読み込み結果が空です');
        return;
      }
      const parsed = parseMftrLayout(pick.rawText);
      const computed = computeTotalsFromFlights(parsed.flights);
      const totalTO = parsed.flights.reduce((s, f) => s + f.takeoffs, 0);
      const totalLD = parsed.flights.reduce((s, f) => s + f.landings, 0);
      const bodyChecks = validateAgainstBodyTotal(computed, totalTO, totalLD, parsed.bodyTotals);
      const footerChecks = validateAgainstFooter(computed, parsed.monthTotals);
      const allOk = parsed.warnings.length === 0
        && bodyChecks.every(c => c.ok)
        && footerChecks.every(c => c.ok)
        && parsed.flights.length > 0
        && parsed.bodyTotals !== null
        && parsed.monthTotals !== null;
      setMftrImport({
        filePath: pick.filePath,
        parsed,
        bodyChecks,
        footerChecks,
        allOk,
      });
    } catch (err: any) {
      setMftrError(`パース失敗: ${err.message}`);
    } finally {
      setMftrLoading(false);
    }
  };

  const closeMftrImport = () => {
    setMftrImport(null);
    setMftrError(null);
  };

  const [mftrCommitting, setMftrCommitting] = useState(false);

  const commitMftrImport = async () => {
    if (!mftrImport || !mftrImport.allOk) return;
    const { parsed } = mftrImport;
    const year = parsed.year;
    const month = parsed.month;

    // 重複チェック: 同じ年月のページが既に存在するか
    const existingCount = pages.filter(p => p.year === year && p.month === month).length;
    if (existingCount > 0) {
      const yes = window.confirm(
        `${year}年${month}月 のページは既に ${existingCount} ページあります。\n` +
        `追加で新しいサブページとしてコミットしますか?\n` +
        `(既存のページは変更されません)`,
      );
      if (!yes) return;
    }

    // Deadhead を除いた実飛行 + SIM を Row に変換
    const realRows: Row[] = parsed.flights
      .filter(f => !f.isDeadhead)
      .map(f => {
        const row = mftrFlightToRow(f, parsed.month);
        // aircraft 未設定ならユーザーデフォルト
        if (!row.aircraft && !f.isSim) row.aircraft = userAircraft;
        return row;
      });

    if (realRows.length === 0) {
      alert('取り込み対象のフライトがありません');
      return;
    }

    // ページ分割 (ROWS_PER_PAGE 行ずつ)
    const chunks: Row[][] = [];
    for (let i = 0; i < realRows.length; i += ROWS_PER_PAGE) {
      chunks.push(realRows.slice(i, i + ROWS_PER_PAGE));
    }

    setMftrCommitting(true);
    try {
      const api = window.logbookAPI;
      let firstNewPageId = -1;
      for (let ci = 0; ci < chunks.length; ci++) {
        const subIndex = existingCount + ci + 1;
        const pageId = Number(await api.createPage({ year, month, subIndex }));
        if (firstNewPageId < 0) firstNewPageId = pageId;
        const rows = chunks[ci];
        // パディング: ROWS_PER_PAGE に達するまで空行を追加しておく
        // (DB は row_index = 0..rows.length-1 のみ書く — 残りは emptyRow 状態)
        for (let ri = 0; ri < rows.length; ri++) {
          const dbFlight = rowToDbFlight(rows[ri], pageId, ri);
          await api.upsertFlight(dbFlight);
        }
      }

      // 状態を再ロード
      const { pages: freshPages, cumBase: freshBase } = await loadAllFromDb();
      setPages(freshPages);
      setCumBase(freshBase);

      // 新しいページに移動
      const idx = freshPages.findIndex(p => p.id === firstNewPageId);
      if (idx >= 0) {
        setCurrentPageIdx(idx);
        setActiveTab('page');
      }

      closeMftrImport();
      alert(
        `✓ ${year}年${month}月 を ${chunks.length} ページとして取り込みました\n` +
        `実フライト ${realRows.length} 件 (Deadhead ${parsed.flights.filter(f => f.isDeadhead).length} 件はスキップ)`,
      );
    } catch (err: any) {
      alert(`コミットに失敗しました: ${err.message}`);
    } finally {
      setMftrCommitting(false);
    }
  };

  // --- Cumulative Base 編集 ---
  type BaseDraft = Record<keyof Cumulative, string>;

  const makeDraftFrom = (c: Cumulative): BaseDraft => ({
    to:       String(c.to),
    ldg:      String(c.ldg),
    total:    fromMin(c.total)    || '0:00',
    picTotal: fromMin(c.picTotal) || '0:00',
    sicTotal: fromMin(c.sicTotal) || '0:00',
    pic:      fromMin(c.pic)      || '0:00',
    picXC:    fromMin(c.picXC)    || '0:00',
    picNT:    fromMin(c.picNT)    || '0:00',
    sic:      fromMin(c.sic)      || '0:00',
    coDual:   fromMin(c.coDual)   || '0:00',
    xc:       fromMin(c.xc)       || '0:00',
    night:    fromMin(c.night)    || '0:00',
    hood:     fromMin(c.hood)     || '0:00',
    sim:      fromMin(c.sim)      || '0:00',
    train:    fromMin(c.train)    || '0:00',
    imc:      fromMin(c.imc)      || '0:00',
    other:    fromMin(c.other)    || '0:00',
  });

  const [baseDraft, setBaseDraft] = useState<BaseDraft | null>(null);
  const [baseSaving, setBaseSaving] = useState(false);

  const openBaseEdit = () => setBaseDraft(makeDraftFrom(cumBase));
  const cancelBaseEdit = () => setBaseDraft(null);
  const updateBaseDraft = (key: keyof BaseDraft, value: string) => {
    setBaseDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveBaseEdit = async () => {
    if (!baseDraft) return;
    setBaseSaving(true);
    try {
      const parsed: Cumulative = {
        to:       parseInt(baseDraft.to)  || 0,
        ldg:      parseInt(baseDraft.ldg) || 0,
        total:    toMin(baseDraft.total),
        picTotal: toMin(baseDraft.picTotal),
        sicTotal: toMin(baseDraft.sicTotal),
        pic:      toMin(baseDraft.pic),
        picXC:    toMin(baseDraft.picXC),
        picNT:    toMin(baseDraft.picNT),
        sic:      toMin(baseDraft.sic),
        coDual:   toMin(baseDraft.coDual),
        xc:       toMin(baseDraft.xc),
        night:    toMin(baseDraft.night),
        hood:     toMin(baseDraft.hood),
        sim:      toMin(baseDraft.sim),
        train:    toMin(baseDraft.train),
        imc:      toMin(baseDraft.imc),
        other:    toMin(baseDraft.other),
      };
      await window.logbookAPI.setCumulativeBase(cumulativeToDbCumBase(parsed));
      setCumBase(parsed);
      setBaseDraft(null);
    } catch (err) {
      console.error('setCumulativeBase failed', err);
      alert('累計ベースの保存に失敗しました: ' + (err as Error).message);
    } finally {
      setBaseSaving(false);
    }
  };

  // ========================================
  // Render
  // ========================================

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-sm text-slate-500 mono tracking-[0.3em]">LOADING…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <style>{`
        .cell-input { background: transparent; border: none; width: 100%; padding: 6px 8px; color: inherit; font: inherit; outline: none; }
        .cell-input:focus { background: rgba(251, 191, 36, 0.08); box-shadow: inset 0 0 0 1.5px rgb(251 191 36 / 0.6); }
        .cell-input::placeholder { color: rgb(51 65 85 / 0.8); }
        select { background-color: rgb(15 23 42); color: rgb(226 232 240); }
      `}</style>

      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
              <Plane size={18} className="text-amber-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wider">PILOT LOGBOOK</div>
              <div className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">PRO · v0.3</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Default aircraft (型式) */}
            <label
              className="flex items-center gap-2 border border-slate-700 bg-slate-900 px-3 py-1.5"
              title="新規入力時に型式列へ自動挿入される機種"
            >
              <span className="text-[10px] text-slate-500 uppercase tracking-[0.18em] mono">
                型式
              </span>
              <select
                value={userAircraft}
                onChange={e => {
                  const v = e.target.value;
                  if (isAircraftOption(v)) setUserAircraft(v);
                }}
                className="bg-transparent text-[11px] mono text-amber-300 text-center focus:outline-none uppercase tracking-wider cursor-pointer appearance-none pr-1"
              >
                {AIRCRAFT_OPTIONS.map(opt => (
                  <option key={opt} value={opt} className="bg-slate-900 text-amber-300">
                    {opt}
                  </option>
                ))}
              </select>
            </label>

            {/* CAPT / FO mode toggle */}
            <div
              className="flex border border-slate-700 bg-slate-900 overflow-hidden"
              role="group"
              aria-label="Pilot role mode"
            >
              <button
                onClick={() => setUserMode('captain')}
                title="Captain モード"
                className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold mono transition-colors ${
                  userMode === 'captain'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-amber-300'
                }`}
              >
                CAPT
              </button>
              <button
                onClick={() => setUserMode('fo')}
                title="First Officer モード（飛行時間を PUS / CO に自動転記）"
                className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold mono transition-colors border-l border-slate-700 ${
                  userMode === 'fo'
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                FO
              </button>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                {userMode === 'captain' ? 'Captain' : 'First Officer'}
              </div>
              <div className="text-sm font-medium">{displayName} / JAL</div>
            </div>
            <div
              className={`w-10 h-10 border flex items-center justify-center font-semibold transition-colors ${
                userMode === 'captain'
                  ? 'bg-gradient-to-br from-amber-400/20 to-amber-600/10 border-amber-400/30 text-amber-400'
                  : 'bg-gradient-to-br from-cyan-400/20 to-cyan-600/10 border-cyan-400/30 text-cyan-400'
              }`}
            >
              {avatarChar}
            </div>
          </div>
        </div>
        <div className="max-w-[1600px] mx-auto px-6 flex gap-2">
          <TabButton id="page" icon={Plane} label="LOG PAGE" />
          <TabButton id="dashboard" icon={BarChart3} label="DASHBOARD" />
          <TabButton id="analysis" icon={TrendingUp} label="ANALYSIS" />
          <TabButton id="goals" icon={Target} label="GOALS" />
          <TabButton id="settings" icon={Settings} label="SETTINGS" />
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {activeTab === 'page' && page && (
          <div className="space-y-4">
            {/* Page navigator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button onClick={() => setCurrentPageIdx(0)} disabled={currentPageIdx === 0}
                  title="最初のページ"
                  className="p-2 text-slate-400 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronsLeft size={18} />
                </button>
                <button onClick={() => setCurrentPageIdx(Math.max(0, currentPageIdx - 1))} disabled={currentPageIdx === 0}
                  title="前のページ"
                  className="p-2 text-slate-400 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={18} />
                </button>

                {/* Month dropdown (year-grouped) */}
                <div className="relative">
                  <select
                    value={currentMonthKey}
                    onChange={(e) => {
                      const entry = monthsIndex.find(m => m.key === e.target.value);
                      if (entry) setCurrentPageIdx(entry.subPages[0].idx);
                    }}
                    className="appearance-none bg-slate-900 border border-slate-800 hover:border-amber-400/50 focus:border-amber-400 focus:outline-none text-lg font-semibold text-amber-400 tracking-wider mono px-4 py-2 pr-9 min-w-[220px] text-center cursor-pointer transition-colors"
                  >
                    {(() => {
                      const byYear = new Map<number, typeof monthsIndex>();
                      monthsIndex.forEach(m => {
                        if (!byYear.has(m.year)) byYear.set(m.year, []);
                        byYear.get(m.year)!.push(m);
                      });
                      const years = [...byYear.keys()].sort((a, b) => a - b);
                      return years.map(y => (
                        <optgroup key={y} label={`${y}年`}>
                          {byYear.get(y)!.map(m => {
                            const monthLabel = MONTHS.find(x => x.val === m.month)?.ja ?? m.month;
                            const subCount = m.subPages.length;
                            return (
                              <option key={m.key} value={m.key} className="bg-slate-900 text-amber-300">
                                {m.year}年{monthLabel}　{fromMin(m.totalMin) || '—'}{subCount > 1 ? ` (${subCount})` : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  <ChevronRight size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-amber-400/60 pointer-events-none" />
                </div>

                {/* Sub-page pills (when the month has multiple pages) */}
                {currentMonthEntry && currentMonthEntry.subPages.length > 1 && (
                  <div className="flex items-center gap-1 ml-1">
                    {currentMonthEntry.subPages.map((sp, i) => {
                      const active = sp.idx === currentPageIdx;
                      return (
                        <button
                          key={sp.page.id}
                          onClick={() => setCurrentPageIdx(sp.idx)}
                          title={`${pageName(sp.page)}`}
                          className={`w-8 h-8 text-xs mono font-semibold border transition-colors ${
                            active
                              ? 'border-amber-400 text-amber-400 bg-amber-400/10'
                              : 'border-slate-700 text-slate-400 hover:border-amber-400/50 hover:text-amber-300'
                          }`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button onClick={() => setCurrentPageIdx(Math.min(pages.length - 1, currentPageIdx + 1))} disabled={currentPageIdx === pages.length - 1}
                  title="次のページ"
                  className="p-2 text-slate-400 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed ml-1">
                  <ChevronRight size={18} />
                </button>
                <button onClick={() => setCurrentPageIdx(pages.length - 1)} disabled={currentPageIdx === pages.length - 1}
                  title="最後のページ"
                  className="p-2 text-slate-400 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronsRight size={18} />
                </button>
                <span className="text-xs text-slate-500 ml-2 mono tabular-nums">{currentPageIdx + 1} / {pages.length}</span>
              </div>

              <div className="flex gap-2">
                <button onClick={exportCSV} className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-amber-400/50 hover:text-amber-400 transition-colors">
                  <Download size={14} /> CSV
                </button>
                <button onClick={deletePage}
                  title="このページを削除"
                  className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:border-rose-400/60 hover:text-rose-400 transition-colors">
                  <Trash2 size={14} /> DELETE PAGE
                </button>
                {monthTotal.pageCount > 0 && (
                  <button onClick={deleteCurrentMonth}
                    title="この月の全ページを削除"
                    className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:border-rose-400/60 hover:text-rose-400 transition-colors">
                    <Trash2 size={14} /> DELETE MONTH
                  </button>
                )}
                <button onClick={openNewPageDialog}
                  className="flex items-center gap-2 bg-amber-400 text-slate-950 px-4 py-2 text-sm font-medium hover:bg-amber-300">
                  <Plus size={14} /> NEW PAGE
                </button>
              </div>
            </div>

            {/* Month Total */}
            <div className="bg-gradient-to-r from-amber-400/10 via-amber-400/5 to-transparent border border-amber-400/30 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-amber-400" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-amber-400 font-semibold">Month Total</span>
                  <span className="text-sm text-slate-300 mono">{page.year}年 {currentMonthLabel}</span>
                  {monthTotal.pageCount > 1 && (
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full mono">
                      {monthTotal.pageCount} pages merged
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase tracking-[0.15em]">Flight Time</div>
                  <div className="text-2xl font-light text-amber-300 mono">{fromMin(monthTotal.sum.total) || '0:00'}</div>
                </div>
              </div>
              <div className="grid grid-cols-6 md:grid-cols-12 gap-3 text-xs">
                <Stat label="離陸" value={String(monthTotal.sum.to)} isNum />
                <Stat label="着陸" value={String(monthTotal.sum.ldg)} isNum />
                <Stat label="PIC" value={fromMin(monthTotal.sum.picTotal)} color="text-amber-300" />
                <Stat label="SIC" value={fromMin(monthTotal.sum.sicTotal)} color="text-cyan-300" />
                <Stat label="PUS" value={fromMin(monthTotal.sum.pic)} color="text-amber-400" />
                <Stat label="PUS X/C" value={fromMin(monthTotal.sum.picXC)} color="text-amber-400" />
                <Stat label="NGT" value={fromMin(monthTotal.sum.picNT)} color="text-amber-400" />
                <Stat label="CO" value={fromMin(monthTotal.sum.sic)} color="text-cyan-400" />
                <Stat label="同乗" value={fromMin(monthTotal.sum.coDual)} color="text-cyan-400" />
                <Stat label="CO X/C" value={fromMin(monthTotal.sum.xc)} color="text-cyan-400" />
                <Stat label="NGT" value={fromMin(monthTotal.sum.night)} color="text-violet-400" />
                <Stat label="HOOD" value={fromMin(monthTotal.sum.hood)} color="text-rose-300" />
                <Stat label="INST" value={fromMin(monthTotal.sum.imc)} color="text-rose-400" />
                <Stat label="SIM" value={fromMin(monthTotal.sum.sim)} color="text-slate-300" />
                <Stat label="OTHER" value={fromMin(monthTotal.sum.other)} />
              </div>
            </div>

            {/* Spreadsheet */}
            <div className="border border-slate-800 bg-slate-900/30 overflow-x-auto">
              <div style={{ minWidth: `${totalWidth}px` }}>
                <div className="flex border-b-2 border-slate-700 bg-slate-900/80 sticky top-0">
                  <div style={{ width: 40 }} className="px-2 py-3 text-[10px] text-slate-600 text-center uppercase tracking-[0.1em] border-r border-slate-800">#</div>
                  {COLUMNS.map((c, idx) => (
                    <div
                      key={c.key}
                      style={{ width: c.width, textAlign: c.align }}
                      className={`px-2 py-3 text-[10px] font-medium uppercase tracking-[0.1em] border-r border-slate-800 last:border-r-0 ${
                        isGroupStart(idx) ? GROUP_DIVIDER : ''
                      } ${groupTintHeader(c.group)} ${groupTextHeader(c.group)}`}
                    >
                      {c.label}
                    </div>
                  ))}
                </div>

                {page.rows.map((row, rowIdx) => {
                  // SIM 訓練行は T/O・L/D を括弧書き表示（合計にも加算しない）
                  const simRow = isSimTrainingRow(row);
                  return (
                  <div key={rowIdx} className="flex border-b border-slate-800/70 hover:bg-slate-900/40 group">
                    <div style={{ width: 40 }} className="px-2 text-[11px] text-slate-600 text-center border-r border-slate-800/70 group-hover:text-slate-400 mono flex items-center justify-center">
                      {rowIdx + 1}
                    </div>
                    {COLUMNS.map((c, colIdx) => {
                      const wrapInParens = simRow && (c.key === 'to' || c.key === 'ldg');
                      const inputEl = (
                        <input
                          data-cell={`${rowIdx}-${colIdx}`}
                          type="text"
                          value={row[c.key] || ''}
                          onChange={e => updateCell(rowIdx, c.key, e.target.value)}
                          onBlur={e => {
                            normalizeTimeOnBlur(rowIdx, c.key, e.target.value);
                            if (c.key === 'date') normalizeDateOnBlur(rowIdx, e.target.value);
                          }}
                          onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                          className={`cell-input mono text-sm ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'} ${colorFor(c.key)}`}
                          placeholder={c.type === 'time' ? '0:00' : ''}
                        />
                      );
                      return (
                        <div
                          key={c.key}
                          style={{ width: c.width }}
                          className={`border-r border-slate-800/70 last:border-r-0 ${
                            isGroupStart(colIdx) ? GROUP_DIVIDER : ''
                          } ${groupTintCell(c.group)}`}
                        >
                          {wrapInParens ? (
                            <div className="flex items-center justify-center">
                              <span className="text-slate-500/70 text-xs mono select-none">(</span>
                              {inputEl}
                              <span className="text-slate-500/70 text-xs mono select-none">)</span>
                            </div>
                          ) : inputEl}
                        </div>
                      );
                    })}
                  </div>
                  );
                })}

                {/* 項合計 */}
                <TotalsRow columns={COLUMNS} cum={pageSum} mode="sum"  label="項合計" colorFor={colorFor} />
                {/* 前項まで */}
                <TotalsRow columns={COLUMNS} cum={pagePrev} mode="prev" label="前項まで" colorFor={colorFor} />
                {/* 合計 */}
                <TotalsRow columns={COLUMNS} cum={cumulative} mode="cum" label="合計" colorFor={colorFor} />
              </div>
            </div>

            <div className="text-[11px] text-slate-500 flex flex-wrap gap-4 gap-y-2 mt-3 px-1">
              <span>⌨ <span className="text-slate-400">↑↓←→/Enter</span> でセル移動</span>
              <span>⏱ 時間入力は <span className="text-slate-400 mono">1:43</span> / <span className="text-slate-400 mono">143</span>（Tabで自動整形） / <span className="text-slate-400 mono">1.5</span></span>
              <span>📋 15行で1ページ・超えたら NEW PAGE</span>
              <span>📅 同月の複数ページは自動で合算</span>
              <span>💾 入力は {DEBOUNCE_MS}ms 後に自動保存</span>
              {userMode === 'fo' && (
                <span>
                  ✈ <span className="text-cyan-300">FO mode</span>: <span className="mono">1/1</span> → <span className="text-amber-300">PUS / PUS(X/C)</span>、それ以外 → <span className="text-cyan-300">CO / CO(X/C)</span> 自動転記
                </span>
              )}
              {userMode === 'captain' && (
                <span>
                  ✈ <span className="text-amber-300">CAPT mode</span>: <span className="mono">1/1</span> → <span className="text-amber-300">PIC</span>、それ以外 → <span className="text-amber-300">PIC / PUS(X/C)</span> 自動転記
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'page' && !page && (
          <div className="text-slate-400 text-sm space-y-2">
            <div>ページがありません。</div>
            <div className="text-slate-500 text-xs">
              ・上部の <span className="text-slate-300">NEW PAGE</span> から手動で作成<br />
              ・SETTINGS タブの <span className="text-slate-300">Import from MFTR PDF</span> から取り込み<br />
              ・累計値（Cumulative Base）は SETTINGS タブで初期値を設定できます
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="flex items-end justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-[0.2em] mb-1">Total Flight Time</div>
                <div className="text-5xl font-extralight mono">
                  <span className="text-amber-400">{Math.floor(cumulative.total / 60).toLocaleString()}</span>
                  <span className="text-slate-600 text-3xl">:{(cumulative.total % 60).toString().padStart(2, '0')}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 tracking-wider">HOURS · CAREER TOTAL</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500 uppercase tracking-[0.2em] mb-1">This Month</div>
                <div className="text-2xl font-light text-amber-300 mono">{fromMin(monthTotal.sum.total) || '0:00'}</div>
                {page && <div className="text-xs text-slate-500 mt-0.5">{page.year}年 {currentMonthLabel}</div>}
              </div>
            </div>

            <section>
              <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-4">Time Composition · Career</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-800">
                <Metric label="PIC" value={fmtCum(cumulative.picTotal)} accent="amber" icon={Award} />
                <Metric label="SIC" value={fmtCum(cumulative.sicTotal)} accent="cyan" />
                <Metric label="PUS" value={fmtCum(cumulative.pic)} accent="amber" />
                <Metric label="PUS X/C" value={fmtCum(cumulative.picXC)} accent="amber" />
                <Metric label="CO" value={fmtCum(cumulative.sic)} accent="cyan" />
                <Metric label="CO X/C" value={fmtCum(cumulative.xc)} accent="cyan" />
                <Metric label="NGT" value={fmtCum(cumulative.night)} accent="violet" icon={Moon} />
                <Metric label="INST" value={fmtCum(cumulative.imc)} accent="rose" icon={CloudFog} />
              </div>
            </section>

            <section className="grid md:grid-cols-2 gap-6">
              <div className="bg-slate-900/40 border border-slate-800 p-6">
                <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">Breakdown · % of Total</h3>
                {[
                  { l: 'PIC',  v: cumulative.picTotal, c: 'bg-amber-300' },
                  { l: 'SIC',  v: cumulative.sicTotal, c: 'bg-cyan-300' },
                  { l: 'PUS',  v: cumulative.pic,      c: 'bg-amber-400' },
                  { l: 'CO',   v: cumulative.sic,      c: 'bg-cyan-400' },
                  { l: 'NGT',  v: cumulative.night,    c: 'bg-violet-400' },
                  { l: 'INST', v: cumulative.imc,      c: 'bg-rose-400' },
                ].map(b => {
                  const pct = cumulative.total > 0 ? (b.v / cumulative.total) * 100 : 0;
                  return (
                    <div key={b.l} className="py-2">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-400">{b.l}</span>
                        <span className="text-slate-200 mono">{fmtCum(b.v)} <span className="text-slate-500 ml-2">{pct.toFixed(1)}%</span></span>
                      </div>
                      <div className="h-1 bg-slate-800 relative overflow-hidden">
                        <div className={`h-full ${b.c} transition-all duration-700`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-slate-900/40 border border-slate-800 p-6">
                <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">Takeoffs & Landings</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-950/60 border border-slate-800 p-5 text-center">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">Takeoffs</div>
                    <div className="text-4xl font-light text-amber-400 mono">{cumulative.to.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 p-5 text-center">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">Landings</div>
                    <div className="text-4xl font-light text-amber-400 mono">{cumulative.ldg.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-6 pt-6 border-t border-slate-800 text-center">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">Avg Leg Length</div>
                  <div className="text-2xl font-light text-slate-200 mono">
                    {cumulative.ldg > 0 ? fromMin(Math.round(cumulative.total / cumulative.ldg)) : '—'}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-light tracking-wide">Analysis</h1>
            <div className="bg-slate-900/40 border border-slate-800 p-12 text-center">
              <BarChart3 className="mx-auto text-slate-700 mb-4" size={48} strokeWidth={1} />
              <div className="text-slate-400 mb-2">Monthly / Yearly trends</div>
              <div className="text-xs text-slate-500">複数ページ蓄積後にグラフを実装</div>
            </div>
          </div>
        )}

        {activeTab === 'goals' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-light tracking-wide">Career Goals</h1>
            <div className="bg-slate-900/40 border border-slate-800 p-6">
              <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">ATPL (定期運送用操縦士) Requirements</h3>
              <div className="space-y-4">
                {[
                  { label: '総飛行時間', req: 1500, cur: Math.floor(cumulative.total / 60) },
                  { label: 'PIC 時間',   req: 250,  cur: Math.floor(cumulative.picTotal / 60) },
                  { label: 'PUS',        req: 250,  cur: Math.floor(cumulative.pic / 60)      },
                  { label: 'X/C',        req: 200,  cur: Math.floor((cumulative.picXC + cumulative.xc) / 60) },
                  { label: 'NGT',        req: 100,  cur: Math.floor((cumulative.picNT + cumulative.night) / 60) },
                  { label: 'INST',       req: 75,   cur: Math.floor(cumulative.imc / 60)      },
                ].map(g => {
                  const pct = Math.min(100, (g.cur / g.req) * 100);
                  const done = g.cur >= g.req;
                  return (
                    <div key={g.label}>
                      <div className="flex justify-between items-baseline mb-1.5">
                        <span className="text-sm text-slate-200">{g.label}</span>
                        <span className="mono text-xs text-slate-400">
                          <span className={done ? 'text-emerald-400' : 'text-amber-400'}>{g.cur.toLocaleString()}</span>
                          <span className="text-slate-600"> / {g.req.toLocaleString()}h</span>
                          {done && <span className="ml-2 text-emerald-400">✓</span>}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 relative">
                        <div className={`h-full transition-all duration-700 ${done ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-3xl">
            <h1 className="text-2xl font-light tracking-wide">Settings</h1>

            <div className="bg-slate-900/40 border border-slate-800 p-6">
              <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">Profile</h3>
              <label className="block text-xs text-slate-400 mb-2">Pilot Name</label>
              <input
                type="text"
                value={userName}
                onChange={e => setUserName(e.target.value)}
                placeholder="例: Kentaro"
                maxLength={40}
                className="w-full bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm text-slate-100 mono focus:outline-none focus:border-amber-400/60"
              />
              <div className="text-[11px] text-slate-500 mt-2">
                ヘッダー右上に <span className="text-slate-300">{displayName} / JAL</span> として表示されます
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 p-6">
              <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">Data Management</h3>

              {dbInfo && (
                <div className="bg-slate-950/60 border border-slate-800 p-4 mb-5 text-xs mono">
                  <div className="grid grid-cols-[120px_1fr] gap-y-2">
                    <div className="text-slate-500">Database:</div>
                    <div className="text-slate-300 break-all">{dbInfo.path}</div>
                    <div className="text-slate-500">Size:</div>
                    <div className="text-slate-300">{dbInfo.sizeKB.toLocaleString()} KB</div>
                    <div className="text-slate-500">Last modified:</div>
                    <div className="text-slate-300">{new Date(dbInfo.modifiedAt).toLocaleString('ja-JP')}</div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={async () => {
                    const r = await window.logbookAPI.exportDatabase();
                    if (r.success) alert(`✓ Exported:\n${r.path}`);
                    else if (r.error !== 'Cancelled') alert(`Export failed: ${r.error}`);
                  }}
                  className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-3 text-sm text-left transition-colors"
                >
                  <Download size={16} className="text-amber-400" />
                  <div>
                    <div className="font-medium">Export Database</div>
                    <div className="text-xs text-slate-400">現在のデータベースを .db ファイルとして書き出す</div>
                  </div>
                </button>

                <button
                  onClick={async () => {
                    const r = await window.logbookAPI.importDatabase();
                    if (r.success) return;
                    if (r.error !== 'Cancelled' && r.error !== 'Cancelled by user') {
                      alert(`Import failed: ${r.error}`);
                    }
                  }}
                  className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-3 text-sm text-left transition-colors"
                >
                  <Upload size={16} className="text-cyan-400" />
                  <div>
                    <div className="font-medium">Import Database</div>
                    <div className="text-xs text-slate-400">
                      <span className="text-rose-400">⚠ 現在のデータが上書きされます</span>
                      （インポート前に自動バックアップ作成）
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => window.logbookAPI.revealDbInFinder()}
                  className="w-full flex items-center gap-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 px-4 py-3 text-sm text-left transition-colors"
                >
                  <FolderOpen size={16} className="text-slate-400" />
                  <div>
                    <div className="font-medium">Reveal in Finder</div>
                    <div className="text-xs text-slate-400">データベースファイルのある場所をFinderで開く</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 p-6">
              <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-5">MFTR Import</h3>
              <div className="text-xs text-slate-400 mb-4 leading-relaxed">
                JAL の Monthly Flight Time Record (MFTR) PDF を取り込み、月ごとのページを自動生成します。<br />
                取り込み前に PDF の body TOTAL 行 / footer THIS MONTH 行と自前集計を突き合わせ、誤差があればコミットしません。
              </div>
              <button
                onClick={runMftrImport}
                disabled={mftrLoading}
                className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-3 text-sm text-left transition-colors disabled:opacity-50"
              >
                <FileText size={16} className="text-emerald-400" />
                <div>
                  <div className="font-medium">{mftrLoading ? '読み込み中…' : 'Import from MFTR PDF'}</div>
                  <div className="text-xs text-slate-400">PDF を選択してプレビューを表示</div>
                </div>
              </button>
              {mftrError && (
                <div className="mt-3 bg-rose-400/10 border border-rose-400/30 px-3 py-2 text-xs text-rose-300">
                  ⚠ {mftrError}
                </div>
              )}
            </div>

            <div className="bg-slate-900/40 border border-slate-800 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs uppercase tracking-[0.2em] text-slate-500">Cumulative Base</h3>
                {!baseDraft ? (
                  <button
                    onClick={openBaseEdit}
                    className="flex items-center gap-2 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-amber-400/50 hover:text-amber-400 transition-colors"
                  >
                    <Pencil size={12} /> EDIT
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={cancelBaseEdit}
                      disabled={baseSaving}
                      className="flex items-center gap-1.5 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-rose-400/50 hover:text-rose-400 transition-colors disabled:opacity-40"
                    >
                      <X size={12} /> CANCEL
                    </button>
                    <button
                      onClick={saveBaseEdit}
                      disabled={baseSaving}
                      className="flex items-center gap-1.5 bg-amber-400 text-slate-950 px-3 py-1.5 text-xs font-medium hover:bg-amber-300 disabled:opacity-40"
                    >
                      <Check size={12} /> {baseSaving ? 'SAVING…' : 'SAVE'}
                    </button>
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-400 mb-4">
                最初のページの「前項まで」に積まれる値です。アプリ導入時の過去累計を入力してください（編集後は全ページの累計が即座に変わります）。
              </div>

              {baseDraft && (
                <div className="bg-rose-400/5 border border-rose-400/30 px-3 py-2 text-[11px] text-rose-300 mb-4">
                  ⚠ 編集すると全ページの「前項まで / 合計」が即座に変わります。時間は <span className="mono">h:mm</span> 形式（<span className="mono">7532:45</span> のように時間が3〜4桁でも可）。
                </div>
              )}

              {!baseDraft ? (
                <div className="bg-slate-950/60 border border-slate-800 p-4 text-xs mono">
                  <div className="grid grid-cols-[140px_1fr] gap-y-2">
                    <div className="text-slate-500">離陸 / 着陸:</div>
                    <div className="text-slate-300">{cumBase.to.toLocaleString()} / {cumBase.ldg.toLocaleString()}</div>
                    <div className="text-slate-500">飛行時間:</div>
                    <div className="text-slate-100">{fmtCum(cumBase.total)}</div>
                    <div className="text-slate-500">PIC:</div>
                    <div className="text-amber-300">{fmtCum(cumBase.picTotal)}</div>
                    <div className="text-slate-500">SIC:</div>
                    <div className="text-cyan-300">{fmtCum(cumBase.sicTotal)}</div>
                    <div className="text-slate-500">PUS:</div>
                    <div className="text-amber-400">{fmtCum(cumBase.pic)}</div>
                    <div className="text-slate-500">PUS(X/C):</div>
                    <div className="text-amber-400">{fmtCum(cumBase.picXC)}</div>
                    <div className="text-slate-500">NGT (PIC):</div>
                    <div className="text-amber-400">{fmtCum(cumBase.picNT)}</div>
                    <div className="text-slate-500">CO:</div>
                    <div className="text-cyan-400">{fmtCum(cumBase.sic)}</div>
                    <div className="text-slate-500">同乗:</div>
                    <div className="text-cyan-400">{fmtCum(cumBase.coDual)}</div>
                    <div className="text-slate-500">CO(X/C):</div>
                    <div className="text-cyan-400">{fmtCum(cumBase.xc)}</div>
                    <div className="text-slate-500">NGT (CO):</div>
                    <div className="text-violet-400">{fmtCum(cumBase.night)}</div>
                    <div className="text-slate-500">HOOD:</div>
                    <div className="text-rose-300">{fmtCum(cumBase.hood)}</div>
                    <div className="text-slate-500">INST:</div>
                    <div className="text-rose-400">{fmtCum(cumBase.imc)}</div>
                    <div className="text-slate-500">SIM:</div>
                    <div className="text-slate-300">{fmtCum(cumBase.sim)}</div>
                    <div className="text-slate-500">OTHER:</div>
                    <div className="text-slate-300">{fmtCum(cumBase.other)}</div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800 p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  <BaseField label="離陸"     value={baseDraft.to}       onChange={v => updateBaseDraft('to', v)}       placeholder="0" />
                  <BaseField label="着陸"     value={baseDraft.ldg}      onChange={v => updateBaseDraft('ldg', v)}      placeholder="0" />
                  <BaseField label="飛行時間" value={baseDraft.total}    onChange={v => updateBaseDraft('total', v)}    placeholder="0:00" />
                  <BaseField label="PIC"      value={baseDraft.picTotal} onChange={v => updateBaseDraft('picTotal', v)} placeholder="0:00" accent="text-amber-300" />
                  <BaseField label="SIC"      value={baseDraft.sicTotal} onChange={v => updateBaseDraft('sicTotal', v)} placeholder="0:00" accent="text-cyan-300" />
                  <BaseField label="PUS"      value={baseDraft.pic}      onChange={v => updateBaseDraft('pic', v)}      placeholder="0:00" accent="text-amber-400" />
                  <BaseField label="PUS(X/C)" value={baseDraft.picXC}    onChange={v => updateBaseDraft('picXC', v)}    placeholder="0:00" accent="text-amber-400" />
                  <BaseField label="NGT(PIC)" value={baseDraft.picNT}    onChange={v => updateBaseDraft('picNT', v)}    placeholder="0:00" accent="text-amber-400" />
                  <BaseField label="CO"       value={baseDraft.sic}      onChange={v => updateBaseDraft('sic', v)}      placeholder="0:00" accent="text-cyan-400" />
                  <BaseField label="同乗"     value={baseDraft.coDual}   onChange={v => updateBaseDraft('coDual', v)}   placeholder="0:00" accent="text-cyan-400" />
                  <BaseField label="CO(X/C)"  value={baseDraft.xc}       onChange={v => updateBaseDraft('xc', v)}       placeholder="0:00" accent="text-cyan-400" />
                  <BaseField label="NGT(CO)"  value={baseDraft.night}    onChange={v => updateBaseDraft('night', v)}    placeholder="0:00" accent="text-violet-400" />
                  <BaseField label="HOOD"     value={baseDraft.hood}     onChange={v => updateBaseDraft('hood', v)}     placeholder="0:00" accent="text-rose-300" />
                  <BaseField label="INST"     value={baseDraft.imc}      onChange={v => updateBaseDraft('imc', v)}      placeholder="0:00" accent="text-rose-400" />
                  <BaseField label="SIM"      value={baseDraft.sim}      onChange={v => updateBaseDraft('sim', v)}      placeholder="0:00" accent="text-slate-300" />
                  <BaseField label="OTHER"    value={baseDraft.other}    onChange={v => updateBaseDraft('other', v)}    placeholder="0:00" />
                </div>
              )}
            </div>

            <div className="bg-amber-400/5 border border-amber-400/20 p-5">
              <div className="flex gap-3">
                <div className="text-amber-400 text-xl">💡</div>
                <div className="text-sm text-amber-200/80 space-y-2">
                  <p className="font-medium text-amber-300">バックアップの推奨</p>
                  <p className="text-xs leading-relaxed">
                    月末・四半期末などのタイミングで <span className="text-amber-400">Export Database</span> を実行し、
                    iCloud Drive や外部ストレージに .db ファイルを保存することを推奨します。
                  </p>
                  <p className="text-xs leading-relaxed">
                    Mac買い替え時は、古いMacで Export → 新しいMacにアプリをインストール → Import で完全移行できます。
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-rose-400/5 border border-rose-400/30 p-6">
              <h3 className="text-xs uppercase tracking-[0.2em] text-rose-300 mb-3 flex items-center gap-2">
                <AlertTriangle size={14} /> Danger Zone
              </h3>
              <div className="text-xs text-slate-400 mb-4 leading-relaxed">
                全ページ・全フライト・累計値 (Cumulative Base) をすべて削除し、空の状態にリセットします。
                テスト用途・配布前の初期化を想定しています。事前に <span className="text-amber-400">Export Database</span> でバックアップを取ってください。
              </div>
              <button
                onClick={clearAllData}
                disabled={pages.length === 0}
                className="flex items-center gap-2 border border-rose-400/40 px-4 py-2.5 text-xs text-rose-300 hover:bg-rose-400/10 hover:border-rose-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} /> CLEAR ALL DATA
              </button>
              {pages.length === 0 && (
                <div className="text-[10px] text-slate-500 mt-2">データはすでに空です</div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 新規ページダイアログ */}
      {showNewPageDialog && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h2 className="text-sm uppercase tracking-[0.2em] font-medium">New Page</h2>
              <button onClick={() => setShowNewPageDialog(false)} className="text-slate-500 hover:text-slate-200 text-xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                年月を選択してください。同じ月のページが既にある場合は自動的に <span className="text-amber-400 mono">-2</span>, <span className="text-amber-400 mono">-3</span>... が付きます。
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-medium block mb-2">Year</label>
                  <select value={newPageYear} onChange={e => setNewPageYear(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-amber-400/50 focus:outline-none mono">
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-medium block mb-2">Month</label>
                  <select value={newPageMonth} onChange={e => setNewPageMonth(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-amber-400/50 focus:outline-none mono">
                    {MONTHS.map(m => <option key={m.val} value={m.val}>{m.label} · {m.ja}</option>)}
                  </select>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 p-4 mt-2">
                <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-2">Preview</div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold text-amber-400 mono tracking-wider">
                    {(() => {
                      const m = MONTHS.find(x => x.val === newPageMonth);
                      const base = `${newPageYear}${m ? m.label : newPageMonth}`;
                      const sub = pages.filter(p => p.year === newPageYear && p.month === newPageMonth).length + 1;
                      return sub > 1 ? `${base}-${sub}` : base;
                    })()}
                  </span>
                  {(() => {
                    const existing = pages.filter(p => p.year === newPageYear && p.month === newPageMonth).length;
                    if (existing > 0) return (
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-1 rounded-full">
                        {existing} page{existing > 1 ? 's' : ''} already exist
                      </span>
                    );
                    return null;
                  })()}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex justify-end gap-3">
              <button onClick={() => setShowNewPageDialog(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
                CANCEL
              </button>
              <button onClick={createNewPage} className="bg-amber-400 text-slate-950 px-5 py-2 text-sm font-medium hover:bg-amber-300">
                CREATE PAGE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MFTR インポート プレビュー モーダル */}
      {mftrImport && (
        <MftrPreviewModal
          state={mftrImport}
          committing={mftrCommitting}
          onClose={closeMftrImport}
          onCommit={commitMftrImport}
        />
      )}

      <footer className="mt-16 border-t border-slate-800 py-6">
        <div className="max-w-[1600px] mx-auto px-6 flex justify-between items-center text-[10px] text-slate-600 uppercase tracking-[0.2em]">
          <span>Prototype · v0.3 · SQLite wired</span>
          <span>{pages.length} page{pages.length === 1 ? '' : 's'} · DB persisted</span>
        </div>
      </footer>
    </div>
  );
}

// ========================================
// Sub-components
// ========================================

function TotalCell({
  value, w, color = 'text-slate-100', dim = false, strong = false, compact = false, extraClass = '',
}: {
  value: string | number;
  w: number;
  color?: string;
  dim?: boolean;
  strong?: boolean;
  compact?: boolean;
  extraClass?: string;
}) {
  // 累計値はカンマ区切りで桁が伸びるため text-xs + 狭パディング + nowrap で固定幅に収める
  const sizeCls = compact || dim ? 'text-xs px-1.5' : 'text-sm px-2';
  return (
    <div
      style={{ width: w, textAlign: 'center' }}
      className={`py-2.5 mono whitespace-nowrap tabular-nums overflow-hidden border-r border-slate-800/70 last:border-r-0 ${sizeCls} ${color} ${dim ? 'opacity-60' : ''} ${strong ? 'font-semibold' : ''} ${extraClass}`}
      title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
    >
      {value || '—'}
    </div>
  );
}

function TotalsRow({
  columns, cum, mode, label, colorFor,
}: {
  columns: ColumnDef[];
  cum: Cumulative;
  mode: 'sum' | 'prev' | 'cum';
  label: string;
  colorFor: (key: RowKey) => string;
}) {
  const rowCls =
    mode === 'sum'
      ? 'flex border-t-2 border-slate-700 bg-slate-900/60'
      : mode === 'prev'
      ? 'flex border-b border-slate-800 bg-slate-950/40'
      : 'flex bg-amber-400/5 border-t border-amber-400/20';

  const labelCls =
    mode === 'sum'
      ? 'px-3 py-2.5 text-[10px] uppercase tracking-[0.15em] text-slate-400 font-medium border-r border-slate-800'
      : mode === 'prev'
      ? 'px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-slate-500 border-r border-slate-800'
      : 'px-3 py-3 text-[11px] uppercase tracking-[0.2em] text-amber-400 font-semibold border-r border-slate-800';

  const dim    = mode === 'prev';
  const strong = mode === 'cum';

  // mode ごとの数値 / 時間整形 (0 のときは "0" / "0:00" を表示し "—" にしない)
  const formatNum  = (v: number) => String(v || 0);
  const formatTime = (v: number) => (mode === 'sum' ? (fromMin(v) || '0:00') : fmtCum(v));

  const valueFor = (key: RowKey): string => {
    if (key === 'to')  return formatNum(cum.to);
    if (key === 'ldg') return formatNum(cum.ldg);
    // 時間列は Cumulative の同名キーを参照
    const timeKeys: Record<string, number> = {
      total:    cum.total,
      picTotal: cum.picTotal,
      sicTotal: cum.sicTotal,
      pic:      cum.pic,
      picXC:    cum.picXC,
      picNT:    cum.picNT,
      sic:      cum.sic,
      coDual:   cum.coDual,
      xc:       cum.xc,
      night:    cum.night,
      hood:     cum.hood,
      sim:      cum.sim,
      train:    cum.train,
      imc:      cum.imc,
      other:    cum.other,
    };
    if (key in timeKeys) return formatTime(timeKeys[key]);
    return ''; // text 列は空
  };

  // 合計行では roleTotal の塗りを控えめにしすぎないよう、sum/prev は cell tint、cum は header tint ベース
  const groupTintFor = (g: ColGroup) =>
    mode === 'cum' ? groupTintHeader(g) : groupTintCell(g);

  return (
    <div className={rowCls}>
      <div style={{ width: 40 }} className="border-r border-slate-800"></div>
      {columns.map((c, idx) => {
        const divider = isGroupStart(idx) ? GROUP_DIVIDER : '';
        const tint    = groupTintFor(c.group);

        // 最初の列は「項合計 / 前項まで / 合計」ラベルで置換
        if (idx === 0) {
          return (
            <div key={c.key} style={{ width: c.width, textAlign: 'center' }} className={labelCls}>
              {label}
            </div>
          );
        }
        if (c.type === 'text') {
          // 「text 列」は空セル（登録記号や備考欄など、合計に意味がない）
          return (
            <div
              key={c.key}
              style={{ width: c.width }}
              className={`border-r border-slate-800/70 last:border-r-0 ${divider} ${tint}`}
            ></div>
          );
        }
        const v = valueFor(c.key);
        const color = strong && c.key === 'total' ? 'text-white font-semibold' : colorFor(c.key);
        return (
          <TotalCell
            key={c.key}
            value={v}
            w={c.width}
            color={color}
            dim={dim}
            strong={strong}
            compact={mode === 'cum'}
            extraClass={`${divider} ${tint}`}
          />
        );
      })}
    </div>
  );
}

function Metric({
  label, value, accent = 'amber', icon: Icon,
}: {
  label: string;
  value: string;
  accent?: 'amber' | 'cyan' | 'emerald' | 'rose' | 'violet';
  icon?: LucideIcon;
}) {
  const c = {
    amber: 'text-amber-400', cyan: 'text-cyan-400', emerald: 'text-emerald-400',
    rose: 'text-rose-400', violet: 'text-violet-400',
  };
  return (
    <div className="bg-slate-900/60 border-0 p-5 hover:bg-slate-900 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-medium">{label}</span>
        {Icon && <Icon size={14} className="text-slate-600" />}
      </div>
      <div className={`text-2xl font-light mono ${c[accent]}`}>{value}</div>
    </div>
  );
}

function Stat({
  label, value, color = 'text-slate-200', isNum = false,
}: {
  label: string;
  value: string;
  color?: string;
  isNum?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">{label}</div>
      <div className={`mono text-sm ${color}`}>
        {isNum ? (value || '0') : (value || '—')}
      </div>
    </div>
  );
}

function BaseField({
  label, value, onChange, placeholder, accent = 'text-slate-200',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accent?: string;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500 font-medium mb-1">{label}</div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-slate-900 border border-slate-700 focus:border-amber-400/60 focus:outline-none px-3 py-2 text-sm mono text-right ${accent}`}
      />
    </label>
  );
}

// ========================================
// MFTR Import Preview Modal
// ========================================

function MftrPreviewModal({
  state,
  committing,
  onClose,
  onCommit,
}: {
  state: {
    filePath: string;
    parsed: MftrParseResult;
    bodyChecks: ValidationDiff[];
    footerChecks: ValidationDiff[];
    allOk: boolean;
  };
  committing: boolean;
  onClose: () => void;
  onCommit: () => void;
}) {
  const { parsed, bodyChecks, footerChecks, allOk } = state;

  const fmt = (m: number) => {
    if (!m) return '0:00';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}:${mm.toString().padStart(2, '0')}`;
  };

  const realFlights = parsed.flights.filter(f => !f.isDeadhead);
  const deadheadCount = parsed.flights.filter(f => f.isDeadhead).length;
  const simCount = parsed.flights.filter(f => f.isSim).length;
  const monthLabel = parsed.monthLabel
    ? `${parsed.year}年${parsed.month}月 (${parsed.monthLabel})`
    : '月不明';

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-sm uppercase tracking-[0.2em] font-medium flex items-center gap-3">
            <FileText size={16} className="text-emerald-400" />
            MFTR Import Preview
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ヘッダー情報 */}
          <section className="bg-slate-950/60 border border-slate-800 p-4">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-3">Source</div>
            <div className="grid grid-cols-[120px_1fr] gap-y-2 text-xs mono">
              <div className="text-slate-500">File:</div>
              <div className="text-slate-300 break-all">{state.filePath}</div>
              <div className="text-slate-500">月:</div>
              <div className="text-amber-300 font-semibold">{monthLabel}</div>
              <div className="text-slate-500">氏名:</div>
              <div className="text-slate-200">{parsed.pilotName || '(不明)'}</div>
              <div className="text-slate-500">社員番号:</div>
              <div className="text-slate-300">{parsed.empNo || '-'}</div>
              <div className="text-slate-500">POST:</div>
              <div className="text-slate-300">{parsed.post || '-'}</div>
              <div className="text-slate-500">件数:</div>
              <div className="text-slate-300">
                実フライト {realFlights.length - simCount} · DH {deadheadCount} · SIM {simCount}
              </div>
            </div>
          </section>

          {/* 警告 */}
          {parsed.warnings.length > 0 && (
            <section className="bg-amber-400/5 border border-amber-400/30 p-4">
              <div className="flex items-center gap-2 text-amber-300 text-xs uppercase tracking-[0.15em] mb-2">
                <AlertTriangle size={14} /> Warnings ({parsed.warnings.length})
              </div>
              <ul className="text-xs text-amber-200/80 space-y-1 mono">
                {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            </section>
          )}

          {/* 検証テーブル */}
          <section className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950/60 border border-slate-800 p-4">
              <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-3">
                ① body TOTAL 行 vs 自前集計
              </div>
              {bodyChecks.length === 0 ? (
                <div className="text-xs text-rose-300">TOTAL 行が見つかりません</div>
              ) : (
                <table className="w-full text-xs mono">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-1 font-normal">Field</th>
                      <th className="text-right py-1 font-normal">PDF</th>
                      <th className="text-right py-1 font-normal">計算</th>
                      <th className="text-center py-1 font-normal">OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bodyChecks.map(c => (
                      <tr key={c.field} className="border-t border-slate-900">
                        <td className="py-1 text-slate-400">{c.field}</td>
                        <td className={`py-1 text-right ${c.ok ? 'text-slate-200' : 'text-rose-300'}`}>
                          {c.field === 'T/O' || c.field === 'L/D' ? c.pdf : fmt(c.pdf)}
                        </td>
                        <td className={`py-1 text-right ${c.ok ? 'text-slate-200' : 'text-rose-300'}`}>
                          {c.field === 'T/O' || c.field === 'L/D' ? c.computed : fmt(c.computed)}
                        </td>
                        <td className="py-1 text-center">
                          {c.ok ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✗</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-slate-950/60 border border-slate-800 p-4">
              <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-3">
                ② footer THIS MONTH vs 自前集計
              </div>
              {footerChecks.length === 0 ? (
                <div className="text-xs text-rose-300">THIS MONTH 行が見つかりません</div>
              ) : (
                <table className="w-full text-xs mono">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-1 font-normal">Field</th>
                      <th className="text-right py-1 font-normal">PDF</th>
                      <th className="text-right py-1 font-normal">計算</th>
                      <th className="text-center py-1 font-normal">OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {footerChecks.map(c => (
                      <tr key={c.field} className="border-t border-slate-900">
                        <td className="py-1 text-slate-400">{c.field}</td>
                        <td className={`py-1 text-right ${c.ok ? 'text-slate-200' : 'text-rose-300'}`}>{fmt(c.pdf)}</td>
                        <td className={`py-1 text-right ${c.ok ? 'text-slate-200' : 'text-rose-300'}`}>{fmt(c.computed)}</td>
                        <td className="py-1 text-center">
                          {c.ok ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✗</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* フライト一覧プレビュー */}
          <section className="bg-slate-950/60 border border-slate-800 p-4">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-3">
              Flights ({parsed.flights.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] mono">
                <thead className="text-slate-500 sticky top-0 bg-slate-950">
                  <tr>
                    <th className="text-left py-1 px-2 font-normal">Day</th>
                    <th className="text-left py-1 px-2 font-normal">Flt</th>
                    <th className="text-left py-1 px-2 font-normal">Route</th>
                    <th className="text-left py-1 px-2 font-normal">Ship</th>
                    <th className="text-left py-1 px-2 font-normal">Code</th>
                    <th className="text-right py-1 px-2 font-normal">Block</th>
                    <th className="text-right py-1 px-2 font-normal">Rec</th>
                    <th className="text-right py-1 px-2 font-normal">N/T</th>
                    <th className="text-right py-1 px-2 font-normal">I/T</th>
                    <th className="text-right py-1 px-2 font-normal">T/O</th>
                    <th className="text-right py-1 px-2 font-normal">L/D</th>
                    <th className="text-right py-1 px-2 font-normal">SIM</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.flights.map((f, i) => {
                    const tag = f.isDeadhead ? 'DH' : f.isSim ? 'SIM' : '';
                    const tagCls = f.isDeadhead
                      ? 'text-slate-500'
                      : f.isSim
                      ? 'text-violet-300'
                      : f.recordedCode === 'PUS'
                      ? 'text-amber-300'
                      : 'text-cyan-300';
                    return (
                      <tr key={i} className="border-t border-slate-900 hover:bg-slate-900/50">
                        <td className="py-1 px-2 text-slate-400">{String(f.day).padStart(2, '0')}</td>
                        <td className="py-1 px-2 text-slate-200">{f.fltNo}</td>
                        <td className="py-1 px-2 text-slate-300">{f.fromTo}</td>
                        <td className="py-1 px-2 text-slate-300">{f.ship}</td>
                        <td className={`py-1 px-2 ${tagCls}`}>{tag || f.recordedCode || f.dutyCode}</td>
                        <td className="py-1 px-2 text-right text-slate-200">{fmt(f.blockTimeMin)}</td>
                        <td className="py-1 px-2 text-right text-slate-300">{fmt(f.recordedDutyTimeMin)}</td>
                        <td className="py-1 px-2 text-right text-violet-300">{fmt(f.pilotNTMin)}</td>
                        <td className="py-1 px-2 text-right text-rose-300">{fmt(f.pilotITMin)}</td>
                        <td className="py-1 px-2 text-right text-slate-300">
                          {f.takeoffs ? `${f.takeoffs}${f.takeoffsNight ? 'N' : ''}` : ''}
                        </td>
                        <td className="py-1 px-2 text-right text-slate-300">
                          {f.landings ? `${f.landings}${f.landingsNight ? 'N' : ''}` : ''}
                        </td>
                        <td className="py-1 px-2 text-right text-slate-400">
                          {f.simMin ? fmt(f.simMin) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Row 変換プレビュー (最初の5件) */}
          <section className="bg-slate-950/60 border border-slate-800 p-4">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mb-3">
              App Row Conversion Preview (first 5 real flights)
            </div>
            <div className="space-y-1 text-[10px] mono text-slate-400">
              {parsed.flights.filter(f => !f.isDeadhead).slice(0, 5).map((f, i) => {
                const row = mftrFlightToRow(f, parsed.month);
                return (
                  <div key={i}>
                    [{i}] {row.date} {row.flightNo.padEnd(8)} {row.route.padEnd(8)} {row.reg.padEnd(5)}
                    {' '}tot=<span className="text-slate-200">{row.total || '-'}</span>
                    {' '}pic=<span className="text-amber-300">{row.pic || '-'}</span>
                    {' '}sic=<span className="text-cyan-300">{row.sic || '-'}</span>
                    {' '}picNT=<span className="text-amber-400">{row.picNT || '-'}</span>
                    {' '}night=<span className="text-violet-300">{row.night || '-'}</span>
                    {' '}imc=<span className="text-rose-300">{row.imc || '-'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* フッター: コミット or 閉じる */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex justify-between items-center">
          <div className="text-xs">
            {allOk ? (
              <span className="text-emerald-400">✓ 全検証パス — コミット可能</span>
            ) : (
              <span className="text-rose-300">✗ 検証失敗 — コミットできません</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={committing}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              CLOSE
            </button>
            <button
              onClick={onCommit}
              disabled={!allOk || committing}
              className="bg-emerald-500 text-slate-950 px-5 py-2 text-sm font-medium hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {committing ? 'COMMITTING…' : 'COMMIT TO DATABASE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
