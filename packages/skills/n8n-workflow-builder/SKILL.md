---
name: n8n-workflow-builder
description: Làm việc với workflow n8n — tạo mới, sửa, gỡ lỗi, chạy thử, kích hoạt, liệt kê. Chứa tên node, cấu trúc JSON và hình dạng tham số mà n8n đòi hỏi. Dùng cho MỌI yêu cầu có nhắc tới n8n hoặc workflow, kể cả khi chỉ là sửa một chi tiết nhỏ hay tìm hiểu vì sao một workflow chạy sai — ví dụ "tạo workflow", "sửa workflow", "workflow trả về rỗng", "workflow lỗi", "chạy thử workflow", "tự động hoá".
---

# n8n-workflow-builder

App này có bảy tool: `n8n_list_workflows`, `n8n_get_workflow`,
`n8n_validate_workflow`, `n8n_upsert_workflow`, `n8n_activate_workflow`,
`n8n_run_workflow`, `n8n_get_execution`. Không có tool nào tra cứu danh mục
node — tên node phải viết đúng ngay từ đầu, xem mục dưới.

## Quy trình

1. **Dựng workflow nhỏ nhất chạy được trước** — trigger cộng một hai node cốt
   lõi. Mở rộng dần bằng `n8n_upsert_workflow` kèm `workflowId`, mỗi lần thêm
   một việc.
2. `n8n_validate_workflow` trước mỗi lần upsert. Không tốn gì, bắt lỗi cấu
   trúc ngay.
3. `n8n_upsert_workflow` — **lưu lại `id` trả về** và dùng nó cho mọi thay đổi
   sau đó. Gọi lại mà không truyền `workflowId` sẽ tạo ra workflow thứ hai.
4. `n8n_activate_workflow` cần người dùng bấm duyệt, nên nó dừng chờ; workflow
   chưa active thì webhook trả 404.
5. `n8n_run_workflow` chạy workflow đã active và có node `webhook`. Đọc `body`
   trong kết quả để lấy đầu ra thật.
6. Trả về cho người dùng kèm link markdown mở workflow, lấy `editorUrl` trong
   kết quả upsert.

Khi workflow chạy xong nhưng kết quả sai hoặc rỗng: `n8n_get_workflow` rồi đối
chiếu `parameters` của từng node với mục "Tham số hay cần" bên dưới, sửa đúng
chỗ lệch. Kết quả rỗng gần như luôn là một khoá viết sai trong `parameters` —
n8n bỏ qua khoá lạ và vẫn báo thành công. Đổi `responseMode` hay thêm node
`respondToWebhook` không chữa được việc đó.

## Viết node cho đúng

`type` là tên kỹ thuật có tiền tố `n8n-nodes-base.`, **không phải tên hiển thị
trên giao diện n8n**. Các node thường dùng, kèm `typeVersion` nên đặt:

