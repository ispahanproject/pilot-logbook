// JAL MFTR (Monthly Flight Time Record) PDF パーサー
// 入力: `pdftotext -layout` で抽出されたテキスト
// 出力: 月・フライト行・集計値（合計検証用）

import { type Row, emptyRow } from './db';

// =============================================================================
// 時刻・数値ヘルパ
// =============================================================================

/** MFTR時間文字列 → 分
 *  "1.49" → 109分 (1h49m), ".30" → 30分, ""/null → 0
 *  注: MFTRの "." は時:分の区切り（10進ではない）*/
export function parseMftrTime(s: string | null | undefined): number {
  if (!s) return 0;
  const t = s.trim();
  if (!t) return 0;
  const m = t.match(/^(\d*)\.(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1] || '0', 10);
    const mm = parseInt(m[2].padEnd(2, '0'), 10);
    return h * 60 + mm;
  }
  const n = parseInt(t, 10);
  return isNaN(n) ? 0 : n * 60;
}

/** "1N"/"2N" のような夜間マーク付きカウントを分解 */
function stripNightSuffix(s: string | null | undefined): { count: number; night: boolean } {
  if (!s) return { count: 0, night: false };
  const m = s.trim().match(/^(\d+)(N?)$/i);
  if (!m) return { count: 0, night: false };
  return { count: parseInt(m[1], 10), night: m[2].toUpperCase() === 'N' };
}

// =============================================================================
// 型定義
// =============================================================================

/** MFTRから直接パースされた1フライト行 */
export interface MftrFlightRow {
  day: number;                 // 1-31
  fltNo: string;               // "JL 0145" or "SIM"
  fromTo: string;              // "HND-AOJ"
  ship: string;                // "316J" or "737"
  dutyCode: string;            // "PUS" | "CO" | "DH1" | "TRP"
  blockIn: string;             // "1514"
  blockOut: string;            // "1325"
  blockTimeMin: number;        // 分
  balanceMin: number;
  nightInDutyMin: number;
  recordedCode: string;        // "PUS" | "CO" | ""
  recordedDutyTimeMin: number;
  pilotNTMin: number;
  pilotITMin: number;
  takeoffs: number;
  takeoffsNight: boolean;
  landings: number;
  landingsNight: boolean;
  simMin: number;
  isSim: boolean;
  isDeadhead: boolean;
}

/** MFTR body の「TOTAL」行（フライト行と同じ列） */
export interface MftrBodyTotals {
  blockTimeMin: number;
  balanceMin: number;
  nightInDutyMin: number;
  recordedDutyTimeMin: number;
  pilotNTMin: number;
  pilotITMin: number;
  takeoffs: number;
  landings: number;
  simMin: number;
}

/** MFTR footer の「THIS MONTH」行（別カラム体系） */
export interface MftrMonthTotals {
  flight: number;
  pus: number;
  pusCC: number;
  pusNT: number;
  co: number;
  coDual: number;
  coCC: number;
  coNT: number;
  instrument: number;
  simulator: number;
  other: number;
}

/** メインのパース結果 */
export interface MftrParseResult {
  year: number;                // 2026
  month: string;               // '01'..'12'
  monthLabel: string;          // 'Feb'
  pilotName: string;           // "KUBOTA KN KENTARO"
  empNo: string;               // "53856"
  post: string;                // "737COP"
  flights: MftrFlightRow[];
  bodyTotals: MftrBodyTotals | null;
  monthTotals: MftrMonthTotals | null;
  warnings: string[];
}

// =============================================================================
// 列位置定義 (0-indexed, [start, end))
// 2種類のレイアウト:
//   pdftotext: macOS `pdftotext -layout` 出力
//   pdfjs:     pdfjs-dist で抽出 → 自前でレイアウト再構築 (Courier 6pt/char)
// `parseMftrLayout` がヘッダー行から自動判定する
// =============================================================================

type ColSchema = Record<string, readonly [number, number]>;

