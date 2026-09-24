---
name: n8n-workflow-builder
description: Làm việc với workflow n8n — tạo mới, sửa, gỡ lỗi, chạy thử, kích hoạt, liệt kê. Chứa tên node, cấu trúc JSON và hình dạng tham số mà n8n đòi hỏi. Dùng cho MỌI yêu cầu có nhắc tới n8n hoặc workflow, kể cả khi chỉ là sửa một chi tiết nhỏ hay tìm hiểu vì sao một workflow chạy sai — ví dụ "tạo workflow", "sửa workflow", "workflow trả về rỗng", "workflow lỗi", "chạy thử workflow", "tự động hoá".
---

# n8n-workflow-builder

App này có mười tool: `n8n_describe_node`, `n8n_list_workflows`,
`n8n_get_workflow`, `n8n_validate_workflow`, `n8n_upsert_workflow`,
`n8n_activate_workflow`, `n8n_run_workflow`, `n8n_list_executions`,
`n8n_get_execution`, `n8n_list_credentials`.

`n8n_describe_node(type, typeVersion?, resource?, operation?)` tra thẳng vào
một kho dữ liệu trích xuất từ chính n8n-nodes-base thật (440+ node, mọi
field/enum/điều kiện `displayOptions`, kèm `builderHint` — gợi ý cấu hình do
chính n8n viết sẵn cho từng node khi có) — không phải đoán hay nhớ. Dùng nó
bất cứ khi nào cần 1 node KHÔNG nằm trong danh sách quen thuộc bên dưới, hoặc
khi n8n báo lỗi validate mà mục "Tham số hay cần" chưa giải thích được. Danh
sách dưới đây chỉ là các node hay gặp nhất và những lỗi cụ thể đã từng thấy —
không phải toàn bộ kiến thức n8n có; đừng dừng lại ở nó khi `n8n_describe_node`
trả lời được câu hỏi trực tiếp hơn.
**Node nhiều resource (gmail, slack...) LUÔN truyền kèm `resource`/`operation`
ngay khi đã biết** — không gọi trống rồi tự lọc bằng mắt. Lỗi thật đã gặp: gọi
`n8n_describe_node("gmail")` không kèm resource/operation trả về 60+ property
gộp chung mọi resource×operation, kết quả dài tới mức bị đẩy ra file riêng,
model phải đọc/grep qua nhiều lần theo từng đoạn offset — và vẫn viết sai tên
field cuối cùng (bịa ra `filterType`/`query`/`maxResults` không hề tồn tại)
vì lạc mất đoạn đang đọc dở. Gọi kèm resource/operation
(`n8n_describe_node("gmail", 2.2, "message", "getAll")`) chỉ trả về đúng ~10
property liên quan, đọc một lần là đủ, không cần phân trang.

## Quy trình

0. **Workflow từ 3 node trở lên, hoặc có bất kỳ node `code` nào: dùng
   `workflowFile`, đừng nhồi `workflow` trực tiếp vào tool call.** Ghi JSON
   ra file bằng tool `write` trước (ví dụ
   `/workspace/<id>/workflow.json`), rồi truyền path đó vào tham số
   `workflowFile` của `n8n_validate_workflow`/`n8n_upsert_workflow` — bỏ hẳn
   `workflow`. Lỗi thật đã lặp lại nhiều lần: nhồi thẳng object lồng nhau lớn
   (đặc biệt khi có `jsCode` chứa dấu ngoặc kép/`\n`/tiếng Việt) vào MỘT
   tham số tool call sinh JSON hỏng liên tục (`Expected ',' or '}'...`) —
   model từng thử 3 lần liền đều hỏng, cuối cùng bỏ cuộc, ghi file rồi KHÔNG
   BAO GIỜ gọi lại `n8n_upsert_workflow` nữa (workflow không được tạo, dù
   file JSON có nằm sẵn trong workspace). Ghi ra file trước rồi truyền path
   tránh được lỗi này hoàn toàn vì lúc đó chỉ có một tham số chuỗi đơn
   giản (đường dẫn), không phải object lồng nhau.
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
4. `n8n_activate_workflow` — gọi thẳng, đừng hỏi xin phép trong chat trước.
   Chính lời gọi này hiện hộp duyệt cho người dùng bấm, rồi dừng chờ họ; hỏi
   thêm trong chat là bắt họ duyệt hai lần. Workflow chưa active thì webhook
   trả 404.
