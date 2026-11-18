# 給 Jarvis repo：plugin 移除（uninstall）機制需求

來源：calendar plugin repo，2026-11-19。這是需求提案，給 Jarvis repo 設計和實作用，定案後寫進 `plugin-spec.md` 和 ADR。
起因：2026-11-18 第一次用安裝精靈在 nas 上裝 calendar，要移除重裝時發現：介面上沒有「移除」；`plugin.sh remove`
用 nas 的一般使用者跑會做到一半就停；`remove` 不清 DB，留下的 `plugin_installs` 會擋住重新安裝；
而且安裝和移除都會重建 `jarvis` 主程式容器。細節見 `jarvis-install-wizard-issues.md`。

## 1. 目標

- 只用介面就能移除 plugin，不用 SSH，也不用手動改 DB。
- 移除要**完整**：做完之後，主程式、Docker、檔案系統、DB 都看不出這個 plugin 裝過，只留稽核紀錄。可以立刻用同一個 `id` 重新安裝。
- 預設可以後悔：先「移除」（保留資料），確定不要再「徹底刪除」。
- 任何一步失敗都不會留下半套狀態；重做一次會從斷掉的地方接著做。
- 移除過程不重建、不重啟主程式容器。

非目標：
- **不加 plugin 端的 uninstall 回呼**。plugin 的狀態只能放在自己的 `data/`（plugin-spec §1），主程式刪掉 `data/` 就夠了。
  calendar 也不需要：它在外部沒有留任何東西，Radicale 上的行程是使用者自己的資料，不該跟著刪。
  等真的出現一個在外部有登記東西（例如 webhook）的 plugin 再加。
- 不開放給模型：移除不是工具，模型不能呼叫，只有 `#/dev/plugins` 的人能做。

## 2. 兩段式：移除 和 徹底刪除

| | 移除（remove） | 徹底刪除（purge） |
|---|---|---|
| 容器、內部網路、compose 設定 | 刪 | 刪 |
| 映像檔（含 `.prev` 留給 rollback 的舊版） | 刪 | 刪 |
| `plugins/<id>/` 的程式 | 搬到 `.removed/<id>-<時間>/` | 刪 |
| `plugins/<id>/data/` | 跟著程式搬到 `.removed/` | 刪 |
| `.staging/<id>`、這個 id 的安裝 log | 刪 | 刪 |
| DB：`plugin_installs`、`plugin_cards`、這個 plugin 的 `idempotency_keys` | 刪 | 刪 |
| DB：權限核准 `plugins` | 刪（重裝要重新確認權限） | 刪 |
| DB：祕密 `plugin_secrets` | **保留**（重裝不用再填） | 刪 |
| 儀表板版面上這個 plugin 的卡片 | 拿掉 | 拿掉 |
| DB：`activity` | 保留，加一筆 `remove`／`purge` | 保留，加一筆 |

- 權限核准在「移除」時也要刪。理由：重新安裝可能拿到不同版本，權限要重新給人看一次（ADR 0008 的確認規則）。
  mail 和 weather 移除後留下的核准紀錄，要一併清掉。（待決 Q1）
- 祕密在「移除」時保留，是為了「移除再重裝」不用重填帳密；「徹底刪除」才清掉。
- 一個 plugin 在 `.removed/` 裡有任何一份副本時，`#/dev/plugins` 都要列出來，提供「還原」和「徹底刪除」兩個按鈕。
- 還在安裝中、還沒裝好的 plugin（`plugin_installs` 有紀錄，例如這次卡在 ④ 的 calendar），按鈕叫「取消安裝」，做法等同徹底刪除。
  使用者沒填過祕密，也沒有資料要留。

## 3. 介面（`#/dev/plugins`）

- 每個 plugin 都有「移除」，**包括安裝未完成、停止中、啟動失敗、等確認權限的 plugin**。
- 按下後跳出確認框，列出這次會刪掉什麼（版本、`data/` 的大小、有沒有祕密），以及「資料會保留在 `.removed/`，之後可以還原或徹底刪除」。
- 徹底刪除要多一步確認：輸入 plugin 的 `id` 才能按。（單人平台，但 `data/` 刪了救不回來；nas 的整機備份只是每次手動插硬碟時才會跑）
- 進度和安裝精靈一樣，分步驟顯示。主程式重新整理或重啟之後，進度要接得回來（§4）。
- 失敗時顯示是哪一步、錯誤訊息，以及「重試」按鈕。

