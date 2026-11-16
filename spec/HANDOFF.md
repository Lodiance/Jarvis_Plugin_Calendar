# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。

## 狀態：專案結構與主規格已完成
spec/、CLAUDE.md 已建好並 push，主規格 `spec/calendar-spec.md` v0.1 設計定案，程式碼還是 `plugin:new` 產生的範例（筆記卡片）。

## 下次第一件事
開始 v0.1 中不依賴主程式 0.3 的部分（spec §13）：CalDAV 讀取（`PROPFIND` 列行事曆、`REPORT calendar-query` + `expand`）和 VEVENT 解析，先用 `node:http` 架假伺服器寫 `node:test` 測試（全天、跨日、重複展開、§5 各狀態、時區）。

## 地雷
- `plugin-kit.js` 是 `KIT_SPEC 0.2`，還不會解析 `x-plugin-secrets`；`adaptive`、`agenda bars`、`dialog: "wide"` 也還沒有。主程式 0.3 完成前不要接這些，卡片用 `fallback`。
- 0.3 欄位名稱以 Jarvis repo 的 `spec/plugin-spec.md` 為準，和本地 spec 不同時回頭改本地 spec。
