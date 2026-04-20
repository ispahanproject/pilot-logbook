// pdfjs-dist から取ったテキストアイテムを `pdftotext -layout` 相当に再構築するテスト
// 使い方: npx tsx scripts/test-pdfjs-layout.ts <pdf-path>
//
// 注意: MFTR の PDF は page.rotate === 90 (時計回り90度)。
// PDF 座標 → 表示座標への変換:
//   display_x = pdf_y  (transform[5])   ... 横方向 (列)
//   display_y = pdf_x  (transform[4])   ... 縦方向 (行)
// width は既に表示空間での横幅。

import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

async function extractLayoutText(pdfPath: string): Promise<string> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  // @ts-expect-error - legacy build types are loose
  const pdf = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;

  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const rotate = page.rotate || 0;
    const content = await page.getTextContent();
    const rawItems = content.items as TextItem[];

    // rotate=90 (時計回り): display_x = pdf_y, display_y = pdf_x
    // rotate=0: display_x = pdf_x, display_y = -pdf_y (PDF は y-up なので反転)
    type RIt = { dx: number; dy: number; w: number; str: string };
    const items: RIt[] = [];
    for (const it of rawItems) {
      if (!it.str) continue;
      const pdfX = it.transform[4];
      const pdfY = it.transform[5];
      let dx: number, dy: number;
      if (rotate === 90) {
        dx = pdfY;
        dy = pdfX;
      } else if (rotate === 270) {
        dx = -pdfY;
        dy = -pdfX;
      } else if (rotate === 180) {
        dx = -pdfX;
        dy = pdfY;
      } else {
        dx = pdfX;
        dy = -pdfY;
      }
      items.push({ dx, dy, w: it.width, str: it.str });
    }

    // dy (行位置) でグループ化
    const yTolerance = 3;
    const rows: { y: number; items: RIt[] }[] = [];
    for (const item of items) {
      let row = rows.find(r => Math.abs(r.y - item.dy) <= yTolerance);
      if (!row) {
        row = { y: item.dy, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }
    // 行を dy 昇順 (上から下) にソート
    rows.sort((a, b) => a.y - b.y);

    // 文字幅を推定 (中央値)
    const widths: number[] = [];
    for (const item of items) {
      if (item.str.length > 0 && item.w > 0) {
        widths.push(item.w / item.str.length);
      }
    }
    widths.sort((a, b) => a - b);
    const charWidth = widths.length > 0 ? widths[Math.floor(widths.length * 0.5)] : 6;

    // dx の最小値 (左余白)
    let minX = Infinity;
    for (const item of items) minX = Math.min(minX, item.dx);

    // 各行を再構築
    for (const row of rows) {
      row.items.sort((a, b) => a.dx - b.dx);
      let line = '';
      for (const item of row.items) {
        const col = Math.round((item.dx - minX) / charWidth);
        while (line.length < col) line += ' ';
        // 空白のみの item は既に line のスペースに含まれるのでスキップ
        if (item.str.trim() === '') continue;
        line += item.str;
      }
      allLines.push(line.trimEnd());
    }
    allLines.push('');
  }

  return allLines.join('\n');
}

const pdfPath = process.argv[2] || '/Users/KENTARO/Documents/MFTR_00053856_202602.pdf';
extractLayoutText(pdfPath).then(text => {
  console.log(text);
}).catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
