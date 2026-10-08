# Kiểm thử và bằng chứng

## Đã thực hiện khi biên soạn

- Kiểm tra cú pháp 43 file JS/CJS của bản cập nhật, bao gồm script demo phiếu mới, tải được toàn bộ 5 proto.
- 34 unit/contract tests PASS: validation, discount decimal, JWT/bcrypt, ownership/status shipment, reserve/release/retry/rollback qua adapter giả lập, Order idempotency/Outbox qua adapter giả lập, một test gRPC client-server thật.
- Prisma validate và generate thành công cho Auth, Customer, Order. Migration Order được sinh bằng Prisma migrate diff, chưa áp dụng vào PostgreSQL thật tại môi trường biên soạn.
- Docker Compose v2 kiểm tra `config --quiet` thành công; 16 services được cấu hình. Không có Docker daemon trong môi trường biên soạn nên chưa build image/up toàn bộ stack.
- Bộ E2E được viết, chưa chạy toàn bộ với PostgreSQL/MongoDB/Redis/Kafka trên Docker. CI cung cấp workflow để thực hiện khi push lên GitHub; workflow chưa được chạy ở đây.

Log kết quả kiểm tra mã và unit nằm trong `docs/evidence/`. 5 kiểm tra tích hợp trên MongoDB 7.0.24 replica set thật đã PASS: reserve lặp, rollback khi giữ nhiều sản phẩm bị lỗi, release lặp, 8 yêu cầu đồng thời với stock 5 chỉ có 5 thành công, tombstone chặn reserve đến muộn. Log ở `docs/evidence/mongo-integration.txt`. Môi trường kiểm chứng cần --nounixsocket; Compose dùng Mongo image bình thường. Kết quả này không thay thế E2E toàn hệ thống.

Có thể chạy lại bằng `npm run test:stock-integration` sau `npm ci` và cài dependencies product-service. Script tự tải MongoDB cho nền tảng đang dùng, chạy database tạm riêng và dọn sau test; không sửa dữ liệu Docker.

## Trên máy Mac

Chạy các bước README, sau đó `npm run test:e2e`. E2E kiểm tra 25 case của thầy và các case bổ sung, gồm Outbox đã publish, event thiếu oid được lưu RejectedEvent, event phát lại hai lần không tạo trùng. Nó kiểm tra consumer group bắt kịp offset trước khi kết luận dedup. Các case tiếp theo phụ thuộc dữ liệu từ case trước; nếu lỗi, sửa lỗi đó và chạy lại với một username mới do script sinh.

Mỗi lần chạy tạo dữ liệu demo mới và giữ đơn hàng để làm bằng chứng. Không chạy đồng thời nhiều phiên E2E nếu muốn log dễ đối chiếu. Health phải UP trước khi chạy.

## Dependency audit

Đã cập nhật grpc-js ở root lên 1.14.5 và Express lên 4.22.3 theo bản vá npm audit. Prisma/Prisma Client giữ 6.19.0 để tương thích schema và migration của dự án cũ. npm audit vẫn báo các advisory ở dependency của **Prisma CLI** (deepmerge-ts/effect/@prisma/config), không thể kết luận sạch toàn bộ dependency. Không dùng npm audit fix --force để tự đổi version lớn. Cần đánh giá nâng cấp Prisma riêng trước khi triển khai production.

## Kiểm tra lỗi bổ sung nên trình diễn

- Gửi POST orders đồng thời cho sản phẩm quantity nhỏ: chỉ đủ số đơn được chấp nhận; quantity không âm.
- Stop Customer lúc register rồi start lại: job provisioning retry tạo Customer normal score 10.
- Retry cùng Idempotency-Key/payload: cùng oid; payload khác/key cũ: 409.
- Thiếu JWT: 401; normal tạo sản phẩm/sửa mid/sửa shipment: 403; đọc đơn người khác: 403.
- Stop Kafka/Shipment và khởi động lại: Outbox/consumer tiếp tục, không mất đơn và không tạo Shipment trùng.
- DELETE Product giữ dữ liệu soft delete, GET sau đó 404.

Công thức discount cần thầy xác nhận vì đề không nêu tỉ lệ cụ thể. Phiếu chấm mới chỉ chọn 5 test cases trong 5 contexts hiện có; không yêu cầu mở rộng 6–9 contexts. Script demo mới chưa chạy với Docker tại môi trường biên soạn.