const COL_PDFTOTEXT: ColSchema = {
  day:              [1, 5],
  fltNo:            [5, 14],
  fromTo:           [14, 24],
  shipNo:           [24, 31],
  md:               [31, 37],
  dutyCode:         [37, 44],
  blockIn:          [44, 49],
  blockOut:         [49, 54],
  blockTime:        [54, 65],
  balanceThisLeg:   [65, 75],
  ntInDutyTime:     [75, 85],
  recordedCode:     [85, 93],
  recordedDutyTime: [93, 104],
  pilotNT:          [104, 112],
  pilotIT:          [112, 119],
  takeoffs:         [119, 125],
  landings:         [125, 131],
  simCkTrng:        [131, 999],
};

const COL_PDFJS: ColSchema = {
  day:              [0, 4],
  fltNo:            [4, 13],
  fromTo:           [13, 22],
  shipNo:           [22, 29],
  md:               [29, 32],
  dutyCode:         [32, 38],
  blockIn:          [38, 43],
  blockOut:         [43, 48],
  blockTime:        [48, 58],
  balanceThisLeg:   [58, 67],
  ntInDutyTime:     [67, 76],
  recordedCode:     [76, 82],
  recordedDutyTime: [82, 91],
  pilotNT:          [91, 99],
  pilotIT:          [99, 105],
  takeoffs:         [105, 109],
  landings:         [109, 114],
  simCkTrng:        [114, 999],
};

type FooterSchema = { cols: { name: string; center: number }[]; tolerance: number };

const FOOTER_PDFTOTEXT: FooterSchema = {
  tolerance: 7,
  cols: [
    { name: 'flight',     center: 17 },
    { name: 'pic',        center: 24 },
    { name: 'sic',        center: 31 },
    { name: 'solo',       center: 40 },
    { name: 'pus',        center: 57 },
    { name: 'pusCC',      center: 64 },
    { name: 'pusNT',      center: 76 },
    { name: 'co',         center: 84 },
    { name: 'coDual',     center: 96 },
    { name: 'coCC',       center: 104 },
    { name: 'coNT',       center: 112 },
    { name: 'instrument', center: 120 },
    { name: 'simulator',  center: 134 },
    { name: 'instruct',   center: 142 },
    { name: 'other',      center: 152 },
  ],
};

// pdfjs (Courier 6pt/char 再構築) での footer カラム中心。
// "THIS MONTH    54.42                               21.49    21.49     4.18    32.53             32.53    11.38     6.00     2.00"
//  0         1         2         3         4         5         6         7         8         9         0         1         2
//  0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123
//  "THIS MONTH" at 0-9. "54.42" at 14-18 → center 16.
//  "21.49" at 48-52 → center 50. "21.49" at 57-61 → center 59. "4.18" at 67-70 → center 68.5.
//  "32.53" at 77-81 → center 79. "32.53" at 95-99 → center 97. "11.38" at 104-108 → center 106.
//  "6.00" at 113-116 → center 114.5. "2.00" at 122-125 → center 123.5.
const FOOTER_PDFJS: FooterSchema = {
  tolerance: 6,
  cols: [
    { name: 'flight',     center: 16 },
    { name: 'pic',        center: 22 },
    { name: 'sic',        center: 28 },
    { name: 'solo',       center: 36 },
    { name: 'pus',        center: 50 },
    { name: 'pusCC',      center: 59 },
    { name: 'pusNT',      center: 68 },
    { name: 'co',         center: 79 },
    { name: 'coDual',     center: 88 },
    { name: 'coCC',       center: 97 },
    { name: 'coNT',       center: 106 },
    { name: 'instrument', center: 114 },
    { name: 'simulator',  center: 123 },
    { name: 'instruct',   center: 132 },
    { name: 'other',      center: 141 },
  ],
};

function slice(line: string, range: readonly [number, number]): string {
  const [s, e] = range;
  const end = e === 999 ? line.length : Math.min(e, line.length);
  if (s >= line.length) return '';
  return line.slice(s, end).trim();
}

