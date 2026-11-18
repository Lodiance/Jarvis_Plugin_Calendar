# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
calendar v0.3 已升到 plugin 規格 0.4（kit 0.4、manifest 加 `setup`、`setup(secrets)` 測連線），31 個測試和 `plugin:check` 都通過（0 錯誤）。已 commit、push。2026-11-18 第一次用安裝精靈裝到 nas，踩到幾個主程式的問題，之後已經把這次安裝**完整移除**，nas 是乾淨的，準備修完主程式後重裝。nas 上還沒有 Radicale。

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
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 要回 Jarvis repo 處理
- `jarvis-install-wizard-issues.md` 已經由使用者搬到 Jarvis repo（本 repo 已刪除）。
- `spec/jarvis-uninstall-requirements.md`：移除機制的需求（移除和徹底刪除兩段式、介面、不重建主程式、清 DB、CLI、驗收），Q1–Q4 都已經決定。使用者會手動同步過去；同步後就從本 repo 刪掉。

## 下次第一件事
在 Jarvis repo 依安裝精靈問題清單和移除需求修好之後，在 nas 部署 Radicale（加入 `jarvis-services`），再用精靈從零重裝 calendar，照文件最後的驗證步驟和 calendar 的測試清單測。nas 的 SSH 用 PuTTY 存的 `Home_NAS`（`plink`）；精靈建立的檔案擁有者是 root，要改檔案得透過 `docker exec jarvis-installer`。
