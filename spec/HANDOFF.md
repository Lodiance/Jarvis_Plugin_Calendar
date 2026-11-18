# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
calendar v0.3 已升到 plugin 規格 0.4（kit 0.4、manifest 加 `setup`、`setup(secrets)` 測連線），31 個測試和 `plugin:check` 都通過（0 錯誤）。已 commit、push。2026-11-18 在 nas 用精靈裝好了，容器 `jarvis-plugin-calendar` 在跑，但卡在 ⑤ 填祕密：**nas 上還沒有 Radicale**（沒有容器、沒有 systemd unit，5232 也沒人聽；`jarvis-services` 網路上只有 calendar）。

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
- 主程式的 kit 和 checker 已經是 0.4，但主程式（含 nas 上的 `#/dev/plugins`）宣告只支援 0.3。精靈的 ⑤ 只顯示祕密名稱，沒用到 manifest `setup` 的標籤、範例和 `notes`；推測主程式的精靈還沒實作 0.4 的 `setup`。⑥ 測試連線有沒有讀 `/health` 的 `setup` 還沒看到。
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 要回 Jarvis repo 處理
- `plugin-spec.md` 補一句：安裝精靈只支援公開 repo。私人 repo 會在 clone 時失敗，錯誤是 `could not read Username`（2026-11-18 實測）。
- 規劃 plugin market：讓其他使用者或合格的開發者上架自己的 plugin，其他人可以下載安裝，一樣只收公開 repo。設計（上架資格、審核、和精靈怎麼接）寫在 Jarvis 的 spec 或 ADR。
- 主程式支援的 spec 版本還是 0.3，精靈沒用到 `setup` 的標籤（見上一段），和 `plugin-spec.md` 0.4 對不上。
- 安裝時精靈卡在 ④ 建置：建 plugin 容器的同一刻，`jarvis` 主程式容器也被重建（兩者 StartedAt 都是 15:32:31Z），進度連線斷掉，再貼網址就提示「已安裝或正在安裝中」。plugin 其實已經裝好，按 ④ 旁的「繼續」就能接上。主程式容器不該被重建，或精靈要能自己恢復。
- 上面那個 `plugin:check` 的 libuv 斷言。

## 下次第一件事
先在 nas 部署 Radicale，並讓它加入 `jarvis-services`（spec §13 的先決條件；這是 nas 的工作，不在本 repo）。部署好之後回 `#/dev/plugins`，從 calendar 的 ⑤ 填祕密繼續，照測試清單測連線提示、新增、修改、刪除和 `412`。
