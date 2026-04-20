# Pilot Logbook Pro

JALパイロット向けのフライトログブック管理アプリ（macOSデスクトップ）。

MFTR PDFから当月分を一括取り込み、ページ単位で編集・保存し、月次合計と累計時間をリアルタイムに集計します。

## 主な機能

- **MFTR PDF取込**：当月のフライトを自動でページに展開（PUSコードは自動でRMKSへ転記、夜間離着陸 `1N` は `N1` として保持）
- **ページ編集**：1ページ20行のJALフォーマットで手入力／編集
- **自動入力**：FO + 1/1 行で `FLT/PIC/JAL/PUS = ブロック時間` を自動セット
- **集計**：ページ合計／月合計／累計（基準時間からの加算）をリアルタイム計算
- **日付正規化**：`12/5` → `12.05` のように `MM.DD` へ自動整形
- **データ管理**：ページ削除 / 月一括削除 / 全データリセット（Danger Zone）
- **DB入出力**：SQLiteファイルのエクスポート / インポート / Finderで表示

## インストール（macOS）

1. [Releasesページ](https://github.com/__USER__/pilot-logbook/releases/latest)から `.dmg` をダウンロード
   - Apple Silicon Mac → `Pilot-Logbook-x.y.z-arm64.dmg`
   - Intel Mac → `Pilot-Logbook-x.y.z.dmg`
2. `.dmg`を開き、Pilot LogbookをApplicationsへドラッグ
3. 初回起動時は **右クリック → 開く**（コード署名なしのため）

## 使い方

1. **Cumulative Base** タブで累計の基準値（移行時点の合計）を入力
2. **NEW PAGE** で空ページを作成、または **MFTR取込** でPDFを読み込み
3. 行を編集して `Cmd+S` 等のフィールド離脱で自動保存
4. ページの **DELETE** や月の **DELETE MONTH** で過去データを整理可能

データはローカルSQLite（`~/Library/Application Support/pilot-logbook/logbook.db`）に保存されます。

## 開発

```bash
npm install
npm run dev      # Vite + Electron 開発起動
npm run dist     # macOS .dmg ビルド (release/ に出力)
```

### スタック

- Electron 41 + React 19 + TypeScript + Tailwind
- better-sqlite3（ローカル永続化）
- pdfjs-dist（MFTR PDFパース）

## ライセンス

Private. Personal use only.