`webhook` 2 · `manualTrigger` 1 · `scheduleTrigger` 1.2 · `set` 3.4 (giao diện
gọi là "Edit Fields") · `code` 2 · `httpRequest` 4.2 · `if` 2.2 · `switch` 3.2
· `filter` 2.2 · `merge` 3.1 · `splitInBatches` 3 (giao diện gọi là "Loop Over
Items") · `respondToWebhook` 1.4 · `wait` 1.1 · `noOp` 1 · `executeWorkflow` 1.2

Node nào không nằm trong danh sách này thì hỏi người dùng tên chính xác hoặc
dùng `httpRequest` gọi thẳng API của dịch vụ đó.

## Cấu trúc workflow

```json
{
  "name": "ten-workflow",
  "nodes": [
    { "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
      "position": [0, 0],
      "parameters": { "httpMethod": "POST", "path": "ten-workflow", "responseMode": "lastNode" } },
    { "id": "2", "name": "Set", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
      "position": [220, 0],
      "parameters": { "assignments": { "assignments": [
        { "id": "1", "name": "ket_qua", "value": "xong", "type": "string" } ] } } }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "Set", "type": "main", "index": 0 }]] } },
  "settings": {}
}
```

- `position` là cặp `[x, y]`; cách nhau 220px cho dễ đọc trên giao diện.
- `connections` khoá theo **`name`** của node. `main` là mảng-của-mảng:
  `main[0]` là output thứ nhất. `if` có hai output (true, false), `switch` có
  nhiều. Node cuối không xuất hiện trong `connections`.
- `id` của workflow chỉ truyền qua tham số `workflowId`, không đặt trong JSON;
  `name`, `nodes`, `connections`, `settings` thì luôn phải có, kể cả khi sửa.

## Tham số hay cần

- **`webhook`** — dữ liệu người gọi gửi lên nằm trong `$json.body`, không phải
  ngay trong `$json`: với payload `{"so_luong": 3}` thì viết
  `={{ $json.body.so_luong }}`. Cùng item còn có `headers`, `query`, `params`.
  `responseMode` chỉ nhận đúng ba giá trị — `"onReceived"` chỉ báo đã nhận,
  `"lastNode"` trả output của node cuối, `"responseNode"` trả theo một node
  `respondToWebhook`. Mặc định dùng `"lastNode"`: nó đơn giản nhất và đủ cho
  hầu hết việc. Chỉ thêm node `respondToWebhook` khi đã đặt
  `"responseMode": "responseNode"`, và ngược lại.
- **`set`** — `parameters.assignments.assignments` là mảng
  `{ id, name, value, type }`; khoá lồng bên trong tên đúng là `assignments`,
  viết khác đi thì node chạy xong mà không sinh ra trường nào và không báo lỗi.
- **`code`** — `jsCode` phải `return` mảng `[{ json: {...} }]`, đọc input bằng
  `$input.all()`. Viết ngắn gọn, tránh template literal nhiều dòng có dấu
  tiếng Việt. **Không có `fetch`/network access bên trong Code** — gọi sẽ báo
  lỗi `fetch is not defined`. Mọi lời gọi HTTP ra ngoài phải dùng node
  `httpRequest` riêng, không gọi trong Code.
- **`httpRequest` — header `Authorization`/API key** — đây là chỗ hay bị kẹt
  nhất. `parameters.authentication` chỉ nhận đúng ba giá trị:
  `"none"`, `"predefinedCredentialType"`, `"genericCredentialType"` — KHÔNG
  bao giờ đặt thẳng `"headerAuth"` hay tên loại credential vào đó, n8n báo lỗi
  `The value "..." is not supported!` ngay. Hai giá trị
  `predefinedCredentialType`/`genericCredentialType` đều đòi một credential đã
  **lưu sẵn thật sự** trong n8n (xác nhận trong chính source node:
  `this.getCredentials('httpHeaderAuth', ...)` ném lỗi nếu không có) — app này
  hiện **chưa có tool tạo credential**, nên đặt `genericCredentialType` +
  `genericAuthType: "httpHeaderAuth"` mà không tạo credential trước sẽ luôn
  báo `Authorization failed - please check your credentials`, sửa lại kiểu gì
  cũng vậy vì gốc là thiếu credential chứ không phải sai cú pháp.
  Cách chạy được ngay không cần credential: đặt `authentication: "none"`, bật
  `sendHeaders: true`, `specifyHeaders: "keypair"`, rồi điền thẳng header vào
  `headerParameters.parameters`:
  ```json
  "parameters": {
    "method": "POST",
    "url": "https://api.example.com/v1/chat",
    "authentication": "none",
    "sendHeaders": true,
    "specifyHeaders": "keypair",
    "headerParameters": { "parameters": [
      { "name": "Authorization", "value": "Bearer sk-xxxx" },
      { "name": "Content-Type", "value": "application/json" }
    ] },
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ model: \"gpt-4\", input: $json.body.text }) }}"
  }
  ```
  n8n tự cảnh báo cách này không an toàn (token nằm thẳng trong workflow JSON,
  lộ ra nếu export) — đây là đánh đổi chấp nhận được cho tới khi có tool tạo
  credential riêng; không tự ý chuyển sang `genericCredentialType` nếu chưa có
  credential thật đứng sau nó.
- **`if` / `filter` / `switch`** — điều kiện dạng
  `{ "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
  "conditions": [{ "leftValue": "={{ $json.x }}", "rightValue": "y",
  "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" }`.
  Đặt vào `parameters.conditions`, riêng `switch` đặt vào
  `parameters.rules.values[N].conditions`.

Biểu thức n8n viết dạng `"={{ $json.ten_truong }}"` — thiếu dấu `=` mở đầu thì
n8n hiểu là chuỗi văn bản thường.
