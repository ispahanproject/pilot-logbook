// Electron main の mftrPdf.ts を renderer の mftrParser.ts に食わせる
// エンドツーエンドのテスト (Electronプロセスなしで実行)
// 使い方: npx tsx scripts/test-e2e-pdf-parse.ts [pdf-path]

import { extractLayoutText } from '../electron/mftrPdf';
import {
  parseMftrLayout,
  computeTotalsFromFlights,
  validateAgainstFooter,
  validateAgainstBodyTotal,
} from '../src/lib/mftrParser';

async function main() {
  const pdfPath = process.argv[2] || '/Users/KENTARO/Documents/MFTR_00053856_202602.pdf';
  console.log(`\n=== E2E test: ${pdfPath} ===\n`);

  const t0 = Date.now();
  const rawText = await extractLayoutText(pdfPath);
  console.log(`PDF 抽出: ${Date.now() - t0}ms, ${rawText.length} 文字`);

  const parsed = parseMftrLayout(rawText);
  console.log(`パース: ${parsed.year}-${parsed.month} ${parsed.pilotName}`);
  console.log(`フライト件数: ${parsed.flights.length} (warnings: ${parsed.warnings.length})`);

  const computed = computeTotalsFromFlights(parsed.flights);
  const totalTO = parsed.flights.reduce((s, f) => s + f.takeoffs, 0);
  const totalLD = parsed.flights.reduce((s, f) => s + f.landings, 0);

  console.log('\n--- body TOTAL 検証 ---');
  const bodyChecks = validateAgainstBodyTotal(computed, totalTO, totalLD, parsed.bodyTotals);
  for (const c of bodyChecks) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.field.padEnd(22)} PDF=${c.pdf}  計算=${c.computed}  差=${c.delta}`);
  }

  console.log('\n--- footer THIS MONTH 検証 ---');
  const footerChecks = validateAgainstFooter(computed, parsed.monthTotals);
  for (const c of footerChecks) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.field.padEnd(10)} PDF=${c.pdf}  計算=${c.computed}  差=${c.delta}`);
  }

  const allOk = bodyChecks.every(c => c.ok) && footerChecks.every(c => c.ok);
  console.log(`\n総合: ${allOk ? '✅ すべての検証にパス' : '❌ 検証に失敗あり'}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
