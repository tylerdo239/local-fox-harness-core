# Patch cookbook — sửa hành vi Cordis Agent Core mà không rebuild image

Tài liệu vận hành (operator-facing), không phải architecture doc. Xem
`docs/cordis-agent-implementation-plan.md` §7 cho lý do thiết kế; ở đây chỉ có "làm thế
nào", với mọi ví dụ đã chạy thật trên một profile test cô lập trước khi ghi vào đây.

## Có đúng MỘT file cần sửa

```
data/harness/profiles/cordis-app/cordis.patch.yml
```

(đường dẫn trên host, tương ứng `$DSH_HOME/profiles/cordis-app/cordis.patch.yml` bên trong
container — bind mount trong `deploy/docker-compose.yml`). Đây là tầng **Home/profile**:
sửa từ host, `docker compose restart core`, có hiệu lực trong vài giây, **không rebuild
image, không mất lịch sử chat**.

Đừng nhầm với `packages/bundle-core/cordis.patch.yml` trong repo — đó là tầng
**bundle/rebuild**, chỉ đổi khi sửa code và build lại image (dùng cho composition cố định
của sản phẩm, ví dụ danh sách UI row bị tắt ở §3). File ở `data/harness/...` mới là chỗ
operator/người vận hành sửa hàng ngày.

## Quy trình 3 bước

1. **Xem config hiện tại** để lấy đúng `id`/`name`/`config` của row muốn sửa:
   ```sh
   docker compose -f deploy/docker-compose.yml exec core \
     node_modules/.bin/dsh --profile cordis-app --dump-config
   ```
   (hoặc chạy `dsh --profile cordis-app --dump-config` trực tiếp nếu đang dev local, không
   qua Docker). Copy đúng khối `id`/`name`/`config` của row cần đổi.

2. **Sửa `cordis.patch.yml`** trên host, thêm một entry:
   ```yaml
   - id: <id đã copy ở bước 1>
     name: '<name đã copy ở bước 1>'
     config:
       # ... TOÀN BỘ field muốn giữ, không chỉ field muốn đổi ...
     disabled: false   # hoặc bỏ dòng này nếu không muốn tắt row
   ```
   **Patch THAY TOÀN BỘ config của row theo `id` — không deep-merge.** Nếu row gốc có 5
   field config mà patch chỉ ghi 1 field, 4 field còn lại **biến mất** (về giá trị mặc định
   của schema, không phải giữ nguyên). Luôn copy nguyên khối `config` từ `--dump-config` rồi
   sửa đúng field cần đổi, không viết tay từ đầu.

3. **Restart** để patch có hiệu lực (`patchReload: startup` trong profile package.json —
   nghĩa là đọc lại patch lúc KHỞI ĐỘNG, không hot-reload giữa chừng process đang chạy):
   ```sh
   docker compose -f deploy/docker-compose.yml restart core
   ```
   Xác nhận lại bằng `--dump-config`: dòng `# == <bundle>, patched by
   <đường dẫn cordis.patch.yml>` xuất hiện ngay trên row vừa sửa — bằng chứng patch đã áp
   dụng, không phải đoán.

## Cạm bẫy đã xác nhận thật: file rỗng làm boot FAIL

Một file `cordis.patch.yml` **0 byte hoặc chỉ có comment** làm dsh từ chối boot ngay từ đầu
— đã test thật:

```
Error: dsh: overlay .../cordis.patch.yml must be a top-level YAML array of loader patch entries
```

Muốn nói "không patch gì" thì file phải là:
```yaml
[]
```
Entrypoint (`deploy/entrypoint.sh`) chỉ tạo file này **một lần** nếu chưa tồn tại — không
bao giờ ghi đè lại, nên chỉnh sửa của operator luôn sống sót qua restart lẫn qua nâng cấp
image (§10 — bump version `@deepseek-ai/dsh-*` không đụng gì tới `data/harness/`).

## Ví dụ 1 — Tắt một row (tool/plugin)

Tắt export session log ra file (ví dụ, không có ý nghĩa vận hành đặc biệt — chỉ minh hoạ
cơ chế `disabled`):

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
  disabled: true
