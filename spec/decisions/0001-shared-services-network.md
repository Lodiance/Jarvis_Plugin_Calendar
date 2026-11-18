# 0001 — nas 上用共用的 `jarvis-services` 網路連 Radicale

日期：2026-11-16　狀態：採用；「服務由使用者自己部署」那一段提案由 `0002-services-deployed-by-jarvis.md` 取代（2026-11-19）

## 問題

nas 上的 calendar plugin 容器要連到同一台 nas 上的 Radicale（spec §14 原本的待決事項）。Radicale 只在 tailnet 開放。

## 決定

- 主程式**改一次**：所有 `network: true` 的 plugin 容器自動接上一個固定的 Docker 網路 `jarvis-services`。
- 使用者想讓 plugin 連到哪個自架服務，就在**那個服務自己的 compose** 加入 `jarvis-services`，再到 `#/dev/plugins` 把網址填進祕密。
- calendar：Radicale 加入 `jarvis-services`，`caldav_url` 填 `http://radicale:5232/<user>/`。

## 原則

分三層，各管各的：

- 主框架：少數**通用能力**（`network`、`secrets`、`wiki`、`DATA_DIR`），做一次所有 plugin 共用。
- plugin：在 manifest 宣告要哪些能力，不寫部署細節。
- 使用者：填跟自己環境有關的值。

一個值「換一台 nas 就會不一樣」，它就是使用者的設定，不進 manifest，也不改主框架。只有出現一種**新的能力**時才升主程式的 plugin 規格版本。

## 不採用

- **manifest 宣告要接哪些網路**（例如 `"networks": ["radicale-net"]`）：網路名稱是部署細節，plugin 開發者不會知道；每多一種需求就要主框架配合。
- **`host-gateway`（透過 nas 本機端口）**：一樣只改一次，但每個服務都要在 nas 本機開端口，這時才真的會有端口衝突。
- **走 tailnet 網址**：容器能不能走到 nas 自己的 tailscale 介面要看安裝方式，不可靠。

## 代價

- 任何 `network: true` 的 plugin 都連得到這個網路上的每個服務。`network: true` 本來就代表能連到外面，這和它的意思一致；不想給 plugin 碰的服務就不要加入這個網路。
- 端口衝突不用檢查：每個容器有自己的 IP，服務也不需要開端口到 nas 本機。要擋的只有 `network_mode: host`，主程式不應該支援它。
- 之後的 Ollama 可以用同一個方式接上（`http://ollama:11434`）。
