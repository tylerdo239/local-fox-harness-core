---
name: n8n-workflow-builder
description: Xây dựng hoặc sửa workflow n8n qua các tool n8n_* — tra bảng node có sẵn thay vì đoán tên node, và tiết kiệm context để tránh lỗi tràn context window (CONTEXT_WINDOW_EXCEEDED). Dùng khi được yêu cầu tạo, sửa, hoặc mở rộng 1 workflow tự động hoá trong n8n.
---

# n8n-workflow-builder

App này có ĐÚNG 7 tool n8n, không có tool nào khác:

| Tool | Tham số |
| --- | --- |
| `n8n_list_workflows` | (không có) |
| `n8n_get_workflow` | `workflowId` |
| `n8n_validate_workflow` | `workflow` |
| `n8n_upsert_workflow` | `workflow`, `workflowId` (bỏ trống = tạo mới) |
| `n8n_activate_workflow` | `workflowId` — **cần người duyệt**, sẽ dừng chờ |
| `n8n_run_workflow` | `workflowId`, `payload` |
| `n8n_get_execution` | `executionId` |

**Không có tool nào để tra cứu node.** Không có `search_nodes`, `get_node_types`,
`list_credentials`, `get_workflow_sdk_reference`, `create_workflow_from_code`.
Gọi chúng sẽ lỗi. Tên node phải lấy từ bảng dưới đây.

## Bảng tra node — đừng đoán tên

Đo trực tiếp từ `n8n-nodes-base` 2.39.6 trong container ngày 2026-09-20.
`type` **luôn** có tiền tố `n8n-nodes-base.` và là tên kỹ thuật, **không phải
tên hiển thị trên UI**. Đây là cái bẫy đã gây lỗi thật: UI ghi "Edit Fields"
nên model viết `n8n-nodes-base.editFields` → `Unrecognized node type`. Tên đúng
là `n8n-nodes-base.set`.

| Việc cần làm | `type` (bỏ tiền tố `n8n-nodes-base.`) | Tên trên UI | `typeVersion` mới nhất |
| --- | --- | --- | --- |
| Nhận HTTP request (trigger) | `webhook` | Webhook | 2.1 |
| Chạy tay để thử | `manualTrigger` | Manual Trigger | 1 |
| Chạy theo lịch | `scheduleTrigger` | Schedule Trigger | 1.4 |
| Gán / đổi tên trường | `set` | **Edit Fields (Set)** | 3.5 |
| Viết JavaScript | `code` | Code | 2 |
| Gọi API ngoài | `httpRequest` | HTTP Request | 4.5 |
| Rẽ 2 nhánh đúng/sai | `if` | If | 2.3 |
| Rẽ nhiều nhánh | `switch` | Switch | 3.4 |
| Lọc bỏ item | `filter` | Filter | 2.3 |
| Gộp 2 luồng | `merge` | Merge | 3.2 |
| Lặp theo lô | `splitInBatches` | Loop Over Items | 3 |
| Trả HTTP response tuỳ ý | `respondToWebhook` | Respond to Webhook | 1.5 |
| Chờ | `wait` | Wait | 1.1 |
| Không làm gì | `noOp` | No Operation | 1 |
| Gọi workflow khác | `executeWorkflow` | Execute Sub-workflow | 1.3 |

Những tên node **KHÔNG tồn tại** (đã bị model bịa ra trong lúc test):
`editFields`, `return`, `function`, `setNode`.

## Khung workflow đúng

Đây là workflow đã chạy thật và trả về kết quả (`{"ket_qua":"chay duoc"}`,
HTTP 200) — copy khung này rồi sửa, đừng viết lại từ đầu:

```json
{
  "name": "ten-workflow",
  "nodes": [
    {
      "id": "1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "parameters": { "httpMethod": "POST", "path": "ten-workflow", "responseMode": "lastNode" }
    },
    {
      "id": "2",
      "name": "Set",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [220, 0],
      "parameters": {
        "assignments": { "assignment": [{ "id": "1", "name": "ket_qua", "value": "chay duoc" }] }
      }
    },
    {
      "id": "3",
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 0],
      "parameters": { "jsCode": "return [{ json: { ket_qua: 'chay duoc' } }];" }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Set", "type": "main", "index": 0 }]] },
    "Set": { "main": [[{ "node": "Code", "type": "main", "index": 0 }]] }
  },
  "settings": {}
}
```

Luật của khung này:

- `position` **bắt buộc** là mảng 2 số `[x, y]`. Thiếu 1 số → lỗi
  `nodes[N].position must be a [x, y] pair`. Cách xa nhau 220px cho dễ nhìn.
- `connections` khoá theo **`name` của node**, không phải `id`. `main` là
  mảng-của-mảng: `main[0]` là output thứ nhất. Node `if` có 2 output
  (`main[0]` = true, `main[1]` = false), node `switch` có nhiều output.