```

`docker compose restart core` → `--dump-config` cho `session-log-download` giờ có
`disabled: true` và dòng `patched by` provenance. Row khác không đổi.

## Ví dụ 2 — Đổi model mặc định ở tầng composition (khác Phase 4's runtime UI)

Phase 4 (`docs/cordis-agent-implementation-plan.md` §6) đã có `GET`/`POST /api/v1/model`
đổi model mặc định **lúc chạy, không restart**, ghi qua `ctx.settings` (`settings.yaml`).
Patch ở đây là con đường KHÁC, tầng thấp hơn — hữu ích khi muốn ấn định cứng default cho cả
deployment (ví dụ deploy lần đầu, chưa ai chỉnh gì qua UI):

```yaml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-pro
```

Đã test thật: `GET /api/v1/model` sau restart trả đúng `deepseek-v4-pro` — **không đụng gì
tới `settings.yaml`** (hai tầng độc lập: settings user layer, khi có, ghi đè LÊN TRÊN giá
trị composition này — patch chỉ đổi cái composition làm nền).

## Ví dụ 3 — Thêm một provider OpenAI-compatible tuỳ chỉnh

`llm-pi-ai` hỗ trợ route tuỳ chỉnh (self-hosted, gateway riêng) qua `config.providers`:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      my-vllm:
        displayName: My vLLM server
        api: openai-completions
        baseURL: https://vllm.internal:8000/v1
        apiKeyEnv: MY_VLLM_API_KEY
        models:
          - id: my-model
            contextWindow: 131072
```

`apiKeyEnv` chỉ là TÊN biến — giá trị thật set qua `POST /api/v1/credentials` (Phase 4,
không bao giờ nằm trong `cordis.patch.yml`, tránh secret lọt vào file cấu hình đồng bộ/chia
sẻ được). Sau patch + restart, route `my-vllm` xuất hiện trong
`GET /api/v1/model-providers` để chọn qua UI Settings.

## Ví dụ 4 — Bật tích hợp n8n (Phase 6)

`cordis-n8n` (`packages/tool/n8n/src/index.ts` — đợt tái cấu trúc 2026-09-16 đã tách nó thành
package riêng `@cordis-app/tool-n8n`, không còn nằm trong `bundle-core` nữa) không nằm sẵn
trong composition — `config.baseURL` là bắt buộc nên phải insert kèm config hợp lệ, không thể
bật bằng cách gỡ `disabled`. Cần **HAI** row, không phải một — thiếu `webhook-runtime` boot
fail thật với `waiting for service: webhookRuntime` (đã xác nhận):

```yaml
- insert:
    - id: webhook-runtime
      name: '@deepseek-ai/dsh-webhook'
    - id: cordis-n8n
      name: '@cordis-app/tool-n8n'
      config:
        baseURL: http://n8n:5678   # tên service trong docker-compose.yml — KHÔNG phải
                                    # 127.0.0.1 (đó chỉ đúng nếu gọi từ host hoặc từ trong
                                    # chính container n8n)
        editorBaseURL: http://127.0.0.1:5678   # origin THẬT trình duyệt mở được — khác baseURL
                                                 # ở trên vì đó là tên DNS nội bộ compose, trình
                                                 # duyệt không resolve được. Dùng để build nút
                                                 # "Go to n8n" trên tab Automations (mỗi workflow
                                                 # trả về kèm editorUrl = editorBaseURL + /workflow/<id>).
        apiKeyEnv: N8N_API_KEY
        webhookPath: /api/v1/hooks/n8n
        webhookSecretEnv: N8N_WEBHOOK_SECRET
        webhookSource: primary-n8n
        routes:
          <workflow-id-thật-trong-n8n>:
            workspacePath: /workspace/n8n-triggered
            title: 'Triggered by n8n: <tên workflow>'
            agentPreset: standard
            permissionPreset: workspace-write
```

