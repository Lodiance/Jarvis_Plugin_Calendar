# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
calendar v0.3 已升到 plugin 規格 0.4（kit 0.4、manifest 加 `setup`、`setup(secrets)` 測連線），31 個測試和 `plugin:check` 都通過（0 錯誤）。已 commit、push；還沒在 nas 實裝。

## 改到哪
- 程式碼沒有進行到一半的改動。
- vault 的 spec 副本還沒同步（`/wiki-sync-check`，使用者手動複製）。Wiki 的 Jarvis 頁面也還停在 0.3。

## 刻意留的洞（不是 bug,別急著修）
- 0.3 新元件（`adaptive`、`agenda.bars/allday/strike`、`calendar.items/selected`、`grid` 比例、`dialog: "wide"`）還沒用。
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。

## 真的壞掉的（是 bug）
- Jarvis 的 `plugin:check` 在 Windows 結束時印出 libuv 的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`。檢查結果正常，問題在主程式那邊。

## 當前假設（未驗證）
- 主程式的 kit 和 checker 已經是 0.4，但 `plugin:check` 說「主程式只支援到 0.3」：推測只是主程式宣告支援的版本忘了改（nas 上已經有精靈）。
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 要回 Jarvis repo 處理
- `plugin-spec.md` 補一句：安裝精靈只支援公開 repo。私人 repo 會在 clone 時失敗，錯誤是 `could not read Username`（2026-11-18 實測）。
- 規劃 plugin market：讓其他使用者或合格的開發者上架自己的 plugin，其他人可以下載安裝，一樣只收公開 repo。設計（上架資格、審核、和精靈怎麼接）寫在 Jarvis 的 spec 或 ADR。
- 主程式支援的 spec 版本還是 0.3（見上一段），和 `plugin-spec.md` 0.4 對不上。
- 上面那個 `plugin:check` 的 libuv 斷言。

## 下次第一件事
nas 上已經有安裝精靈。本 repo 目前維持私人，所以精靈裝不了（只支援公開 repo）。要在 nas 實測（測試連線的欄位提示，以及新增、修改、刪除和 `412`），得先把 repo 改公開，或改用 `plugin.sh`，前提是 nas 上的 git 有 GitHub 帳號。
