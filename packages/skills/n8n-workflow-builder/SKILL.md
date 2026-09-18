---
name: n8n-workflow-builder
description: Xây dựng hoặc sửa workflow n8n qua các tool mcp__n8n__* một cách tiết kiệm context — tránh lỗi tràn context window (CONTEXT_WINDOW_EXCEEDED) đã gặp thật khi tạo workflow nhiều node. Dùng khi được yêu cầu tạo, sửa, hoặc mở rộng 1 workflow tự động hoá trong n8n.
---

# n8n-workflow-builder — dùng tool MCP n8n tiết kiệm, tránh vỡ context

MCP server của n8n (các tool `mcp__n8n__*`) trả kết quả RẤT DÀI — dump nguyên
TypeScript type definition kèm JSDoc cho mỗi node, toàn bộ tài liệu SDK... Gọi
tràn lan hoặc thiếu kỷ luật sẽ làm hội thoại vỡ context window thật (đã xác
nhận nhiều lần khi test) trước khi kịp tạo xong workflow. Theo đúng các quy
tắc dưới đây — mỗi quy tắc đều dựa trên 1 lỗi thật đã xảy ra, không phải suy
đoán.

## Quy tắc bắt buộc

1. **Không bao giờ gọi `get_workflow_sdk_reference` với `section: "all"`.**
   Luôn chỉ định đúng 1 section cụ thể đang cần (`"patterns"`, `"guidelines"`,
   `"design"`...), và mỗi section chỉ gọi ĐÚNG 1 LẦN trong cả cuộc hội thoại —
   đừng gọi lại section đã đọc rồi.
2. **Gộp nhiều node cần tra vào 1 lần gọi `search_nodes`/`get_node_types`**
   (mảng `queries`/`nodeIds` nhận nhiều phần tử cùng lúc) thay vì gọi rải rác
   nhiều lần cho từng node riêng lẻ.
3. **Không tra lại thứ đã tra rồi trong cùng hội thoại.** Nếu đã gọi
   `get_node_types` cho 1 node/discriminator, nhớ lấy thông tin đó dùng tiếp,
   đừng gọi lại y hệt.
4. **Ưu tiên tạo workflow đơn giản trước** (vd chỉ trigger + 1-2 node cốt
   lõi), **rồi mở rộng dần bằng các operation của `update_workflow`**
   (addNode, addConnection, updateNodeParameters, setNodeParameter...) thay vì
   cố viết 1 khối code phức tạp nhiều node ngay từ đầu. Mỗi lần gọi
   `update_workflow` là 1 giao dịch atomic — lỗi ở đâu sửa đúng đó, không
   phải viết lại toàn bộ từ đầu.
5. **Code TypeScript viết ra phải ngắn gọn, không comment dài dòng.** Tránh
   template literal nhiều dòng chứa văn bản tiếng Việt hoặc ngôn ngữ khác có
   dấu — dễ vỡ cú pháp escape (lỗi thật đã gặp: "Unterminated string
   constant" vì nhúng đoạn văn tiếng Việt trực tiếp vào template literal).
   Nếu cần nội dung dài bằng ngôn ngữ khác, đặt vào 1 biến string đơn giản
   trên 1 dòng, tránh nhúng trực tiếp nhiều dòng.
6. **Nếu gặp lỗi `CONTEXT_WINDOW_EXCEEDED` giữa chừng:** đừng lặp lại các
   bước nghiên cứu đã làm ở lượt trước — tự tóm tắt lại bằng lời những gì đã
   biết, rồi đi thẳng vào bước tiếp theo (`create_workflow_from_code` hoặc
   `update_workflow`) thay vì tra cứu lại từ đầu.
7. Luôn `validate_workflow`/spot-check `validate_node_config` trước khi
   `create_workflow_from_code` — bắt lỗi sớm, tránh phải viết lại cả khối
   code chỉ vì 1 lỗi nhỏ.