Sau patch + `docker compose restart core`:
1. Set `N8N_API_KEY` (tạo trong n8n: Settings → API) và `N8N_WEBHOOK_SECRET` (tự chọn một
   chuỗi bí mật, workflow n8n gọi vào phải gửi đúng chuỗi này qua header
   `x-n8n-webhook-secret`) qua `POST /api/v1/credentials` — **không bao giờ** đặt secret
   trực tiếp trong `cordis.patch.yml`.
   **Scope của API key — xác nhận thật, dính lỗi 403 khi thiếu:** phải có cả
   `tag:list` (KHÔNG chỉ `tag:read` — 2 scope khác nhau trong n8n, `GET /tags` cần đúng
   `tag:list`) và `workflowTags:update`/`workflowTags:list`, ngoài bộ cơ bản
   `workflow:create/read/update/list/activate/deactivate` + `tag:create/read/update` +
   `execution:read/list`. Thiếu `tag:list` → workflow VẪN được tạo thành công trên n8n
   (không mất gì) nhưng bước gắn tag `agent-generated` sau đó ném lỗi "Forbidden" thật,
   khiến `n8n_upsert_workflow` báo `isError: true` dù workflow đã tồn tại — kiểm tra lại
   bằng `n8n_list_workflows` trước khi gọi lại `n8n_upsert_workflow` (không có `workflowId`
   sẽ tạo trùng thêm 1 bản).
2. **Bắt buộc, dễ quên nhất — đã tự dính lỗi này khi test thật:** mỗi `workspacePath` khai
   ở trên phải là một thư mục **ĐÃ TỒN TẠI SẴN** trước khi workflow đó trigger lần đầu:
   ```sh
   docker compose -f deploy/docker-compose.yml exec core mkdir -p /workspace/n8n-triggered
   ```
   `WebhookSessionRequest.workspacePath` đi thẳng vào `fs.realpath()` phía
   `@deepseek-ai/dsh-workspace` — một đường dẫn chưa tồn tại ném `ENOENT` ngay, session
   không được tạo (`POST /api/v1/hooks/n8n` vẫn trả `202` bình thường — đó là tầng HTTP
   fire-and-forget, không phản ánh việc tạo session có thành công hay không). README của
   `dsh-webhook` viết "resolves or creates the canonical Workspace" — chữ "creates" ở đó
   chỉ nói tới bản ghi Workspace, không phải tự `mkdir`.
3. Trong workflow n8n, dùng node **HTTP Request** (không phải Webhook — Webhook node là để
   NHẬN, không phải GỌI ra ngoài) POST tới `http://core:3080/api/v1/hooks/n8n` (tên service
   `core`, cổng nội bộ 3080, không phải cổng publish) với header
   `x-n8n-webhook-secret: <chuỗi đã set>` và body JSON có field `workflowId` khớp đúng key
   trong `config.routes` ở trên.

## Definition of Done (đã xác nhận thật, không phải giả lập)

- Sửa patch tắt một row (Ví dụ 1) từ host + `docker compose restart core` → hiệu lực xác
  nhận qua `--dump-config`, không rebuild image.
- Session tạo TRƯỚC lần restart đó vẫn đọc lại đúng qua `GET /api/v1/session-events` SAU
  restart — lịch sử chat không mất (append-only log nằm trong `DSH_HOME/sessions/`, khác
  hẳn thư mục `profiles/` mà patch nằm trong).
- File patch rỗng thật sự (`printf '' > cordis.patch.yml`) làm `--dump-config` thoát với
  lỗi rõ ràng ngay lập tức, không boot "âm thầm bỏ qua patch".
- Ví dụ 4 (n8n) đã chạy thật qua `docker compose up` với cả hai service `core`+`n8n`: gọi
  `http://n8n:5678` từ container `core` qua DNS nội bộ compose thành công; thiếu
  `webhook-runtime` row → boot fail đúng như ghi; thiếu `mkdir -p workspacePath` trước →
  webhook trả `202` nhưng không tạo session, tạo thư mục rồi trigger lại → session tạo
  đúng, đọc lại đúng `cwd`/prompt/preset qua `GET /api/v1/session-events`.