/** ヘッダー行の位置から pdftotext/pdfjs レイアウトを自動判定 */
function detectSchema(lines: string[]): { col: ColSchema; footer: FooterSchema } {
  for (const line of lines) {
    if (!/^\s*DAY\s+FLT\s+NO\./.test(line)) continue;
    // pdfjs:    "DAY  FLT NO."  → FLT-DAY = 5
    // pdftotxt: "DAY   FLT NO." → FLT-DAY = 6
    const dayIdx = line.indexOf('DAY');
    const fltIdx = line.indexOf('FLT');
    if (fltIdx - dayIdx <= 5) return { col: COL_PDFJS, footer: FOOTER_PDFJS };
    return { col: COL_PDFTOTEXT, footer: FOOTER_PDFTOTEXT };
  }
  // デフォルト: pdfjs
  return { col: COL_PDFJS, footer: FOOTER_PDFJS };
}

// =============================================================================
// 月名マッピング
// =============================================================================

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// =============================================================================
// メインパーサー
// =============================================================================

export function parseMftrLayout(text: string): MftrParseResult {
  const lines = text.split('\n');
  const warnings: string[] = [];

  // --- レイアウト自動判定 ---
  const schema = detectSchema(lines);

  // --- ヘッダー行 ---
  // " Feb 2026   KUBOTA   KN KENTARO   53856  222  NSZ-NSB-002   737COP  -24/12/09 ..."
  let year = 0;
  let month = '';
  let monthLabel = '';
  let pilotName = '';
  let empNo = '';
  let post = '';

  for (const line of lines) {
    const hm = line.match(/^\s+([A-Z][a-z]{2})\s+(\d{4})\s+(.+)$/);
    if (!hm) continue;
    monthLabel = hm[1];
    const candidateMonth = MONTH_MAP[monthLabel];
    if (!candidateMonth) continue;
    year = parseInt(hm[2], 10);
    month = candidateMonth;
    // 残り: name(複数トークン) + empNo(数字) + term + section + post
    const rest = hm[3];
    // empNo は最初に出てくる数字(4-6桁)
    const em = rest.match(/^(.+?)\s{2,}(\d{4,6})\s+\S+\s+\S+\s+(\S+)/);
    if (em) {
      pilotName = em[1].replace(/\s+/g, ' ').trim();
      empNo = em[2];
      post = em[3];
    }
    break;
  }

  // --- フライト行 ---
  const flights: MftrFlightRow[] = [];
  // フライト行は " DD   JL NNNN" または " DD       SIM" で始まる
  const flightStartPattern = /^\s*\d{1,2}\s+(JL\s+\d{3,4}|SIM)\s/;
  for (const line of lines) {
    if (!flightStartPattern.test(line)) continue;
    const flight = parseFlightLine(line, schema.col);
    if (flight) flights.push(flight);
    else warnings.push(`フライト行のパース失敗: "${line.trim().slice(0, 60)}..."`);
  }

  // --- body TOTAL 行 (フライト行と同じ列体系) ---
  // pdftotext: "                            TOTAL     58.16 ..."
  // pdfjs:     "                                          TOTAL   58.16 ..." (インデントはズレる)
  let bodyTotals: MftrBodyTotals | null = null;
  for (const line of lines) {
    if (!/^\s{10,}TOTAL\s+\d+\.\d{2}/.test(line)) continue;
    bodyTotals = parseBodyTotalLine(line, schema.col);
    if (!bodyTotals) warnings.push(`body TOTAL 行のパース失敗`);
    break;
  }

  // --- footer THIS MONTH 行 ---
  let monthTotals: MftrMonthTotals | null = null;
  for (const line of lines) {
    if (!/^\s*THIS\s+MONTH\s+/.test(line)) continue;
    monthTotals = parseFooterTotalsLine(line, schema.footer);
    break;
  }

  return {
    year, month, monthLabel, pilotName, empNo, post,
    flights, bodyTotals, monthTotals, warnings,
  };
}

// =============================================================================
// フライト行パーサー
// =============================================================================