5. `n8n_run_workflow` chạy workflow đã active và có node `webhook`. `body` là
   thứ người gọi nhận được; `execution.nodes` là từng node đã chạy ra sao —
   `status`, `error`, số item ở mỗi output, và item đầu tiên nó sinh ra.
6. Trả lời người dùng kèm link mở workflow: đích của link là ĐÚNG NGUYÊN VĂN
   `editorUrl` lấy từ kết quả `n8n_upsert_workflow`, chữ hiển thị là tên
   workflow — `[Mở workflow ty-gia](<editorUrl>)`, không dán URL thô. Không
   tự ghép, đoán, hay bịa bất kỳ URL nào khác
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

Khi kết quả sai, rỗng hoặc chỉ là `"Error in workflow"`: đọc `execution.nodes`
trước khi sửa gì. Node có `error` là node hỏng, và câu lỗi nói lí do. Node
`success` mà `firstItem` thiếu trường mong đợi thì `parameters` của nó viết
sai — đối chiếu với mục "Tham số hay cần" bên dưới. Sửa đúng node đó, rồi chạy
lại để xem digest mới.

Node cần đăng nhập vào dịch vụ khác (Gmail, Slack, API có khoá...) thì gọi
`n8n_list_credentials` lấy `id` và `type` của credential để gắn vào node. Chưa
có credential cần dùng thì báo người dùng tạo nó trong giao diện n8n. Gắn vào
node bằng khoá `credentials` (ngang hàng với `parameters`, không phải bên
trong nó):
```json
{ "id": "1", "name": "Gmail Trigger", "type": "n8n-nodes-base.gmailTrigger",
  "typeVersion": 1.4, "position": [0, 0], "parameters": { ... },
  "credentials": { "gmailOAuth2": { "id": "<id từ n8n_list_credentials>", "name": "<name từ đó>" } } }
```
Thiếu khoá `credentials` là lý do thật của lỗi `n8n_activate_workflow` báo
`Missing required credential: gmailOAuth2` dù workflow đã "tạo thành công" —
tạo/sửa workflow không tự kiểm tra credential, chỉ activate mới kiểm.
Không có node nào có field trong `parameters` chứa chữ "credential" — lỗi
thật đã gặp: model tự bịa `"gmailCredential": {id, name}` bên trong
`parameters` thay vì dùng đúng khoá `credentials` cấp node.
`n8n_validate_workflow` giờ tự bắt lỗi này (bất kỳ key nào trong `parameters`
chứa "credential" đều bị từ chối, kèm gợi ý sửa) — nhưng vẫn nên viết đúng
ngay từ đầu, đừng dựa vào việc bị chặn rồi mới sửa.

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
  `={{ $json.body.so_luong }}`. Webhook `GET` không có body — dữ liệu nằm trong
  `$json.query`.
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
- **`respondToWebhook`** — `"respondWith": "json"` kèm `"responseBody"`; thiếu
  `respondWith` thì node trả lại nguyên item nó nhận vào. Trả JSON cố định thì
  đơn giản hơn là dùng `"lastNode"` với một node `set` ở cuối.
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
  **TUYỆT ĐỐI KHÔNG** lấy `OPENAI_API_KEY`/bất kỳ credential nào của chính
  Agent (nhìn thấy trong `.env`, system prompt, hay bất kỳ đâu trong phiên
  làm việc) rồi nhét vào `headerParameters`/`body` của workflow n8n — lỗi thật
  đã xảy ra: model tự copy key thật của Agent vào node HTTP Request rồi báo
  "đã cấu hình xong". Key đó sẽ nằm vĩnh viễn trong n8n, ai có quyền n8n cũng
  đọc được — rò rỉ credential thật, không phải chuyện nhỏ. Cần AI trong
  workflow mà người dùng **không nêu AI nào** thì gọi chính agent này (mục
  "Gọi chính agent này từ workflow"), không cần key nào. Chỉ khi họ muốn một
  AI bên ngoài cụ thể mới hỏi họ API key RIÊNG cho workflow đó (của họ, không
  phải của Agent), hoặc dùng `genericCredentialType` với credential họ tự tạo
  trong n8n.
