---
description: Quy ước khi tạo hoặc cập nhật plan (độ phức tạp, tên, thứ tự thực thi).
---

# Plan conventions (llmog)

Khi tạo hoặc làm mới một **plan** cho repo này:

1. **Tên plan**  
   - Tiêu đề (heading level 1) và trường `name` trong frontmatter (nếu có) phải bắt đầu bằng tiền tố **tên dự án** (`{{project_name}}` → với repo này dùng **`llmog:`**) rồi đến phần mô tả ngắn.  
   - Ví dụ: `llmog: Playground UX templates`.  
   - File plan trên đĩa (nếu có) nên đặt tên có cùng tiền tố để dễ tìm, ví dụ `llmog-playground-ux.md`.

2. **Đánh giá độ phức tạp mỗi task**  
   - Với mỗi hạng mục / todo trong plan, ghi rõ **độ phức tạp** theo một trong: **Thấp** | **Trung bình** | **Cao**.  
   - Ngắn gọn lý do (1 cụm): ví dụ “nhiều UI + SSE”, “chỉ nối route”.

3. **Chạy song song vs tuần tự**  
   - Plan phải có mục **Thứ tự thực thi** (hoặc tên tương đương) nêu rõ:  
     - Task nào **bắt buộc tuần tự** (phụ thuộc output task trước).  
     - Task nào **có thể song song** với task khác (và điều kiện an toàn, ví dụ đã chốt contract API).  
   - Mặc định ưu tiên tuần tự khi có rủi ro conflict hoặc contract chưa chốt.