- Node cuối cùng không xuất hiện trong `connections`.
- **Không đưa `id` của workflow vào trong object `workflow`** — n8n trả lỗi
  `request/body/id is read-only`. Muốn sửa workflow cũ thì truyền id qua tham
  số `workflowId` của `n8n_upsert_workflow`.

## Tham số của các node hay dùng

**`webhook`** — `httpMethod`: `GET|POST|PUT|PATCH|DELETE|HEAD`. `path`: chuỗi,
là phần cuối của URL. `responseMode`:

- `onReceived` (mặc định) — trả ngay `{"message":"Workflow was started"}`,
  **không** trả kết quả tính toán.
- `lastNode` — trả output của node cuối. Đây là cái bạn muốn khi cần xem kết quả.
- `responseNode` — cần có thêm node `respondToWebhook`. Nếu đặt node
  `respondToWebhook` mà `responseMode` không phải `responseNode`, n8n báo
  `Unused Respond to Webhook node found in the workflow`.

**`set`** — `assignments.assignment` là mảng `{id, name, value}`. Thêm
`"type": "string"` (hoặc `number`, `boolean`, `object`, `array`) nếu muốn ép kiểu.

**`code`** — `jsCode` là chuỗi JavaScript, phải `return` một mảng
`[{ json: {...} }]`. Đọc input bằng `$input.all()`. Muốn Python thì thêm
`"language": "pythonNative"` và dùng `pythonCode` thay cho `jsCode`.

**`if` / `filter` / `switch`** — điều kiện dùng chung một hình dạng:

```json
{
  "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
  "conditions": [
    {
      "leftValue": "={{ $json.trang_thai }}",
      "rightValue": "ok",
      "operator": { "type": "string", "operation": "equals" }
    }
  ],
  "combinator": "and"
}
```

Đặt object này vào `parameters.conditions` (với `if`/`filter`), hoặc vào
`parameters.rules.values[N].conditions` (với `switch`).

**`httpRequest`** — `method`, `url`. Muốn gửi body thì bật `sendBody: true`;
muốn gửi header thì `sendHeaders: true`.

Biểu thức n8n viết dạng `"={{ $json.ten_truong }}"` — dấu `=` mở đầu là bắt buộc,
thiếu nó thì n8n hiểu là chuỗi văn bản thường.

## Thứ tự làm việc

1. `n8n_validate_workflow` **trước** mỗi lần `n8n_upsert_workflow`. Validate
   không tốn gì và bắt được lỗi cấu trúc ngay.
2. `n8n_upsert_workflow` → **lưu lại `id` trả về**.
3. `n8n_activate_workflow` — tool này **dừng lại chờ người duyệt**. Đó là hành
   vi đúng, không phải treo. Nếu không thấy trả về, người dùng chưa bấm duyệt.
4. `n8n_run_workflow` chỉ chạy được workflow **đã active** và **có node
   `webhook`**. n8n không có endpoint chạy workflow chung; tool này đọc `path`
   của node webhook rồi POST thẳng vào đó.
5. `n8n_get_execution` hiện **không dùng được sau khi chạy**: `n8n_run_workflow`
   không trả về `executionId` và không có tool liệt kê execution. Muốn xem kết
   quả thì đặt `responseMode: lastNode` và đọc `body` mà `n8n_run_workflow` trả về.

## Kỷ luật để không vỡ context

Mỗi lần gọi tool n8n trả về nguyên JSON workflow, rất dài. Đã gặp lỗi
`CONTEXT_WINDOW_EXCEEDED` thật khi xây workflow nhiều node.

1. **Tạo workflow đơn giản trước** (trigger + 1–2 node), chạy thử, rồi mở rộng
   dần bằng `n8n_upsert_workflow` kèm `workflowId`.
2. **Không bao giờ gọi `n8n_upsert_workflow` thiếu `workflowId` hai lần cho cùng
   một workflow.** Lỗi thật: model quên id đã trả về nên gọi tạo lần hai → n8n
   tạo ra 2 workflow trùng nhau vì nó không chặn trùng tên. (Tool này có tự dò
   trùng theo tên trong cùng session làm lưới an toàn — nhưng tự nhớ id vẫn
   đúng và nhanh hơn.)
3. **Không gọi lại `n8n_get_workflow` cho workflow mình vừa upsert** — nội dung
   chính là cái mình vừa gửi đi.
4. Nếu lỡ vỡ context: đừng tra cứu lại từ đầu, tóm tắt bằng lời những gì đã biết
   rồi đi thẳng vào bước tiếp theo.
5. **Code trong `jsCode` viết ngắn, không comment dài.** Tránh template literal
   nhiều dòng chứa tiếng Việt có dấu — đã gặp lỗi thật "Unterminated string
   constant". Cần chuỗi dài thì đặt vào một biến trên một dòng.

## Trả lời người dùng

Sau khi tạo/sửa thành công, **luôn đưa link mở workflow dưới dạng markdown link**
(vd `[Mở workflow trong n8n](<url>)`), lấy đúng `editorUrl` trong kết quả
`n8n_upsert_workflow` — đừng chỉ dán JSON thô.