- **`if` / `filter` / `switch`** — điều kiện dạng
  `{ "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
  "conditions": [{ "leftValue": "={{ $json.x }}", "rightValue": "y",
  "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" }`.
  Đặt vào `parameters.conditions`, riêng `switch` đặt vào
  `parameters.rules.values[N].conditions`.
- **`gmailTrigger` vs `gmail` (`getAll`) — chọn nhầm node là lỗi hay gặp
  nhất khi người dùng nói "tìm email"/"lọc email"/"lấy danh sách email".**
  Hai node này KHÔNG thay thế nhau được:
  - `gmailTrigger` — khởi động workflow mỗi khi có email MỚI khớp điều
    kiện (polling nền, không cần ai gọi). Dùng khi yêu cầu là hành động tự
    động "mỗi khi có mail... thì...".
  - `gmail`, `resource: "message"`, `operation: "getAll"` — tìm/liệt kê
    email ĐÃ CÓ SẴN trong hộp thư, chạy một lần khi được gọi (thủ công,
    theo lịch, hay theo webhook). Dùng khi yêu cầu là tra cứu "tìm email
    có...", "email nào từ...", "liệt kê email chưa đọc tuần này" — đây mới
    là node đúng, KHÔNG PHẢI `gmailTrigger`.
  `getAll` nhận `parameters.filters` (object phẳng, không lồng thêm cấp
  nào), field thật xác nhận qua schema:
  `q` (chuỗi, đúng cú pháp ô tìm kiếm Gmail thật, ví dụ `"has:attachment"`,
  `"from:abc@xyz.com"`, `"subject:hoá đơn"`), `sender` (tên/email người
  gửi), `readStatus` (`"both"`/`"unread"`/`"read"`), `receivedAfter`/
  `receivedBefore` (ISO date hoặc timestamp ms), `labelIds` (mảng ID label
  thật — xem mục bên dưới), `includeSpamTrash` (boolean). Ví dụ:
  `"parameters": { "resource": "message", "operation": "getAll", "returnAll": false, "limit": 50, "filters": { "q": "from:abc@xyz.com", "readStatus": "unread" } }`.
  **Lỗi thật đã gặp NGAY CẢ SAU KHI đọc đúng mục này**: model tự bịa
  `"operation": "search"` và `"criteria": [{"field": "unread", "value": true}, ...]`
  — cả hai đều KHÔNG TỒN TẠI trong schema thật, nghe hợp lý nhưng hoàn toàn
  giả. `n8n_validate_workflow` và REST API của n8n đều KHÔNG kiểm tra nội
  dung `parameters` (chỉ kiểm tra cấu trúc workflow tổng thể) nên workflow
  vẫn "tạo thành công" nhưng không bao giờ trả ra kết quả gì khi chạy thật —
  lỗi âm thầm, giống hệt kiểu lỗi `labelIds` ở mục dưới. TRƯỚC KHI viết
  `parameters` cho bất kỳ operation nào của `gmail` (không riêng `getAll`),
  BẮT BUỘC gọi `n8n_describe_node("gmail", 2.2, "message", "getAll")` (kèm
  đúng resource/operation đang cần) xác nhận lại tên field thật — không suy
  luận, không đoán theo REST API "hợp lý" của dịch vụ khác.
  `simple: true` (mặc định) chỉ trả metadata gọn — GIỮ NGUYÊN mặc định này
  trừ khi thật sự cần đọc nội dung email (ví dụ để đưa cho AI tóm tắt/phân
  loại); đặt `simple: false` để lấy toàn bộ email thô tốn RAM nhiều, dễ gây
  workflow crash khi số lượng email lớn.
