// UI ⇄ SQLite 間の変換と、アプリ全体のドメイン型。
// UI は hh:mm 文字列で編集、DB は分(整数) / 離着陸は int / text は text。

export type RowKey =
  | 'date' | 'to' | 'ldg' | 'total'
  | 'picTotal' | 'sicTotal'
  | 'pic' | 'picXC' | 'picNT'
  | 'sic' | 'coDual' | 'xc' | 'night'
  | 'hood' | 'sim' | 'train' | 'imc' | 'other'
  | 'aircraft' | 'reg' | 'flightNo' | 'route' | 'notes';

export type Row = Record<RowKey, string>;

export interface Cumulative {
  to: number; ldg: number; total: number;
  picTotal: number; sicTotal: number;
  pic: number; picXC: number; picNT: number;
  sic: number; coDual: number; xc: number; night: number;
  hood: number; sim: number; train: number; imc: number; other: number;
}

export interface Page {
  id: number;              // DB page_id
  year: number;
  month: string;           // '01'..'12'
  subIndex: number;
  rows: Row[];             // 長さ = ROWS_PER_PAGE
}

// SQLite 行の形（main.ts のスキーマと一致）
export interface DbPage {
  id: number;
  year: number;
  month: string;
  sub_index: number;
  created_at: string;
}

export interface DbFlight {
  id?: number;
  page_id: number;
  row_index: number;
  date: string | null;
  takeoffs: number | null;
  landings: number | null;
  takeoffs_night: number | null;
  landings_night: number | null;
  total_min: number | null;
  pic_total_min: number | null;
  sic_total_min: number | null;
  pic_min: number | null;
  pic_xc_min: number | null;
  pic_nt_min: number | null;
  sic_min: number | null;
  co_dual_min: number | null;
  xc_min: number | null;
  night_min: number | null;
  hood_min: number | null;
  sim_min: number | null;
  train_min: number | null;
  imc_min: number | null;
  other_min: number | null;
  aircraft: string | null;
  registration: string | null;
  flight_no: string | null;
  route: string | null;
  notes: string | null;
}

export interface DbCumulativeBase {
  id: number;
  takeoffs: number;
  landings: number;
  total_min: number;
  pic_total_min: number;
  sic_total_min: number;
  pic_min: number;
  pic_xc_min: number;
  pic_nt_min: number;
  sic_min: number;
  co_dual_min: number;
  xc_min: number;
  night_min: number;
  hood_min: number;
  sim_min: number;
  train_min: number;
  imc_min: number;
  other_min: number;
}

// --- 時間変換 ---

export const toMin = (s: string): number => {
  if (!s || typeof s !== 'string') return 0;
  const t = s.trim();
  if (!t) return 0;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = parseFloat(t);
  return isNaN(n) ? 0 : Math.round(n * 60);
};

export const fromMin = (m: number): string => {
  if (!m) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${mm.toString().padStart(2, '0')}`;
};

export const fmtCum = (m: number): string => {
  if (!m) return '0:00';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toLocaleString()}:${mm.toString().padStart(2, '0')}`;
};

// --- Row 空値 / 空判定 ---

export const emptyRow = (): Row => ({
  date: '', to: '', ldg: '', total: '',
  picTotal: '', sicTotal: '',
  pic: '', picXC: '', picNT: '',
  sic: '', coDual: '', xc: '', night: '',
  hood: '', sim: '', train: '', imc: '', other: '',
  aircraft: '', reg: '', flightNo: '', route: '', notes: '',
});

export const isRowEmpty = (r: Row): boolean =>
  Object.values(r).every(v => !v || !v.toString().trim());

// --- 合計 ---

export const zeroCumulative = (): Cumulative => ({
  to: 0, ldg: 0, total: 0,
  picTotal: 0, sicTotal: 0,
  pic: 0, picXC: 0, picNT: 0,
  sic: 0, coDual: 0, xc: 0, night: 0,
  hood: 0, sim: 0, train: 0, imc: 0, other: 0,
});

