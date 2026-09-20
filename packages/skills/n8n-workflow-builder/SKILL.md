---
name: n8n-workflow-builder
description: Tạo, sửa và chạy thử workflow tự động hoá trong n8n qua các tool n8n_* — dựng JSON đúng cấu trúc, chạy thử lấy kết quả thật, rồi trả link mở workflow. Dùng khi người dùng cần một luồng tự động trong n8n, ví dụ "tạo workflow", "tự động hoá", "nối webhook với ...".
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
      "parameters": { "assignments": { "assignment": [
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
- `id` của workflow chỉ truyền qua tham số `workflowId`, không đặt trong JSON.

## Tham số hay cần

- **`webhook`** — `responseMode` quyết định người gọi nhận được gì:
  `onReceived` chỉ báo đã nhận, `lastNode` trả output của node cuối (dùng cái
  này khi cần xem kết quả), `responseNode` trả theo node `respondToWebhook` —
  và chỉ khi đó mới được đặt node `respondToWebhook`.
- **`code`** — `jsCode` phải `return` mảng `[{ json: {...} }]`, đọc input bằng
  `$input.all()`. Viết ngắn gọn, tránh template literal nhiều dòng có dấu
  tiếng Việt.
- **`if` / `filter` / `switch`** — điều kiện dạng
  `{ "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
  "conditions": [{ "leftValue": "={{ $json.x }}", "rightValue": "y",
  "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" }`.
  Đặt vào `parameters.conditions`, riêng `switch` đặt vào
  `parameters.rules.values[N].conditions`.

Biểu thức n8n viết dạng `"={{ $json.ten_truong }}"` — thiếu dấu `=` mở đầu thì
n8n hiểu là chuỗi văn bản thường.
