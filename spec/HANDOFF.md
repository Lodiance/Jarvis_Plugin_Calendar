# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
v0.1（只讀）在本 repo 能做的都做完了，測試全過。正式能用要等主程式的 plugin 規格 0.3；下一段是 v0.2 寫入。

## 改到哪
- `plugin.js` 最後的 `WIP(2026-11-16)`：祕密 getter 固定回 `{}`，等 kit 0.3。

## 刻意留的洞（不是 bug,別急著修）
- 祕密 getter 是空的：kit 0.2 的 handler 拿不到請求標頭。真的跑起來卡片永遠顯示「尚未設定」，`plugin:check` 的工具範例會失敗。不要用環境變數繞過（使用者要 nas 正式安裝）。
- 沒有 `adaptive`、`dialog: "wide"`、`grid` 比例、「＋ 新增」按鈕：前三個 `plugin-spec.md` 還沒定格式，新增是 v0.2。
- 沒讀 `settings.json`（§4 屬於 v0.2）：時區先取行事曆的時區，沒有的話用 `Europe/London`；天數固定 3。

## 當前假設（未驗證）
- kit 0.3 會把祕密當參數交給 handler，形狀未知；`app(getSecrets)` 是為了到時候只改一行。
- 0.3 欄位名以 Jarvis 的 `spec/plugin-spec.md` 為準，和本地 spec 不同時回頭改本地 spec。
- 畫面還沒在主程式驗證過（`#/dev/components` 或 `plugin:check`）。

## 要回 Jarvis repo 處理
- plugin 規格 0.3：祕密標頭和 kit，以及新元件。
- `network: true` 的 plugin 容器自動接上 `jarvis-services` 網路（`decisions/0001`）。
- 全域的模型選擇，以及每個 plugin 一個「允許 AI 使用」開關（spec §10）。

## 下次第一件事
開始 v0.2（spec §2 寫入、§4、§9、§10）：
1. `caldav.js` 加 `GET`/`PUT`/`DELETE`，帶 ETag，`412` 回 notice。
2. 產生 VEVENT，修改時保留沒動到的屬性。
3. 再做 `calendar.form`/`create`/`update`/`delete`/`settings`。

假 Radicale 測試先寫 `412` 和「重複行程拒絕」。
