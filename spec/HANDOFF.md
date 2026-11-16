# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
calendar 已接上 kit 0.3，測試全過，已 push。使用者要的是「只用介面安裝 plugin」，這要主程式做規格 0.4；需求提案已寫在 `spec/jarvis-0.4-install-requirements.md`。

## 改到哪
- calendar 程式碼沒有進行到一半的改動。
- `spec/calendar-spec.md` 第 4 行還寫「尚未實作」，vault 副本也還沒同步（`/wiki-sync-check`，使用者手動複製）。

## 刻意留的洞（不是 bug,別急著修）
- 還沒有 manifest 的 `setup` 和 `setup(secrets)`：要等主程式 0.4 定案（需求 §6），不要先照提案寫。
- 0.3 新元件（`adaptive`、`agenda.bars/allday/strike`、`calendar.items/selected`、`grid` 比例、`dialog: "wide"`）還沒用。
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。

## 真的壞掉的（是 bug）
- Jarvis 的 `plugin:check` 在 Windows 結束時印出 libuv 的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`。檢查結果正常，問題在主程式那邊。

## 當前假設（未驗證）
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 要回 Jarvis repo 處理
- 把 `spec/jarvis-0.4-install-requirements.md` 帶過去：寫安裝器的 ADR（docker socket 不掛進主程式）、設計精靈、`setup` 欄位、kit 0.4。
- 上面那個 `plugin:check` 的 libuv 斷言。

## 下次第一件事
到 Jarvis repo，用需求文件設計 0.4。在那之前，如果想先確認 calendar 本身能用，就照舊用 `scripts/plugin.sh install` 在 nas 上裝一次，測新增、修改、刪除和 `412`。這兩件事互不阻擋。
