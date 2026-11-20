# calendar

## 知識來源分流

- **spec**：讀本地 `spec/`。`C:/Users/mouse/Desktop/Jordan_Data/Personal/Main_Vault/Dev/calendar/` 裡的同名 spec 是給 wiki 用的
  副本，開發時**不要**讀它。
- **背景知識、設計沿革、跨專案概念**：只讀 `C:/Users/mouse/Desktop/Jordan_Data/Personal/Main_Vault/Wiki/`。先讀 `Wiki/index.md`
  定位頁面，再讀單頁，不要對 Wiki 目錄做 Glob 掃描。
- **不要讀 vault 根目錄下 `Wiki/` 以外的任何資料夾** —— 那些是 wiki 的 raw 素材，
  對開發沒有用，只會浪費 context。
- **vault 唯讀**。wiki 由使用者手動維護，agent 一律不寫入。
- wiki 內容與本地 `spec/` 衝突時，**以本地 spec/ 為準**，並主動指出衝突。
- **Jarvis repo**（`F:/Workspace/Dev/Jarvis/Dashboard`）：
  只讀 `spec/plugin-spec.md` 和 `#/dev/components`（主程式 `npm run dev` 後的
  `http://127.0.0.1:3000/#/dev/components`）；Jarvis repo 的其他檔案一律不讀。
  文件不夠用時記進 HANDOFF，回 Jarvis repo 處理。

## Session 接續

- 開場時 hook 會注入 `spec/HANDOFF.md` 的**摘要**、程式碼裡的 `WIP(` 錨點與 git 狀態。
  那段輸出進的是模型 context，不會顯示在終端機上。
- **不要「修好」HANDOFF 標為「刻意留的洞」的東西**，那是刻意的中間狀態。
- **不要重試 HANDOFF 標為「這次試過、行不通」的做法**。
- 改到一半要暫停時，在程式碼留 `// WIP(YYYY-MM-DD): 說明` 錨點，並執行 `/handoff`。