## 4. 執行方式

- 和安裝一樣，交給 `jarvis-installer` 做；主程式仍然不掛 Docker socket。
- 用 `plugin_installs`（`kind: 'remove' | 'purge'`）記錄進度，每一步做完就更新 `step`。
  安裝器在背景把工作做完，**不依賴瀏覽器的連線**；頁面打開時從 `plugin_installs` 讀出目前的進度。
- 每一步都要冪等：東西已經不在也算成功。順序如下：
  1. 停掉並刪除容器；
  2. 主程式斷開這個 plugin 的內部網路（`docker network disconnect`，**不要**重產 compose 再 `up`，那樣會重建 `jarvis`），然後刪除網路；
  3. 重產 `docker-compose.plugins.yml`，只會影響 plugin 的服務，不能動到 `jarvis`；
  4. 刪除映像檔，包含 `.prev`；
  5. 處理檔案：remove 是搬到 `.removed/`，purge 是刪除；`.staging/<id>` 和 log 都刪；
  6. 清 DB（§2 的表）；最後在同一個交易裡刪掉這筆 `plugin_installs`，並寫入 `activity`。
- 檔案擁有者：安裝器建立的檔案要 `chown` 給 nas 的使用者（`user`），`plugin.sh` 也要能用一般使用者跑。
  做不到時，`plugin.sh` 要在**動任何東西之前**就檢查權限並失敗，不能像這次做到一半才停。
- 安裝也要套用第 2 步的做法：接上網路用 `docker network connect`，不要重建 `jarvis`。

## 5. 還原（restore）

- 從 `.removed/<id>-<時間>/` 搬回 `plugins/<id>/`，重新建映像檔、啟動容器。
- 權限要重新確認，因為移除時已經刪了核准（§2）；祕密還在的話直接沿用。
- 同一個 `id` 已經裝了另一份時，不能還原，要先移除現有的那一份。

## 6. CLI（救援用，`scripts/plugin.sh`）

- `remove <id>`：等同介面的「移除」，DB 也要一起清（目前只處理檔案和容器）。
- `purge <id>`：新增，等同「徹底刪除」。也要能處理只在 `.removed/` 裡、或只在 `.staging/` 裡的情況。
- `restore <id> [時間]`：新增。
- 和介面共用同一套步驟和 `plugin_installs` 紀錄，任一邊開始做的，另一邊都看得到、也能接著做。

## 7. 對 plugin 規格的影響

- manifest、端點、kit 都不用改，plugin 不用升 `spec`。只改主程式的行為，以及 `plugin-spec.md` §8 第 5 點「發佈」和變更紀錄。
- `plugin-spec.md` 要補一句：plugin 在 `data/` 以外不要留任何狀態，否則移除時清不到。（§1 已經有類似的話，在移除這段再強調一次）

## 8. 驗收

在 nas 上用 calendar 測：
1. 用精靈安裝，再按「移除」：
   - `docker ps -a`、`docker images`、`docker network ls` 都找不到 calendar；
   - `plugins/` 只剩 `.removed/calendar-*`；
   - DB 只留祕密和 `activity`；
   - `jarvis` 的 `StartedAt` 沒有變。
2. 馬上用精靈重裝：不會出現「已安裝或正在安裝中」；要重新確認權限；不用重填祕密。
3. 「還原」`.removed/` 裡的那一份：`data/settings.json` 回來了（例如卡片天數設成 5 還在）。
4. 「徹底刪除」：`.removed/` 也清空，祕密被刪，重裝時要重填。
5. 安裝卡在半路時（例如建置中重新整理頁面）按「取消安裝」：完全清乾淨。
6. 移除做到一半時重啟 `jarvis-installer`：重新打開頁面能看到卡在哪一步，按重試可以完成。
7. 用 `user` 身分跑 `plugin.sh remove`／`purge`：成功，或者在動手之前就失敗並說明原因。

## 9. 待決

- Q1：「移除」要不要刪權限核准？提案是要刪（§2）。若想讓「移除再裝回同一版」不用重新確認，可以改成保留，但重裝時一律重新比對 manifest。
- Q2：`.removed/` 要不要定期自動清（例如 30 天）？還是只能手動徹底刪除？
- Q3：徹底刪除前，要不要自動把 `data/` 打包一份到 `data/backups/`？
- Q4：儀表板版面上的卡片位置，在「移除」時要拿掉，還是留著，等還原時放回原位？
