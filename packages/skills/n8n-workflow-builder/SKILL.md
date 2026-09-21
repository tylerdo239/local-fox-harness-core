---
name: n8n-workflow-builder
description: Làm việc với workflow n8n — tạo mới, sửa, gỡ lỗi, chạy thử, kích hoạt, liệt kê. Chứa tên node, cấu trúc JSON và hình dạng tham số mà n8n đòi hỏi. Dùng cho MỌI yêu cầu có nhắc tới n8n hoặc workflow, kể cả khi chỉ là sửa một chi tiết nhỏ hay tìm hiểu vì sao một workflow chạy sai — ví dụ "tạo workflow", "sửa workflow", "workflow trả về rỗng", "workflow lỗi", "chạy thử workflow", "tự động hoá".
---

# n8n-workflow-builder

App này có tám tool: `n8n_describe_node`, `n8n_list_workflows`,
`n8n_get_workflow`, `n8n_validate_workflow`, `n8n_upsert_workflow`,
`n8n_activate_workflow`, `n8n_run_workflow`, `n8n_get_execution`.

`n8n_describe_node(type, typeVersion?)` tra thẳng vào một kho dữ liệu trích
xuất từ chính n8n-nodes-base thật (440+ node, mọi field/enum/điều kiện
`displayOptions`, kèm `builderHint` — gợi ý cấu hình do chính n8n viết sẵn
cho từng node khi có) — không phải đoán hay nhớ. Dùng nó bất cứ khi nào cần
1 node KHÔNG nằm trong danh sách quen thuộc bên dưới, hoặc khi n8n báo lỗi
validate mà mục "Tham số hay cần" chưa giải thích được. Danh sách dưới đây
chỉ là các node hay gặp nhất và những lỗi cụ thể đã từng thấy — không phải
toàn bộ kiến thức n8n có; đừng dừng lại ở nó khi `n8n_describe_node` trả lời
được câu hỏi trực tiếp hơn.

## Quy trình

1. **Dựng workflow nhỏ nhất chạy được trước** — trigger cộng một hai node cốt
   lõi. Mở rộng dần bằng `n8n_upsert_workflow` kèm `workflowId`, mỗi lần thêm
   một việc.
2. `n8n_validate_workflow` trước mỗi lần upsert. Không tốn gì, bắt lỗi cấu
   trúc ngay.
3. `n8n_upsert_workflow` — **lưu lại `id` trả về và LUÔN truyền lại nó ở mọi
   lần sửa tiếp theo trong cùng cuộc trò chuyện, kể cả khi đổi cấu trúc lớn**
   (thêm trigger khác, đổi tên node, viết lại gần như toàn bộ nodes/
   connections). Đổi cấu trúc lớn vẫn là SỬA cùng một workflow, không phải
   tạo workflow mới — đừng viết lại `workflow` từ đầu với một cái `name`
   mới chỉ vì cách tiếp cận thay đổi. Gọi lại mà không truyền `workflowId`
   khi cuộc trò chuyện đã từng tạo/sửa một workflow sẽ bị TỪ CHỐI (lỗi liệt
   kê rõ id/tên đã có) — đây là chặn thật, không phải gợi ý, vì việc quên
   truyền `workflowId` mỗi khi đổi cấu trúc là nguyên nhân thật đã gây ra
   nhiều workflow trùng lặp. Nếu người dùng thật sự muốn thêm một workflow
   thứ hai, độc lập trong cùng cuộc trò chuyện thì mới truyền
   `confirmNewWorkflow: true`.
4. `n8n_activate_workflow` cần người dùng bấm duyệt, nên nó dừng chờ; workflow
   chưa active thì webhook trả 404.
5. `n8n_run_workflow` chạy workflow đã active và có node `webhook`. Đọc `body`
   trong kết quả để lấy đầu ra thật.
6. Trả lời người dùng bằng ĐÚNG NGUYÊN VĂN `editorUrl` lấy từ kết quả
   `n8n_upsert_workflow` — không tự ghép, đoán, hay bịa bất kỳ URL nào khác
   (webhook hay dạng nào khác) để thay thế nó. Lỗi thật đã gặp: model tự
   "tính" ra một "Webhook URL" bằng cách ghép `http://127.0.0.1:5678/webhook/`
   với `path` của node `respondToWebhook`, dù workflow đó trigger bằng
   `gmailTrigger` (polling) chứ không có node `webhook` nào cả — link đưa ra
   sai hoàn toàn, không ai gọi được. Chỉ nhắc tới URL webhook khi workflow
   THẬT SỰ có node trigger kiểu `webhook` (kiểm tra bằng `n8n_get_workflow`
   nếu không chắc) và dùng đúng `path` đọc được từ chính node đó — không
   đoán, không suy luận từ node khác.
   **Được hỏi lại về link ở một câu hỏi RIÊNG, không ngay sau khi tạo/sửa**
   (kết quả `n8n_upsert_workflow` cũ có thể đã trôi khỏi ngữ cảnh) — gọi
   `n8n_get_workflow(workflowId)` hoặc `n8n_list_workflows()` rồi lấy
   `editorUrl` từ đó, cả hai đều trả kèm trường này. Lỗi thật đã gặp khi
   không làm vậy: model không nhớ `editorUrl` cũ, tự hỏi ngược lại người
   dùng "bạn dùng n8n version nào", đưa ra placeholder kiểu
   `https://<n8n-instance-url>/workflow/<id>`, rồi cuối cùng BỊA HẲN một
   domain không có thật (`https://n8n.fpt.com.vn/workflow/<id>`) và khẳng
   định chắc nịch link đó dùng được. Tuyệt đối không làm vậy — nếu vì lý do
   gì đó không gọi được `n8n_get_workflow`/`n8n_list_workflows`, nói rõ
   "chưa lấy được link, để tôi kiểm tra lại" thay vì đưa ra bất kỳ URL nào
   không lấy trực tiếp từ tool.

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

Node nào không nằm trong danh sách này thì gọi `n8n_describe_node("tên-node")`
để lấy đúng tên kỹ thuật, `typeVersion`, và tham số — đừng đoán, đừng hỏi
người dùng trước khi tra. Không tìm thấy trong catalog thì mới hỏi người
dùng tên chính xác hoặc dùng `httpRequest` gọi thẳng API của dịch vụ đó.

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
  hầu hết việc. Chỉ thêm node `respondToWebhook` khi workflow có node trigger
  **kiểu `webhook` thật sự** và đã đặt `"responseMode": "responseNode"` trên
  chính node đó — không thêm `respondToWebhook` vào workflow trigger bằng
  `gmailTrigger`/`scheduleTrigger`/`manualTrigger`/bất kỳ trigger nào khác:
  không có request HTTP nào đang chờ phản hồi cả, node đó tồn tại vô nghĩa và
  dễ khiến model sau đó tự bịa ra một "webhook URL" không có thật (lỗi thật
  đã gặp, xem mục "Quy trình" bước 6).
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