// 時間列のキー一覧（hh:mm を分で扱う）
export const TIME_KEYS = [
  'total',
  'picTotal', 'sicTotal',
  'pic', 'picXC', 'picNT',
  'sic', 'coDual', 'xc', 'night',
  'hood', 'sim', 'train', 'imc', 'other',
] as const;

// SIM セッション（実機ではない訓練）の判定
// - sim 列に時間が入っていて、total（飛行時間）が空 → 実飛行ではない
// SIM 行の T/O・L/D は「模擬離着陸」なので実飛行の離着陸回数には加算しない。
export const isSimTrainingRow = (r: Row): boolean =>
  !!r.sim && !r.total;

// "N1" / "1N" / "1" などから数値部分を抽出 (夜間表記の N を許容)
export const parseLeg = (s: string): number => {
  const m = (s || '').trim().match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// 入力が "N1" (大文字 N で始まる) または "1N" (大文字 N で終わる) なら夜間
export const isLegNight = (s: string): boolean => /^N\d|\dN$/i.test((s || '').trim());

export const sumRows = (rows: Row[]): Cumulative => {
  const sum = zeroCumulative();
  rows.forEach(r => {
    if (!isSimTrainingRow(r)) {
      sum.to  += parseLeg(r.to);
      sum.ldg += parseLeg(r.ldg);
    }
    for (const k of TIME_KEYS) {
      sum[k] += toMin(r[k]);
    }
  });
  return sum;
};

export const addCumulative = (a: Cumulative, b: Cumulative): Cumulative => {
  const out = { ...a };
  out.to  = a.to  + b.to;
  out.ldg = a.ldg + b.ldg;
  for (const k of TIME_KEYS) out[k] = a[k] + b[k];
  return out;
};

// --- DB ⇄ UI 変換 ---

export const dbFlightToRow = (f: DbFlight): Row => ({
  date:     f.date ?? '',
  to:       f.takeoffs == null ? '' : (f.takeoffs_night ? `N${f.takeoffs}` : String(f.takeoffs)),
  ldg:      f.landings == null ? '' : (f.landings_night ? `N${f.landings}` : String(f.landings)),
  total:    fromMin(f.total_min ?? 0),
  picTotal: fromMin(f.pic_total_min ?? 0),
  sicTotal: fromMin(f.sic_total_min ?? 0),
  pic:      fromMin(f.pic_min ?? 0),
  picXC:    fromMin(f.pic_xc_min ?? 0),
  picNT:    fromMin(f.pic_nt_min ?? 0),
  sic:      fromMin(f.sic_min ?? 0),
  coDual:   fromMin(f.co_dual_min ?? 0),
  xc:       fromMin(f.xc_min ?? 0),
  night:    fromMin(f.night_min ?? 0),
  hood:     fromMin(f.hood_min ?? 0),
  sim:      fromMin(f.sim_min ?? 0),
  train:    fromMin(f.train_min ?? 0),
  imc:      fromMin(f.imc_min ?? 0),
  other:    fromMin(f.other_min ?? 0),
  aircraft: f.aircraft ?? '',
  reg:      f.registration ?? '',
  flightNo: f.flight_no ?? '',
  route:    f.route ?? '',
  notes:    f.notes ?? '',
});

export const rowToDbFlight = (r: Row, pageId: number, rowIndex: number): DbFlight => ({
  page_id:      pageId,
  row_index:    rowIndex,
  date:         r.date || null,
  takeoffs:     r.to  ? parseLeg(r.to)  : null,
  landings:     r.ldg ? parseLeg(r.ldg) : null,
  takeoffs_night: r.to  && isLegNight(r.to)  ? 1 : 0,
  landings_night: r.ldg && isLegNight(r.ldg) ? 1 : 0,
  total_min:    r.total    ? toMin(r.total)    : null,
  pic_total_min: r.picTotal ? toMin(r.picTotal) : null,
  sic_total_min: r.sicTotal ? toMin(r.sicTotal) : null,
  pic_min:      r.pic      ? toMin(r.pic)      : null,
  pic_xc_min:   r.picXC    ? toMin(r.picXC)    : null,
  pic_nt_min:   r.picNT    ? toMin(r.picNT)    : null,
  sic_min:      r.sic      ? toMin(r.sic)      : null,
  co_dual_min:  r.coDual   ? toMin(r.coDual)   : null,
  xc_min:       r.xc       ? toMin(r.xc)       : null,
  night_min:    r.night    ? toMin(r.night)    : null,
  hood_min:     r.hood     ? toMin(r.hood)     : null,
  sim_min:      r.sim      ? toMin(r.sim)      : null,
  train_min:    r.train    ? toMin(r.train)    : null,
  imc_min:      r.imc      ? toMin(r.imc)      : null,
  other_min:    r.other    ? toMin(r.other)    : null,
  aircraft:     r.aircraft || null,
  registration: r.reg      || null,
  flight_no:    r.flightNo || null,
  route:        r.route    || null,
  notes:        r.notes    || null,
});

export const dbCumBaseToCumulative = (b: DbCumulativeBase | null | undefined): Cumulative => {
  if (!b) return zeroCumulative();
  return {
    to:       b.takeoffs ?? 0,
    ldg:      b.landings ?? 0,
    total:    b.total_min ?? 0,
    picTotal: b.pic_total_min ?? 0,
    sicTotal: b.sic_total_min ?? 0,
    pic:      b.pic_min ?? 0,
    picXC:    b.pic_xc_min ?? 0,
    picNT:    b.pic_nt_min ?? 0,
    sic:      b.sic_min ?? 0,
    coDual:   b.co_dual_min ?? 0,
    xc:       b.xc_min ?? 0,
    night:    b.night_min ?? 0,
    hood:     b.hood_min ?? 0,
    sim:      b.sim_min ?? 0,
    train:    b.train_min ?? 0,
    imc:      b.imc_min ?? 0,
    other:    b.other_min ?? 0,
  };
};

export const cumulativeToDbCumBase = (c: Cumulative): Omit<DbCumulativeBase, 'id'> => ({
  takeoffs:      c.to,
  landings:      c.ldg,
  total_min:     c.total,
  pic_total_min: c.picTotal,
  sic_total_min: c.sicTotal,
  pic_min:       c.pic,
  pic_xc_min:    c.picXC,
  pic_nt_min:    c.picNT,
  sic_min:       c.sic,
  co_dual_min:   c.coDual,
  xc_min:        c.xc,
  night_min:     c.night,
  hood_min:      c.hood,
  sim_min:       c.sim,
  train_min:     c.train,
  imc_min:       c.imc,
  other_min:     c.other,
});

// 旧 JSX にハードコードされていた 2025/12 時点の累計（初回 seed 用）
// 新規5列（picTotal/sicTotal/coDual/hood/train）は 0 で seed（PDF到着時に Settings から更新）
export const SEED_CUMULATIVE_2025_12: Cumulative = {
  to: 1670, ldg: 1693,
  total:    7532 * 60 + 45,
  picTotal: 0,
  sicTotal: 0,
  pic:      2006 * 60 + 30,
  picXC:    2065 * 60 + 6,
  picNT:     571 * 60 + 47,
  sic:      5119 * 60 + 27,
  coDual:   0,
  xc:       5133 * 60 + 42,
  night:    1499 * 60 + 2,
  hood:     0,
  sim:       279 * 60 + 40,
  train:    0,
  imc:      1314 * 60 + 24,
  other:     153 * 60 + 27,
};

// --- Sort / key ---

export const sortPages = <T extends { year: number; month: string; subIndex: number }>(pages: T[]): T[] =>
  [...pages].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month < b.month ? -1 : 1;
    return a.subIndex - b.subIndex;
  });

export const monthKey = (p: { year: number; month: string }): string => `${p.year}-${p.month}`;

export const pageName = (p: { year: number; month: string; subIndex: number; monthLabel?: string }): string => {
  const label = p.monthLabel ?? '';
  const base = `${p.year}${label || p.month}`;
  return p.subIndex > 1 ? `${base}-${p.subIndex}` : base;
};