- **`gmailTrigger` xử lý xong dễ bị lặp lại cùng 1 mail mỗi lần poll** nếu
  không tự đánh dấu đã xử lý — trigger tự nó không nhớ email nào đã đi qua.
  Lọc `readStatus: "unread"` không đủ nếu không có bước nào đánh dấu email
  đã đọc/gắn nhãn sau khi xử lý xong: thêm bước `gmail`, `operation:
  "markAsRead"` (hoặc `addLabels` với 1 label loại trừ ngay trong `q` của
  trigger) ở CUỐI workflow, sau bước tạo ra kết quả — đặt trước thì một lần
  chạy lỗi giữa chừng sẽ đánh dấu đã xử lý mà chưa thực sự tạo ra gì.
- **`gmail`/`gmailTrigger` — gắn nhãn (label) sai là lỗi hay gặp nhất.**
  `resource: "message"`, `operation: "addLabels"` cần `labelIds` là **MẢNG ID
  label thật** (`type: "multiOptions"` trong schema thật — tra bằng
  `n8n_describe_node("gmail")` để xác nhận lại nếu cần), KHÔNG PHẢI một chuỗi
  tên tự đặt. Lỗi thật đã gặp: model viết
  `"labelIds": "={{ $json.labelName }}"` với `labelName` là chuỗi tự sinh kiểu
  `"Tiếng Việt-Công việc"` — sai type (chuỗi thay vì mảng) VÀ Gmail không hề
  có label tên như vậy, n8n âm thầm bỏ qua tham số lạ, workflow "chạy thành
  công" nhưng chẳng label nào được gắn cả.
  - Label hệ thống có sẵn, dùng thẳng ID (chính là tên viết hoa, không cần
    tạo): `IMPORTANT`, `STARRED`, `UNREAD`, `SPAM`, `TRASH`, `INBOX`, `SENT`,
    `DRAFT`.
  - Label tuỳ ý (do người dùng đặt tên, ví dụ phân loại theo ngôn ngữ/độ ưu
    tiên) PHẢI lấy ID thật trước: gọi `resource: "label"`,
    `operation: "getAll"` xem đã tồn tại chưa, chưa có thì
    `operation: "create"` (`parameters.name`) để n8n tạo và trả về `id` thật
    — chỉ dùng đúng `id` đó, không bao giờ đưa thẳng tên label vào `labelIds`.
  - **Label lồng nhau (sub-label)**: Gmail CÓ hỗ trợ, không phải không hỗ trợ
    như model từng trả lời sai — chỉ cần đặt `name` chứa dấu **gạch chéo
    `/`**, ví dụ `"Test nhãn/Nhãn con"` tạo ra "Nhãn con" lồng dưới "Test
    nhãn". Dấu CHẤM `.` không tạo phân cấp gì cả, Gmail hiển thị nguyên
    văn một label phẳng tên có dấu chấm — đừng dùng dấu chấm rồi bảo người
    dùng đó là cách phân cấp.
    **`name` LUÔN LÀ TOÀN BỘ ĐƯỜNG DẪN TỪ GỐC**, không phải chỉ phần tên mới
    thêm vào. Thêm 1 nhánh con cấp 3 vào cây có sẵn "Test nhãn/Nhãn con" thì
    `name` phải là `"Test nhãn/Nhãn con/Con của nhãn con"` — viết tắt
    `"Nhãn con/Con của nhãn con"` (thiếu gốc `"Test nhãn/"`) sẽ khiến Gmail
    hiểu đây là một cây NHÃN MỚI hoàn toàn, tạo ra một "Nhãn con" thứ hai độc
    lập ở gốc (trùng tên, khác id, không liên quan gì tới "Test nhãn/Nhãn
    con" đã có) rồi mới lồng "Con của nhãn con" dưới nó — không nối được vào
    cây cũ. Trước khi tạo nhánh con, `n8n_describe_node`/`getAll` không tự
    validate việc này — phải tự ghép đủ path từ gốc bằng tay.
  - `messageId` (cho `addLabels`/`removeLabels`/`get`) là chuỗi đơn, lấy từ
    output node trigger: `={{ $json.id }}` nếu dùng ngay node kế tiếp
    `gmailTrigger`, hoặc `={{ $node["Gmail Trigger"].json["id"] }}` nếu qua
    nhiều node trung gian — cả hai cách đều đúng cú pháp n8n.
  - Node cần OAuth2 (Gmail Trigger, hay bất kỳ operation nào của `gmail`)
    luôn đòi credential thật gắn vào node — xem mục "credential" ngay dưới
    đây, không giả định workflow tự chạy được nếu thiếu bước này.

Biểu thức n8n viết dạng `"={{ $json.ten_truong }}"` — thiếu dấu `=` mở đầu thì
n8n hiểu là chuỗi văn bản thường.

## Gọi chính agent này từ workflow

Workflow có thể **giao cả một việc cho agent này** qua `POST /api/v1/agent-run`.
Agent làm bằng đúng bộ tool nó có trong chat, rồi trả câu trả lời về cho node
sau ở `$json.answer`. Agent làm được:

- **Gmail**, qua trình duyệt thật đã đăng nhập tài khoản của người dùng: tìm và
  liệt kê thư, đọc thư, gửi thư, gắn sao, tải đính kèm về và đọc nội dung
  (kể cả PDF).
- Tra cứu web và đọc trang; đọc, viết file và chạy code trong workspace của nó;
  làm việc với chính n8n.

Agent **không cần ai lấy dữ liệu sẵn cho nó** — prompt là toàn bộ nhiệm vụ.
Vì vậy một bước nào agent làm được thì workflow **gọi agent thay cho node n8n
tương ứng, không dùng cả hai**. Việc nào dùng cái gì:

| Việc | Dùng |
|---|---|
| Đọc, tìm, tóm tắt, phân loại thư; soạn và gửi trả lời | agent |
| Đọc đính kèm, tra cứu thông tin, việc cần suy xét | agent |
| Người dùng chỉ nói "dùng AI" (tóm tắt, dịch, phân loại...) mà không nêu AI nào | agent (không cần API key) |
| Người dùng nêu đích danh node AI Agent / OpenAI của n8n, API OpenAI/Gemini/Claude, hoặc URL của agent bên thứ ba | **đúng cái họ nêu** — không tráo bằng agent này |
| Hẹn giờ, nhận webhook | node n8n (trigger) |
| Gọi một API cố định, ghi một dòng Sheet, rẽ nhánh theo giá trị | node n8n |

Trường hợp hay nhầm: "khi được gọi thì tóm tắt 3 thư chưa đọc" **không** có
node Gmail của n8n nào — agent tự đọc Gmail. Đặt node Gmail phía trước vừa
thừa, vừa đòi credential Gmail OAuth2 mà n8n thường không có, và workflow sẽ
không kích hoạt được. Mẫu đủ ba node:

```json
{
  "name": "tom-tat-mail",
  "nodes": [
    { "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
      "position": [0, 0], "webhookId": "tom-tat-mail",
      "parameters": { "httpMethod": "POST", "path": "tom-tat-mail", "responseMode": "lastNode" } },
    { "id": "2", "name": "Goi Fox Agent", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
      "position": [220, 0],
      "parameters": {
        "method": "POST",
        "url": "http://core:3080/api/v1/agent-run",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ prompt: 'Tóm tắt 3 thư chưa đọc mới nhất trong Gmail' }) }}",
        "options": { "timeout": 600000 }
      },
      "credentials": { "httpHeaderAuth": { "id": "<id từ n8n_list_credentials>", "name": "<name từ đó>" } } },
    { "id": "3", "name": "Lay cau tra loi", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
      "position": [440, 0],
      "parameters": { "assignments": { "assignments": [
        { "id": "a1", "name": "answer", "value": "={{ $json.answer }}", "type": "string" }
      ] } } }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Goi Fox Agent", "type": "main", "index": 0 }]] },
    "Goi Fox Agent": { "main": [[{ "node": "Lay cau tra loi", "type": "main", "index": 0 }]] }
  },
  "settings": {}
}
```

- **Xác thực bằng credential, không bằng secret.** Route đòi header
  `x-n8n-webhook-secret`; người dùng giữ giá trị đó trong một credential n8n
  kiểu **Header Auth**. Tìm nó bằng `n8n_list_credentials` (loại
  `httpHeaderAuth`) và gắn như trên. Chưa có thì **dừng lại và nhờ người dùng
  tạo**: Header Auth, Name = `x-n8n-webhook-secret`, Value = giá trị
  `N8N_WEBHOOK_SECRET` trong Settings của app. Không tự đọc, không tự chép
  secret đó vào workflow — cùng lý do với mục `httpRequest` ở trên.
- **URL là `http://core:3080`**, tên service trong mạng Docker — không phải
  `localhost`/`127.0.0.1`, vì node chạy bên trong container n8n.
- **`timeout: 600000`** (10 phút) là bắt buộc: agent lái trình duyệt mất từ vài
  giây tới vài phút, mặc định của node ngắn hơn nhiều và sẽ bỏ cuộc giữa chừng.
- **Prompt là nhiệm vụ đầy đủ**, viết như người dùng gõ trong chat; ghép dữ
  liệu từ node trước bằng biểu thức, ví dụ
  `"={{ JSON.stringify({ prompt: 'Trả lời thư của ' + $json.body.email }) }}"`.
  Agent biết đây là yêu cầu tự động nên làm luôn, không hỏi lại.
- **Kết quả:** `$json.answer` là câu trả lời; `$json.finish` là `"completed"`
  khi xong bình thường (khác đi thì node trả lỗi HTTP 502, vẫn kèm `answer`).
  `$json.provider`/`$json.model` cho biết lượt đó chạy bằng model nào.
- **Chọn model cho lượt chạy** (không bắt buộc): thêm `provider` và `model`
  vào body, luôn đi cùng nhau —
  `"={{ JSON.stringify({ prompt: '...', provider: 'openrouter', model: 'anthropic/claude-sonnet-5' }) }}"`.
  Không ghi thì dùng model mặc định trong Settings. Chỉ ghi khi người dùng
  yêu cầu một model cụ thể; model sai hoặc nhà cung cấp chưa có key thì route
  trả lỗi 400 ngay, nói rõ thiếu gì.

## Ví dụ: Gmail trigger → AI bên ngoài của người dùng → gắn nhãn

**Chỉ dùng khi người dùng muốn một AI bên ngoài cụ thể** và đưa endpoint/key
của họ. Nếu họ chỉ nói "dùng AI tóm tắt/phân loại thư", dùng mục "Gọi chính
agent này từ workflow" thay vì khung này — agent tự đọc Gmail, không cần node
Gmail, không cần key. Khung dưới đây là cho trường hợp AI bên ngoài:

```json
{
  "name": "Gmail AI Summary & Label",
  "nodes": [
    { "id": "1", "name": "Gmail Trigger", "type": "n8n-nodes-base.gmailTrigger", "typeVersion": 1.4,
      "position": [0, 0],
      "parameters": { "pollTimes": { "item": [{ "mode": "everyMinute" }] },
        "filters": { "readStatus": "unread" }, "simple": false },
      "credentials": { "gmailOAuth2": { "id": "<id từ n8n_list_credentials>", "name": "<name từ đó>" } } },
    { "id": "2", "name": "Goi AI", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
      "position": [220, 0],
      "parameters": {
        "method": "POST", "url": "<endpoint AI người dùng cung cấp>",
        "authentication": "none", "sendHeaders": true, "specifyHeaders": "keypair",
        "headerParameters": { "parameters": [
          { "name": "Authorization", "value": "Bearer <API key RIÊNG người dùng cung cấp cho workflow này>" },
          { "name": "Content-Type", "value": "application/json" } ] },
        "sendBody": true, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ model: \"<model>\", messages: [ { role: \"system\", content: \"Trả lời DUY NHẤT JSON dạng {label, summary}. label chỉ được là một trong: Cong-Viec, Ca-Nhan, Spam.\" }, { role: \"user\", content: $json.subject + \"\\n\" + $json.snippet } ] }) }}" } },
    { "id": "3", "name": "Doc ket qua AI", "type": "n8n-nodes-base.code", "typeVersion": 2,
      "position": [440, 0],
      "parameters": { "jsCode": "const email = $('Gmail Trigger').first().json\nconst ai = JSON.parse($input.first().json.choices[0].message.content)\nreturn [{ json: { messageId: email.id, label: ai.label, summary: ai.summary } }]" } },
    { "id": "4", "name": "Gan nhan", "type": "n8n-nodes-base.gmail", "typeVersion": 2.2,
      "position": [660, 0],
      "parameters": { "resource": "message", "operation": "addLabels",
        "messageId": "={{ $json.messageId }}",
        "labelIds": "={{ [$json.label === 'Cong-Viec' ? 'Label_111' : $json.label === 'Spam' ? 'SPAM' : 'Label_222'] }}" },
      "credentials": { "gmailOAuth2": { "id": "<id từ n8n_list_credentials>", "name": "<name từ đó>" } } }
  ],
  "connections": {
    "Gmail Trigger": { "main": [[{ "node": "Goi AI", "type": "main", "index": 0 }]] },
    "Goi AI": { "main": [[{ "node": "Doc ket qua AI", "type": "main", "index": 0 }]] },
    "Doc ket qua AI": { "main": [[{ "node": "Gan nhan", "type": "main", "index": 0 }]] }
  },
  "settings": {}
}
```

Những chỗ PHẢI thay bằng giá trị thật trước khi upsert, không được để nguyên
placeholder:
- `<id từ n8n_list_credentials>`/`<name từ đó>` — gọi `n8n_list_credentials`
  lấy thật; chưa có thì báo người dùng tạo credential Gmail OAuth2 trước.
- `<endpoint AI người dùng cung cấp>` và API key trong `Authorization` — hỏi
  người dùng, KHÔNG dùng key/endpoint của chính Agent (xem mục `httpRequest`
  ở trên).
- `Label_111`/`Label_222` trong node "Gan nhan" — đây là ID GIẢ minh hoạ
  shape đúng (mảng), không phải ID thật. Lấy ID thật bằng
  `resource: "label", operation: "getAll"` (đã tồn tại) hoặc `"create"`
  (chưa có) trước khi ghép vào node "Gan nhan" — xem mục `gmail` ở trên. Có
  thể dùng thẳng label hệ thống (`SPAM`, `IMPORTANT`, ...) mà không cần bước
  này.
- Cấu trúc JSON trả về từ node "Goi AI" (`choices[0].message.content`) đúng
  cho API dạng OpenAI-compatible; endpoint khác có thể trả field khác — đọc
  `n8n_run_workflow`'s kết quả thật một lần để biết đúng đường dẫn field
  trước khi tin vào đoạn Code này.
