# 給 Jarvis repo：calendar 第一次用安裝精靈裝在 nas 上踩到的問題

來源：calendar plugin repo，2026-11-18。這次用 `#/dev/plugins` 的安裝精靈在 nas 上安裝
`https://github.com/Lodiance/Jarvis_Plugin_Calendar.git`（calendar v0.3.0，manifest `spec: "0.4"`，有 `setup`）。
以下是在 nas 上用 `docker`、log 和 DB 實際查到的情況。處理完、要重新安裝之前，nas 已經清乾淨了（見最後一節）。

## 1. 精靈卡在 ④ 建置；再貼網址會說「已安裝或正在安裝中」

- 實際上安裝**已經成功**：映像檔建好、`jarvis-plugin-calendar` 在跑，主程式 log 也有 `plugin calendar: running`。
  staging log 的最後一行是「→ 已安裝 calendar…」。
- 原因：`docker-compose.plugins.yml`（由 `plugin.sh` 產生）會把每個 plugin 的內部網路也接到 `jarvis` 服務上：
  ```yaml
  services:
    jarvis:
      networks: [default, plugin-calendar]
  ```
  所以裝一個新的 plugin，compose 就會**重建 `jarvis` 主程式容器**：`jarvis` 和 `jarvis-plugin-calendar` 的
  StartedAt 都是 15:32:31Z。瀏覽器和主程式之間的進度連線跟著斷掉，畫面就停在 ④。
  後來 `remove` 時 `jarvis` 又被重建了一次（拿掉網路也一樣）。
- DB 的 `plugin_installs` 留著 `step`，再貼一次網址就被它擋下來。按 ④ 旁的「繼續」可以接到 ⑤。
- 要修：
  - 安裝和移除不要重建主程式容器，例如改用 `docker network connect/disconnect jarvis <網路>`，compose 只負責管 plugin 自己的容器；
  - 或者讓精靈在主程式重啟後自己恢復：工作在背景完成時，由安裝器把 `step` 往前推，不要依賴瀏覽器的連線；重新整理頁面後自動接回進度。

## 2. 精靈還沒實作 0.4 的 `setup`；主程式宣告只支援 0.3

- `#/dev/plugins` 寫著「主程式支援 plugin spec 0.3」，`plugin:check` 也說「主程式只支援到 0.3」。
  但 `plugin-kit/plugin-kit.js` 的 `KIT_SPEC` 已經是 0.4，`plugin:check` 也已經會讀 `/health` 的 `setup`。
- ⑤ 填祕密只顯示 `caldav_url` 這種原始名稱，沒有用到 manifest 的 `setup.secrets.*.label/type/example/hint`，也沒有顯示 `setup.notes`。
  `caldav_password` 也沒有照 `type: "password"` 遮住輸入。
- 還沒驗證到（因為 nas 沒有 Radicale，走不到）：⑥ 測試連線有沒有讀 `/health` 的 `setup.ok/error/field` 並把焦點移到欄位；⑦ 有沒有用 `setup.settings` 呼叫 `calendar.settings`。
- 要修：照 `plugin-spec.md` §2、§3 實作；把主程式宣告支援的版本改成 0.4。

## 3. 介面上沒有「移除」

- `plugin-spec.md` 0.4 的變更紀錄說精靈有「檢查更新、回到上一版、移除」，但 calendar（狀態是安裝未完成）的卡片上只有「重新啟動」「停止」「繼續」。
  不確定是只有安裝未完成時才不顯示，還是根本還沒做。

## 4. `plugin.sh remove` 用 nas 的一般使用者跑會失敗，而且只做了一半

- 精靈透過 `jarvis-installer`（root）建立的檔案擁有者是 root：`plugins/calendar/`、`.staging/calendar/` 都是。
- 以 `user` 身分跑 `scripts/plugin.sh remove calendar`：**容器已經停掉刪除**，但接下來的 `mv` 被 `Permission denied` 擋下，
  資料夾和 compose 設定都還在，留下一個不一致的狀態。`unstage` 也一樣被擋。
