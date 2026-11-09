# Vocabest — nền tảng (Prompt 1)

Website học từ vựng: HTML/CSS/JS thuần + Supabase, host trên GitHub Pages. Đăng nhập chỉ bằng **tên đăng nhập + mật khẩu**.

## Cài đặt
1. Tạo project tại [supabase.com](https://supabase.com).
2. Mở **SQL Editor**, dán toàn bộ `database.sql` và chạy (chạy lại nhiều lần vẫn an toàn).
3. Vào **Project Settings → API**, chép *Project URL* và *anon public key* vào đầu `script.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). **Không** dùng `service_role` key.
4. Vào **Authentication → Providers → Email**, **tắt "Confirm email"** để tài khoản kích hoạt ngay.
5. **Tạo Boss:** mở website, đăng ký tài khoản bình thường; rồi chạy trong SQL Editor (thay tên đăng nhập):
   ```sql
   update public.user_roles set role = 'boss'
    where user_id = (select id from public.profiles where username = 'ten_dang_nhap_cua_ban');
   ```
6. **GitHub Pages:** đẩy 5 file lên repo → *Settings → Pages* → chọn nhánh `main`, thư mục `/ (root)`.

## Cách hoạt động
Supabase Auth chỉ nhận email hoặc SĐT, nên `script.js` ghép `username@users.vocabest.invalid` làm định danh nội bộ (không hiển thị ở đâu). Trigger `handle_new_user` từ chối mọi tài khoản không có dạng này và luôn gán role `user`; role chỉ đổi được bằng SQL (Boss) hoặc hàm `set_admin` (chỉ Boss gọi được).

## Giới hạn kỹ thuật đã biết
- **Chưa kiểm thử với Supabase thật.** Supabase hosted có kiểm tra định dạng email và từng từ chối một số miền; chưa xác nhận miền `.invalid` được chấp nhận. Nếu đăng ký báo lỗi định danh, đổi miền ở **cả** `script.js` (`INTERNAL_EMAIL_DOMAIN`) **và** regex trong `handle_new_user()`, hoặc thử Supabase self-host.
- Không có xác minh email và không có khôi phục mật khẩu: quên mật khẩu là mất tài khoản.
- Khóa tài khoản chặn ghi/tạo dữ liệu qua RLS, nhưng phiên đăng nhập Auth vẫn còn hiệu lực.
- Giao diện quản trị chỉ hiện đúng quyền, nhưng quyền thật được kiểm tra ở database (RLS + hàm RPC).
- Supabase JS tải từ CDN jsDelivr (phiên bản cố định 2.45.4).

## Prompt 2 — thư viện và học tập
Chạy lại toàn bộ `database.sql` (an toàn khi chạy lại). Phần mới thêm `study_sessions`, `study_attempts`, `word_progress`, trigger chấm điểm và quy tắc tối thiểu 8 mục.

- Mục từ dạng `A : B` (mỗi dòng đúng một dấu `:`), học được cả hai chiều. Thư viện dưới 8 mục là bản nháp: không công khai và không học được (chặn ở database).
- Thư viện công khai không phải của hệ thống được tính là thư viện **cộng đồng**; thư viện hệ thống chỉ Boss tạo và phải tạo xong ≥ 8 mục rồi mới công khai (ở trang chi tiết).
- Đáp án trắc nghiệm, nhập, điền chỗ trống và ghép cặp được database chấm (`grade_attempt`); riêng **flashcard là tự đánh giá** nên không kiểm chứng được.

### Giới hạn đã biết (Prompt 2)
- Chưa chạy thử với Supabase thật; trò chơi, trigger và RLS mới chỉ được rà soát bằng mắt và kiểm tra cú pháp JS.
- Chưa hỗ trợ nhiều đáp án được chấp nhận cho một mục, và chưa sửa riêng từng mục (chỉ xóa rồi thêm lại).
- Chấm điểm phân biệt dấu tiếng Việt; so sánh không phân biệt hoa/thường phụ thuộc collation của database (Supabase mặc định hoạt động tốt với tiếng Việt).
- Thư viện hệ thống chỉ Boss tạo/quản lý.

## Prompt 3 — cộng đồng, kiểm duyệt, quản trị
Chạy lại toàn bộ `database.sql`. Thêm: cột `libraries.moderation` (ok/reported/hidden/locked), bảng `library_ratings`, `content_reports`, các hàm RPC quản trị (`set_library_moderation`, `resolve_report`, `admin_*`, `delete_account`).

- **Cộng đồng:** thư viện công khai (≥ 8 mục) hiện ngay, không cần duyệt. Sắp xếp theo mới nhất / đánh giá cao (điểm trung bình có trọng số, tránh 1 lượt 5 sao đứng đầu) / phổ biến (số người học khác chủ thư viện đã hoàn thành ít nhất một phiên). Không có số liệu nhập tay.
- **Đánh giá:** 1 người / 1 thư viện, sửa được, chủ thư viện không tự đánh giá (chặn bằng RLS).
- **Báo cáo:** mỗi người chỉ có 1 báo cáo đang xử lý cho mỗi thư viện, tối đa 10 báo cáo / 24 giờ. Báo cáo chỉ chuyển thư viện sang `reported`, không tự ẩn hay xóa.
- **Quyền Admin:** `moderate_libraries` = ẩn/khóa/mở khóa thư viện và xử lý báo cáo; `lock_users` = khóa/mở khóa tài khoản; `manage_tags` = quản lý thẻ. Chỉ Boss bổ nhiệm/gỡ Admin, cấp quyền và xóa tài khoản.
- Thẻ đang được thư viện dùng không xóa được.

### Giới hạn đã biết (Prompt 3)
- **Xóa vĩnh viễn tài khoản (`delete_account`) chưa được kiểm chứng:** hàm xóa trực tiếp trong `auth.users`. Nếu Supabase của bạn không cho phép, hàm báo lỗi, hủy giao dịch và giữ nguyên dữ liệu; khi đó cần Edge Function dùng service_role (không đặt ở frontend). Khi xóa thành công, thư viện và dữ liệu học của tài khoản bị xóa theo.
- Nội dung thư viện riêng tư của người khác không ai xem được, kể cả Boss/Admin (Boss chỉ thấy tên và số mục trong danh sách quản trị).
- Thư viện `locked` do Boss khóa vẫn có thể được Admin có quyền mở khóa (chưa phân cấp theo người khóa).
- Chưa có thông báo cho tác giả/người báo cáo khi báo cáo được xử lý.
- Không có kiểm thử tự động với Supabase thật; các quyền ở trên mới được rà soát bằng mắt.