function parseFlightLine(line: string, col: ColSchema): MftrFlightRow | null {
  const dayStr = slice(line, col.day);
  const day = parseInt(dayStr, 10);
  if (!day || day < 1 || day > 31) return null;

  const fltNo = slice(line, col.fltNo);
  const fromTo = slice(line, col.fromTo);
  const ship = slice(line, col.shipNo);
  const dutyCode = slice(line, col.dutyCode).toUpperCase();
  const blockIn = slice(line, col.blockIn);
  const blockOut = slice(line, col.blockOut);

  const blockTime = slice(line, col.blockTime);
  const balance = slice(line, col.balanceThisLeg);
  const ntInDuty = slice(line, col.ntInDutyTime);
  const recordedCode = slice(line, col.recordedCode).toUpperCase();
  const recordedDuty = slice(line, col.recordedDutyTime);
  const pilotNT = slice(line, col.pilotNT);
  const pilotIT = slice(line, col.pilotIT);
  const takeoffsStr = slice(line, col.takeoffs);
  const landingsStr = slice(line, col.landings);
  const simStr = slice(line, col.simCkTrng);

  const toInfo = stripNightSuffix(takeoffsStr);
  const ldInfo = stripNightSuffix(landingsStr);

  const isSim = fltNo.toUpperCase() === 'SIM' || dutyCode === 'TRP';
  const isDeadhead = dutyCode === 'DH1';

  return {
    day,
    fltNo,
    fromTo,
    ship,
    dutyCode,
    blockIn,
    blockOut,
    blockTimeMin: parseMftrTime(blockTime),
    balanceMin: parseMftrTime(balance),
    nightInDutyMin: parseMftrTime(ntInDuty),
    recordedCode,
    recordedDutyTimeMin: parseMftrTime(recordedDuty),
    pilotNTMin: parseMftrTime(pilotNT),
    pilotITMin: parseMftrTime(pilotIT),
    takeoffs: toInfo.count,
    takeoffsNight: toInfo.night,
    landings: ldInfo.count,
    landingsNight: ldInfo.night,
    simMin: parseMftrTime(simStr),
    isSim,
    isDeadhead,
  };
}

// =============================================================================
// body TOTAL 行パーサー (フライト行と同じ列)
// =============================================================================

function parseBodyTotalLine(line: string, col: ColSchema): MftrBodyTotals | null {
  return {
    blockTimeMin: parseMftrTime(slice(line, col.blockTime)),
    balanceMin: parseMftrTime(slice(line, col.balanceThisLeg)),
    nightInDutyMin: parseMftrTime(slice(line, col.ntInDutyTime)),
    recordedDutyTimeMin: parseMftrTime(slice(line, col.recordedDutyTime)),
    pilotNTMin: parseMftrTime(slice(line, col.pilotNT)),
    pilotITMin: parseMftrTime(slice(line, col.pilotIT)),
    takeoffs: parseInt(slice(line, col.takeoffs), 10) || 0,
    landings: parseInt(slice(line, col.landings), 10) || 0,
    simMin: parseMftrTime(slice(line, col.simCkTrng)),
  };
}

// =============================================================================
// footer THIS MONTH/TOTAL 行パーサー
// 列幅が値により伸縮するため、トークン抽出 + 中心位置マッチング方式
// =============================================================================

/** 行を数値トークンに分解 */
function tokenizeRow(line: string): { str: string; start: number; end: number; center: number }[] {
  const tokens: { str: string; start: number; end: number; center: number }[] = [];
  const re = /[\d.]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const str = m[0];
    // "." 単独など、有効数値でないものは除外
    if (!/\d/.test(str)) continue;
    const start = m.index;
    const end = start + str.length;
    tokens.push({ str, start, end, center: (start + end) / 2 });
  }
  return tokens;
}

function parseFooterTotalsLine(line: string, footer: FooterSchema): MftrMonthTotals {
  const tokens = tokenizeRow(line);
  const result: Record<string, number> = {};

  let ti = 0;
  for (const col of footer.cols) {
    if (ti >= tokens.length) break;
    const tok = tokens[ti];
    if (Math.abs(tok.center - col.center) <= footer.tolerance) {
      result[col.name] = parseMftrTime(tok.str);
      ti++;
    }
  }

  return {
    flight:     result.flight     ?? 0,
    pus:        result.pus        ?? 0,
    pusCC:      result.pusCC      ?? 0,
    pusNT:      result.pusNT      ?? 0,
    co:         result.co         ?? 0,
    coDual:     result.coDual     ?? 0,
    coCC:       result.coCC       ?? 0,
    coNT:       result.coNT       ?? 0,
    instrument: result.instrument ?? 0,
    simulator:  result.simulator  ?? 0,
    other:      result.other      ?? 0,
  };
}

