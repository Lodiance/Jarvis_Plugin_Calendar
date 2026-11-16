# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
v0.1 和 v0.2 在本 repo 能做的都做完了，對假 Radicale 的測試全過。正式能用要等主程式的 plugin 規格 0.3 和 `jarvis-services` 網路。

## 改到哪
- `plugin.js` 最後的 `WIP(2026-11-16)`：祕密 getter 固定回 `{}`，等 kit 0.3。
- `spec/calendar-spec.md` 改過，vault 副本還沒同步（`/wiki-sync-check`，使用者手動複製）。

## 刻意留的洞（不是 bug,別急著修）
- 祕密 getter 是空的：真的跑起來卡片永遠顯示「尚未設定」，`plugin:check` 的工具範例會失敗。不要用環境變數繞過（使用者要 nas 正式安裝）。
- 沒有 `adaptive`、`dialog: "wide"`、`grid` 比例：`plugin-spec.md` 還沒定格式。
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。

## 當前假設（未驗證）
- kit 0.3 會把祕密當參數交給 handler，形狀未知；`app(getSecrets)` 讓那時只改一行。
- 0.3 欄位名以 Jarvis 的 `spec/plugin-spec.md` 為準，不同時回頭改本地 spec。
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。

## 要回 Jarvis repo 處理
- plugin 規格 0.3：祕密標頭和 kit，以及新元件。
- `network: true` 的 plugin 容器自動接上 `jarvis-services` 網路（`decisions/0001`）。
- 全域的模型選擇，以及每個 plugin 一個「允許 AI 使用」開關（spec §10）。

## 下次第一件事
到 Jarvis repo 做 plugin 規格 0.3。回來後：複製新的 `plugin-kit.js`、換掉 WIP 的 getter，用 nas 上的測試行事曆手動測新增、修改、刪除，以及先在 iPhone 改、再從 Jarvis 改（`412`）。