- 這次改從安裝器容器裡跑才成功：`docker exec -w /home/user/app/jarvis jarvis-installer bash scripts/plugin.sh remove calendar`。
- 要修：安裝器建好檔案後 `chown` 給 nas 使用者；或者 `plugin.sh` 一開始就檢查權限，在做任何改動之前就失敗；或者文件寫明要透過安裝器容器跑。
  救援用的 CLI 不該做一半就停。

## 5. `remove` 不會清 DB

移除之後，`jarvis.db` 還留著：
- `plugins`：calendar 的權限核准（mail、weather 之前移除後，它們的核准也都還在，所以可能是刻意的）；
- `plugin_cards`：calendar 的卡片快取；
- `plugin_installs`：`step = 'secrets'` 的安裝紀錄（第 1 點提到會擋住重新安裝的就是它）；
- `idempotency_keys`：兩筆安裝請求；
- `activity`：一筆核准紀錄（稽核用，合理）。

要決定 `remove` 該清哪些，然後寫進規格。至少 `plugin_installs` 和 `plugin_cards` 應該要清。
核准紀錄要不要留，取決於「重新安裝時要不要重新確認權限」。

## 6. 只支援公開 repo

- 私人 repo 在 clone 時會失敗，錯誤是 `fatal: could not read Username for 'https://github.com': No such device or address`，精靈直接把它顯示出來。
- 要做：
  - `plugin-spec.md` 補一句「安裝精靈只支援公開 repo」；
  - 精靈把這個錯誤翻成看得懂的訊息，例如「repo 是私人的或網址錯誤，安裝精靈只支援公開 repo」。
- 之後要規劃 **plugin market**：讓其他使用者或合格的開發者上架自己的 plugin，其他人可以下載安裝，一樣只收公開 repo。
  上架資格、審核方式、和精靈怎麼接，寫成 ADR。

## 7. 其他

- `plugins/.staging/` 裡還有 2026-11-17 留下的 `.tmp-*` 資料夾 7 個，以及 mail 的 3 個 log，安裝器沒有清掉暫存。
- Windows 上 `npm run plugin:check` 結束時會印出 libuv 的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`（檢查結果本身正常）。
- calendar 要在 nas 上真的能用，還需要先部署 Radicale，並讓它加入 `jarvis-services`。目前 nas 上沒有 Radicale，這是 nas 的工作，不是主程式的 bug。

## 已經做的清理（2026-11-18，nas）

- `plugin.sh remove calendar`、`unstage calendar`（從 `jarvis-installer` 裡面跑）：容器、映像檔 `jarvis-plugin-calendar:local`、compose 設定、`plugins/calendar/`、`.staging/calendar/` 都已清除。
- 手動刪除：`plugins/.removed/calendar-20261118-155627`（`data/` 是空的）、`.staging/calendar-1795015950096.log`、Docker 網路 `jarvis_plugin-calendar`。
- DB：先備份成 `data/jarvis-before-calendar-cleanup.db`，再刪除 calendar 在 `plugins`、`plugin_cards`、`plugin_installs` 的列和那兩筆 `idempotency_keys`。`activity` 保留。
- 確認：`/api/plugins` 回 `[]`，`#/dev/plugins` 顯示「沒有 plugin」。
- 沒有動：`node` 基底映像檔（其他 plugin 也會用到）、mail/weather 的殘留、`jarvis-services` 網路。

## 修完之後怎麼驗證

1. 從精靈重新安裝 calendar：進度不應該停住，`jarvis` 容器不應該被重建（`docker inspect jarvis --format '{{.State.StartedAt}}'` 安裝前後一樣）。
2. ⑤ 要顯示 `setup` 的標籤、範例、提示和 notes，密碼欄的輸入要被遮住。
3. ⑥ 測試連線：還沒有 Radicale 時，應該顯示「無法連線 Radicale」並把焦點移到網址欄。部署 Radicale 之後，照 calendar 的測試清單繼續測。
4. 介面上移除 calendar：不留下檔案、容器、網路，`plugin_installs` 也要清掉，可以立刻重新安裝。