// =============================================================================
// フライト行 → アプリの Row 型への変換
// =============================================================================

/** MFTR flight → app Row. DH1 (deadhead) はスキップ対象なのでこの関数では変換せず、
 *  呼び出し側でフィルタすること。
 *  month を渡すと date が "MM.DD" 形式になる (未指定なら "DD" のみ)。*/
export function mftrFlightToRow(f: MftrFlightRow, month?: string): Row {
  const row = emptyRow();

  // 日付: MM.DD 形式 (month 指定時) / DD のみ (未指定時)
  const dd = String(f.day).padStart(2, '0');
  row.date = month ? `${month}.${dd}` : dd;

  // 便名・区間
  row.flightNo = f.fltNo;
  row.route = f.fromTo;

  // MFTR の "1N" (夜間) フラグは LOG 側で "N1" 表記に変換
  const fmtCount = (n: number, night: boolean): string =>
    n ? (night ? `N${n}` : String(n)) : '';

  if (f.isSim) {
    // SIMは total 空、sim にCK&TRNG時間、T/O・L/D は括弧表示
    row.sim = minutesToHhmm(f.simMin);
    row.to = fmtCount(f.takeoffs, f.takeoffsNight);
    row.ldg = fmtCount(f.landings, f.landingsNight);
    // SIMは型式・SHIP NO. を詰めない (ユーザー既定を使う)
    return row;
  }

  // 実飛行
  row.reg = f.ship;  // SHIP NO. → 登録記号
  row.to = fmtCount(f.takeoffs, f.takeoffsNight);
  row.ldg = fmtCount(f.landings, f.landingsNight);
  row.total = minutesToHhmm(f.recordedDutyTimeMin || f.blockTimeMin);

  // 昼夜判別はrecordedCodeで分岐
  const code = f.recordedCode || f.dutyCode;
  if (code === 'PUS') {
    // Pilot Under Supervision (FO as pilot-flying)
    row.pic = minutesToHhmm(f.recordedDutyTimeMin);
    row.picXC = minutesToHhmm(f.recordedDutyTimeMin);
    row.picNT = minutesToHhmm(f.pilotNTMin);
    row.notes = 'PUS';
  } else if (code === 'CO') {
    // Co-pilot (FO as monitoring/SIC)
    row.sic = minutesToHhmm(f.recordedDutyTimeMin);
    row.xc = minutesToHhmm(f.recordedDutyTimeMin);
    row.night = minutesToHhmm(f.pilotNTMin);
  } else if (code === 'PIC') {
    // Captain
    row.picTotal = minutesToHhmm(f.recordedDutyTimeMin);
  }

  // Instrument time (IMC) — duty codeに関わらずIT列が値を持てば入れる
  row.imc = minutesToHhmm(f.pilotITMin);

  return row;
}

