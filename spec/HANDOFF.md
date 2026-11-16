# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
已經接上 kit 0.3：handler 直接收到每次請求的 secrets，28 個測試全過，`plugin:check` 沒有錯誤。還沒在 nas 上對真的 Radicale 跑過，也還沒 commit。

## 改到哪
- `plugin.js`、`plugin.test.js`、`plugin-kit.js`（0.3 副本）、`manifest.json`（`spec: "0.3"`）：已改，還沒 commit。
- `spec/calendar-spec.md` 第 4 行還寫「尚未實作」，vault 副本也還沒同步（`/wiki-sync-check`，使用者手動複製）。

## 刻意留的洞（不是 bug,別急著修）
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。
- 0.3 新元件（`adaptive`、`agenda.bars/allday/strike`、`calendar.items/selected`、`grid` 比例、`dialog: "wide"`）還沒用。規格已經定了，現在可以做，但要先在 nas 上跑通基本功能。

## 真的壞掉的（是 bug）
- Jarvis 的 `plugin:check` 在 Windows 結束時印出 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`（libuv）。檢查結果本身正常，問題在主程式那邊。

## 當前假設（未驗證）
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 下次第一件事
把 calendar 裝到 nas，在 `#/dev/plugins` 填 `caldav_url/user/password`。用測試行事曆手動測新增、修改、刪除，再測先在 iPhone 改、然後從 Jarvis 改的情況（應該回 `412`）。跑通之後再接 0.3 的新元件（spec §5–§9）。
