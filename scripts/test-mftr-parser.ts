// Phase 1 パーサー検証スクリプト
// 使い方: npx tsx scripts/test-mftr-parser.ts [layout-file]
//   引数省略時は /tmp/mftr_layout.txt を読む
//
// 実行前に: pdftotext -layout <MFTR.pdf> /tmp/mftr_layout.txt

import fs from 'fs';
import {
  parseMftrLayout,
  computeTotalsFromFlights,
  validateAgainstFooter,
  validateAgainstBodyTotal,
  mftrFlightToRow,
} from '../src/lib/mftrParser';

const pathArg = process.argv[2] || '/tmp/mftr_layout.txt';
const text = fs.readFileSync(pathArg, 'utf-8');

console.log(`\n=== MFTR Parse: ${pathArg} ===\n`);

const r = parseMftrLayout(text);

console.log('ヘッダー:');
console.log(`  月:   ${r.year}-${r.month} (${r.monthLabel})`);
console.log(`  氏名: ${r.pilotName}`);
console.log(`  社員: ${r.empNo}`);
console.log(`  POST: ${r.post}`);
console.log();

console.log(`フライト行 (${r.flights.length}件):`);
for (const f of r.flights) {
  const day = String(f.day).padStart(2, ' ');
  const flt = f.fltNo.padEnd(8);
  const tag = f.isDeadhead ? '[DH]' : f.isSim ? '[SIM]' : '    ';
  const code = (f.recordedCode || f.dutyCode).padEnd(4);
  const block = fm(f.blockTimeMin).padStart(5);
  const rec = fm(f.recordedDutyTimeMin).padStart(5);
  const nt = fm(f.pilotNTMin).padStart(5);
  const it = fm(f.pilotITMin).padStart(4);
  const to = String(f.takeoffs || '').padStart(1) + (f.takeoffsNight ? 'N' : ' ');
  const ld = String(f.landings || '').padStart(1) + (f.landingsNight ? 'N' : ' ');
  const sim = f.simMin ? fm(f.simMin) : '';
  console.log(
    `  ${day} ${flt} ${f.fromTo.padEnd(8)} ${f.ship.padEnd(5)} ${tag} ${code} ` +
    `blk=${block} rec=${rec} nt=${nt} it=${it} T/O=${to} L/D=${ld} sim=${sim}`
  );
}
console.log();

console.log(`警告 (${r.warnings.length}件):`);
for (const w of r.warnings) console.log(`  ⚠️  ${w}`);
console.log();

// 自前集計
const computed = computeTotalsFromFlights(r.flights);
const totalTO = r.flights.reduce((s, f) => s + f.takeoffs, 0);
const totalLD = r.flights.reduce((s, f) => s + f.landings, 0);

console.log('自前集計 (from flights):');
console.log(`  FLIGHT     = ${fm(computed.flight)}  (実飛行のrecorded_duty_time)`);
console.log(`  PUS        = ${fm(computed.pus)}`);
console.log(`  PUS N/T    = ${fm(computed.pusNT)}`);
console.log(`  CO         = ${fm(computed.co)}`);
console.log(`  CO N/T     = ${fm(computed.coNT)}`);
console.log(`  INSTRUMENT = ${fm(computed.instrument)}`);
console.log(`  SIM        = ${fm(computed.simulator)}`);
console.log(`  T/O        = ${totalTO}`);
console.log(`  L/D        = ${totalLD}`);
console.log(`  BLOCK (incl DH) = ${fm(computed.blockTimeInclDeadhead)}`);
console.log();

// body TOTAL vs 自前集計
console.log('検証 ① body TOTAL 行 vs 自前集計:');
if (!r.bodyTotals) {
  console.log('  ❌ body TOTAL 行が見つかりません');
} else {
  const diffs = validateAgainstBodyTotal(computed, totalTO, totalLD, r.bodyTotals);
  for (const d of diffs) {
    const mark = d.ok ? '✅' : '❌';
    const pdfStr = d.field === 'T/O' || d.field === 'L/D' ? String(d.pdf) : fm(d.pdf);
    const compStr = d.field === 'T/O' || d.field === 'L/D' ? String(d.computed) : fm(d.computed);
    console.log(`  ${mark} ${d.field.padEnd(22)} PDF=${pdfStr.padStart(8)}  計算=${compStr.padStart(8)}  差=${d.delta}`);
  }
}
console.log();

// footer THIS MONTH vs 自前集計
console.log('検証 ② footer THIS MONTH 行 vs 自前集計:');
if (!r.monthTotals) {
  console.log('  ❌ THIS MONTH 行が見つかりません');
} else {
  const diffs = validateAgainstFooter(computed, r.monthTotals);
  for (const d of diffs) {
    const mark = d.ok ? '✅' : '❌';
    console.log(`  ${mark} ${d.field.padEnd(10)} PDF=${fm(d.pdf).padStart(8)}  計算=${fm(d.computed).padStart(8)}  差=${d.delta}`);
  }
}
console.log();

// app Row 変換サンプル
console.log('アプリ Row 変換サンプル (最初の5行):');
const realFlights = r.flights.filter(f => !f.isDeadhead);
for (let i = 0; i < Math.min(5, realFlights.length); i++) {
  const f = realFlights[i];
  const row = mftrFlightToRow(f);
  console.log(`  [${i}] date=${row.date} flt=${row.flightNo} ${row.route} reg=${row.reg} to=${row.to} ld=${row.ldg} tot=${row.total} pic=${row.pic} sic=${row.sic} picNT=${row.picNT} night=${row.night} imc=${row.imc} sim=${row.sim}`);
}

console.log();

function fm(m: number): string {
  if (!m) return '0:00';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${mm.toString().padStart(2, '0')}`;
}
