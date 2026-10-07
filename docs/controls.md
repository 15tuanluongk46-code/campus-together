# Campus Together — chơi một mình hoặc cùng bạn bè

## Mở sân trường

`npm ci` rồi `npm run dev` từ root sẽ chạy cả server (2567) và Vite (5173).
Mở `http://localhost:5173`. Bản production: `npm run build && npm start`,
mở `http://localhost:2567`; HTML, GLB, font, matchmaking và WebSocket cùng origin.
`VITE_SERVER_URL` là override tại thời điểm build; mặc định suy ra ws/wss từ origin.

Đặt tên 1–24 ký tự. **Chơi một mình** mở lượt Solo 18 phút ngay, sau đó bấm
**Vào sân** ở hướng dẫn để bật điều khiển. Solo giữ trọn ba nhiệm vụ, hai việc phụ,
ba cách xếp đồ; không cần người thứ hai và không nhận thêm người vào phòng.

**Tạo phòng cùng bạn** mở lượt co-op 12 phút; gửi nút **Sao chép lời mời** cho bạn.
Người nhận mở link `/?room=XXXXXXXX` hoặc điền mã 8 ký tự.
Nhấn **Enter trong ô mã phòng** để tham gia đúng phòng đó. Link mời làm nổi nút
**Tham gia phòng**; nhập tên rồi Enter cũng tham gia. Lỗi không xóa tên/mã đang nhập.
Khi tự gõ mã phòng, Enter ở ô tên cũng kiểm tra/tham gia mã đó; nút **Chơi một mình**
vẫn luôn là lựa chọn Solo rõ ràng.
Cần 2–4 bạn kết nối và tất cả bấm **Mình sẵn sàng**. Trưởng nhóm bắt đầu.
Nếu còn ghế đang giữ cho bạn mất mạng, sảnh giải thích và chặn bắt đầu đến khi
bạn ấy nối lại hoặc hết thời gian giữ ghế.

## Bàn phím và chuột

| Điều khiển | Hành động |
|---|---|
| W A S D | Đi theo hướng camera |
| Chuột | Nhìn ngang/dọc; camera tự lùi trước vật cản |
| Shift | Chạy; ôm thùng chỉ đi 3 m/s |
| E | Nhặt, lắp/giao đồ, hoặc đọc gợi ý gần mình |
| Giữ E | Tay trống: giữ công tắc cổng hoặc trạm; thả xóa phần đang giữ dở |
| G | Đặt vật đang cầm ở vị trí an toàn phía trước |
| Q | Báo vị trí/tương tác đang ở gần cho nhóm |
| 1 / 2 / 3 | Trong giai đoạn nguồn điện, sau khi đọc gợi ý: báo biểu tượng thứ 1 / 2 / 3; không hoạt động khi đang mở menu |
| Esc | Thả chuột, mở menu nghỉ / cài đặt |

**Vào sân / Tiếp tục** là thao tác bật pointer lock và âm thanh. Nếu trình duyệt
chặn khóa chuột, giao diện báo cách thử lại. Mất focus / ẩn tab / Esc xóa phím
đang giữ và gửi input dừng/nhả trạm ngay; ngừng gửi movement lặp khi nghỉ.
Menu và mất mạng không tạm dừng đồng hồ, kể cả Solo.
Đồng hồ chạy ngay từ lúc bắt đầu lượt, kể cả khi đang đọc hướng dẫn. Nếu âm thanh
không bật được, bạn vẫn điều khiển bình thường; menu **Tiếp tục** cho phép thử lại.
Nếu vừa hủy yêu cầu chuột rồi bấm Tiếp tục ngay, thông báo **Đang chờ trình duyệt**
cho biết yêu cầu cũ chưa kết thúc. Chờ phản hồi rồi bấm lại; nếu trình duyệt không
phản hồi, tải lại trang sẽ kết thúc phiên hiện tại, không khôi phục tiến độ.

Thông báo gần vật phân biệt thao tác được bằng **E**, bị chặn **!**, và đã xong **✓**.
Đang cầm đồ mà muốn đọc bảng/giữ cổng/trạm: dùng **G** đặt xuống trước. Vòng viền
vàng và dấu **◎ Mang đến** chỉ nơi phù hợp chưa hoàn thành; bản đồ nhỏ có chú giải,
mũi hướng đi của bạn và dấu ✓. Gợi ý lần đầu nằm gọn trong HUD. Biểu tượng gợi ý
là badge bàn phím **[1]/[2]/[3]**, không phải nút cần bấm chuột.

## Ba việc cùng làm