/** 分 → "h:mm" (0は空文字) */
function minutesToHhmm(m: number): string {
  if (!m) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${mm.toString().padStart(2, '0')}`;
}

// =============================================================================
// 自前集計: フライト行から合計値を計算 (フッター検証用)
// =============================================================================

export interface ComputedTotals {
  /** フライト行から集計した「THIS MONTH」相当の合計。MFTRフッターと突き合わせる */
  flight: number;       // = sum(recordedDutyTimeMin) 実飛行のみ
  pus: number;          // = sum(recordedDutyTimeMin where code=PUS)
  pusNT: number;        // = sum(pilotNTMin where code=PUS)
  co: number;           // = sum(recordedDutyTimeMin where code=CO)
  coNT: number;         // = sum(pilotNTMin where code=CO)
  instrument: number;   // = sum(pilotITMin)
  simulator: number;    // = sum(simMin where isSim)
  takeoffs: number;     // = sum(takeoffs) 全行(SIM含む)
  landings: number;     // = sum(landings) 全行(SIM含む)
  /** body TOTAL と突き合わせる用(DH1を含む全ブロックタイム) */
  blockTimeInclDeadhead: number;
  nightInDuty: number;  // body TOTAL と突き合わせる用
}

export function computeTotalsFromFlights(flights: MftrFlightRow[]): ComputedTotals {
  const t: ComputedTotals = {
    flight: 0, pus: 0, pusNT: 0, co: 0, coNT: 0,
    instrument: 0, simulator: 0, takeoffs: 0, landings: 0,
    blockTimeInclDeadhead: 0, nightInDuty: 0,
  };
  for (const f of flights) {
    t.blockTimeInclDeadhead += f.blockTimeMin;
    t.nightInDuty += f.nightInDutyMin;
    t.takeoffs += f.takeoffs;
    t.landings += f.landings;

    if (f.isDeadhead) continue;
    if (f.isSim) {
      t.simulator += f.simMin;
      continue;
    }

    t.flight += f.recordedDutyTimeMin;
    t.instrument += f.pilotITMin;

    const code = f.recordedCode || f.dutyCode;
    if (code === 'PUS') {
      t.pus += f.recordedDutyTimeMin;
      t.pusNT += f.pilotNTMin;
    } else if (code === 'CO') {
      t.co += f.recordedDutyTimeMin;
      t.coNT += f.pilotNTMin;
    }
  }
  return t;
}

// =============================================================================
// 検証: 自前集計 vs フッター THIS MONTH を比較
// =============================================================================

export interface ValidationDiff {
  field: string;
  pdf: number;
  computed: number;
  delta: number;
  ok: boolean;
}

export function validateAgainstFooter(
  computed: ComputedTotals,
  footer: MftrMonthTotals | null
): ValidationDiff[] {
  if (!footer) return [];
  const checks: ValidationDiff[] = [
    { field: 'FLIGHT', pdf: footer.flight, computed: computed.flight, delta: 0, ok: false },
    { field: 'PUS', pdf: footer.pus, computed: computed.pus, delta: 0, ok: false },
    { field: 'PUS N/T', pdf: footer.pusNT, computed: computed.pusNT, delta: 0, ok: false },
    { field: 'CO', pdf: footer.co, computed: computed.co, delta: 0, ok: false },
    { field: 'CO N/T', pdf: footer.coNT, computed: computed.coNT, delta: 0, ok: false },
    { field: 'INSTR', pdf: footer.instrument, computed: computed.instrument, delta: 0, ok: false },
    { field: 'SIM', pdf: footer.simulator, computed: computed.simulator, delta: 0, ok: false },
  ];
  return checks.map(c => ({
    ...c,
    delta: c.computed - c.pdf,
    ok: c.computed === c.pdf,
  }));
}

/** body TOTAL との比較 (DH1 を含むブロックタイム系) */
export function validateAgainstBodyTotal(
  computed: ComputedTotals,
  totalTakeoffsFromRows: number,
  totalLandingsFromRows: number,
  body: MftrBodyTotals | null
): ValidationDiff[] {
  if (!body) return [];
  const checks: ValidationDiff[] = [
    { field: 'BLOCK TIME (incl DH)', pdf: body.blockTimeMin, computed: computed.blockTimeInclDeadhead, delta: 0, ok: false },
    { field: 'N/T IN DUTY', pdf: body.nightInDutyMin, computed: computed.nightInDuty, delta: 0, ok: false },
    { field: 'RECORDED F/T', pdf: body.recordedDutyTimeMin, computed: computed.flight, delta: 0, ok: false },
    { field: 'PILOT I/T', pdf: body.pilotITMin, computed: computed.instrument, delta: 0, ok: false },
    { field: 'T/O', pdf: body.takeoffs, computed: totalTakeoffsFromRows, delta: 0, ok: false },
    { field: 'L/D', pdf: body.landings, computed: totalLandingsFromRows, delta: 0, ok: false },
    { field: 'SIM CK&TRNG', pdf: body.simMin, computed: computed.simulator, delta: 0, ok: false },
  ];
  return checks.map(c => ({
    ...c,
    delta: c.computed - c.pdf,
    ok: c.computed === c.pdf,
  }));
}
