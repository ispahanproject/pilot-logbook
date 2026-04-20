// PDF → `pdftotext -layout` 相当のテキスト抽出
// pdfjs-dist (pure JS) を使い、ローテーション済みPDFでも正しく再構築する。
//
// MFTR PDF は page.rotate === 90 (時計回り90°) で、
// PDF 座標 → 表示座標は:
//   display_x = pdf_y  (transform[5])   ... 横 (列)
//   display_y = pdf_x  (transform[4])   ... 縦 (行)
//
// 文字は Courier 等幅 6pt/char を想定。

import fs from 'fs';

// pdfjs-dist は ESM (.mjs) なので CommonJS main から動的 import する
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfjsPromise = (new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')()) as Promise<PdfJsModule>;
  }
  return pdfjsPromise;
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export async function extractLayoutText(pdfPath: string): Promise<string> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const rotate = page.rotate || 0;
    const content = await page.getTextContent();
    const rawItems = content.items as RawItem[];

    type DispItem = { dx: number; dy: number; w: number; str: string };
    const items: DispItem[] = [];
    for (const it of rawItems) {
      if (!it.str) continue;
      const px = it.transform[4];
      const py = it.transform[5];
      let dx: number, dy: number;
      if (rotate === 90) {
        dx = py;
        dy = px;
      } else if (rotate === 270) {
        dx = -py;
        dy = -px;
      } else if (rotate === 180) {
        dx = -px;
        dy = py;
      } else {
        dx = px;
        dy = -py;
      }
      items.push({ dx, dy, w: it.width, str: it.str });
    }

    // dy (行) グループ化
    const yTolerance = 3;
    const rows: { y: number; items: DispItem[] }[] = [];
    for (const item of items) {
      let row = rows.find(r => Math.abs(r.y - item.dy) <= yTolerance);
      if (!row) {
        row = { y: item.dy, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }
    rows.sort((a, b) => a.y - b.y);

    // 文字幅の中央値 (Courier なら 6.0 固定になるはず)
    const widths: number[] = [];
    for (const item of items) {
      if (item.str.length > 0 && item.w > 0) {
        widths.push(item.w / item.str.length);
      }
    }
    widths.sort((a, b) => a - b);
    const charWidth = widths.length > 0 ? widths[Math.floor(widths.length * 0.5)] : 6;

    let minX = Infinity;
    for (const item of items) minX = Math.min(minX, item.dx);
    if (!isFinite(minX)) minX = 0;

    for (const row of rows) {
      row.items.sort((a, b) => a.dx - b.dx);
      let line = '';
      for (const item of row.items) {
        const col = Math.round((item.dx - minX) / charWidth);
        while (line.length < col) line += ' ';
        if (item.str.trim() === '') continue;
        line += item.str;
      }
      allLines.push(line.trimEnd());
    }
    allLines.push('');
  }

  return allLines.join('\n');
}