1. Tìm hai thùng, cuộn dây, cầu chì (bản đồ nhỏ đánh dấu đồ trên đất).
   Mang đến các vòng đích ở sân khấu. Có thể giữ công tắc cổng cho bạn đi qua;
    đường phía nam và lớp học–hành lang luôn là đường vòng hợp lệ.
   **Solo:** giữ E ở công tắc đủ 1 giây để cổng mở 15 giây, xem đếm ngược trên HUD.
   Thả trước 1 giây phải giữ lại từ đầu. Sau khi mở, thả rồi giữ lại để kích hoạt
   lần nữa; giữ mãi không kéo dài thời gian. Cổng chờ lối trống trước khi đóng.
2. Một bạn vào lớp, E ở bảng gợi ý. Thứ tự chỉ hiện riêng cho người đọc.
   Dùng 1/2/3 để truyền từng biểu tượng qua ping.
    Mang ba mô-đun đúng thứ tự vào ô 1/2/3. Sai thứ tự không mất vật.
   **Solo:** tự đọc bảng; gợi ý được lưu trên HUD trong giai đoạn nguồn điện và
   khôi phục khi cùng nhân vật nối lại. Không cần ghi nhớ ngoài trò chơi.
3. Hai bạn đứng gần hai trạm A/B, tay trống, cùng giữ E đủ 3 giây.
   Một người thả tay/đi xa sẽ reset tiến độ. Băng rôn và đèn lồng là việc phụ,
    hoàn thành lúc nào trong lượt cũng được; không chặn chiến thắng.
   **Solo:** giữ **A đủ 3 giây**, rồi sang **B giữ đủ 3 giây**. B trước A không
   tiến triển. A đã xong vẫn giữ khi mất mạng; phần đang giữ dở xóa khi thả,
   cầm đồ, đi xa hay mất mạng. Màn hình chỉ rõ trạm cần làm tiếp.

Tối đa 1.300 điểm; nhặt/đặt lặp lại không có điểm. Trưởng nhóm chọn chơi lại từ
kết quả, co-op trở về sảnh để mọi người sẵn sàng lại. **Solo chỉ cần một lần bấm
Hẹn thêm một lượt nữa**: server bắt đầu lượt18phút mới và hiện hướng dẫn vào sân.
Vị trí đồ/gợi ý thay đổi; mọi điểm, đồ cầm, gợi ý đã đọc, trạm và bộ đếm reset;
chế độ giữ nguyên. Đồng hồ lượt mới chạy cả khi đang đọc hướng dẫn.

## Cài đặt và kết nối

- Nhạc, hiệu ứng/bước chân, độ nhạy chuột, chất lượng và giảm chuyển động được
  lưu trong localStorage. Font tiếng Việt được đóng gói, không phụ thuộc Google Fonts.
- Mất mạng: dừng điều khiển; tự nối lại tối đa 28 giây. Vật cầm được server đặt
  xuống sau 3 giây, ghế được dành 30 giây. Kết nối lại cần bấm **Tiếp tục**.
- Co-op chỉ còn một người: 60 giây chờ. Hết hạn, hết 12 phút hoặc server tắt có màn
  kết thúc rõ ràng. Chủ phòng rời thì quyền trưởng nhóm chuyển cho người còn lại.
- Solo không có hạn chờ đồng đội; hết 18 phút thì kết thúc. Rời phiên là đóng
  phòng trống; chế độ co-op không tự chuyển thành Solo khi bạn bè rời đi.
- Rời phòng/hủy tạo phòng hủy ownership của UI, đóng socket đến trễ và reset
  predictor/buffer/actor. Reconnect token chỉ ở bộ nhớ SDK, không nằm trong link.
- Chơi bằng PC/laptop. Bố cục thích ứng màn hình hẹp nhưng không có điều khiển chạm.
- Rời khi đang chơi cần xác nhận **Ở lại / Rời lượt chơi**. **Ở lại** hoặc Esc
  quay về menu nghỉ, giữ nguyên đồ/tiến độ; bấm Tiếp tục để chơi. Xác nhận rời
  không lưu tiến độ để trở lại. Rời sảnh/kết quả thực hiện ngay; đóng/tải lại
  trang vẫn kết thúc phiên client, không có khôi phục qua reload.
  Nếu phiên thực sự kết thúc trong lúc xác nhận, màn hình kết thúc thay thế xác
  nhận và cho phép **Về sân trường** ngay; không còn lựa chọn ở lại phiên đã đóng.

## Âm nhạc và tài nguyên

Xem `apps/client/public/assets/AUDIO-PROVENANCE.md` và `PROVENANCE.md`.
Không có API debug/bot/teleport trong frontend production. Helper tự động chỉ có
trong `tests/`, gửi phím hoặc input giao thức bình thường.
