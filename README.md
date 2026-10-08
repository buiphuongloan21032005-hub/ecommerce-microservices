# E-commerce MVP — Bài thực hành Prompt 3

Bản hoàn thiện từ dự án bạn đã làm: Auth, Customer, Product, Order, Shipment và API Gateway. Node.js 24; nội bộ dùng gRPC, REST ở Gateway; PostgreSQL/MongoDB riêng từng service; Redis cache/rate limit; Kafka truyền OrderCreated.

## Chạy trên Mac

1. Mở Docker Desktop và đợi Docker sẵn sàng. Dành khoảng 6 GB RAM cho Docker nếu máy cho phép.
2. Tại **thư mục dự án cũ**, dừng các container bằng `docker compose down`. Lệnh này giữ các volume và dữ liệu. Dừng các terminal `npm start` cũ bằng Ctrl+C.
3. Giải nén ZIP hoàn thiện vào một thư mục mới, mở Terminal trong thư mục `ecommerce-microservices` vừa giải nén. Giữ dự án cũ để đối chiếu. Compose cùng tên `ecommerce-microservices` nên sẽ sử dụng lại volume cũ trên máy.
4. Chạy:

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 600
docker compose ps -a
curl http://localhost:3002/api/health
```

Không cần cài npm trong từng service để chạy Docker. Docker tự cài dependency, tạo Prisma Client, chạy migration và seed. Lần đầu tải image/build có thể mất vài phút. Không dùng `docker compose down -v` khi muốn giữ dữ liệu.

Kết quả cần thấy: 13 container dài hạn healthy; 3 container `kafka-permissions`, `product-rs-init`, `kafka-topic-init` **Exited (0)** là bình thường. API health trả `UP` và tất cả dependencies `UP`.

Tài khoản demo được seed khi chưa tồn tại:

| Vai trò | Username | Password |
|---|---|---|
| admin | demo_admin | DemoAdmin123! |
| shipment_staff | demo_staff | DemoStaff123! |

Tài khoản người dùng mới đăng ký luôn là `normal`, Customer thuộc membership `normal`, score 10. Seed không thay đổi mật khẩu/vai trò tài khoản đã có. `.env` chứa cấu hình phát triển đã dùng trong dự án cũ; các tài khoản/mật khẩu mẫu dành cho bài chạy local.

## Kiểm thử

Cần Node.js 24 trên Mac. Tại thư mục gốc:

```bash
npm ci
npm run check
npm run test:e2e
```

E2E gọi REST thật, kiểm tra database và Kafka qua `docker compose exec`; có 25 case đối chiếu đề và các kiểm tra bổ sung. Nó tạo tài khoản/sản phẩm/đơn hàng kiểm thử, không xoá dữ liệu cũ. Kết quả được ghi vào `test-results/e2e.json`. Chỉ coi E2E đạt khi không có FAIL và lệnh thoát thành công.

Để chạy 34 unit/contract tests (không cần Docker):

```bash
(cd services/auth-service && npm ci)
(cd services/product-service && npm ci)
npm test
```

Có thể kiểm tra đồng thời/transaction với MongoDB tạm riêng bằng `npm run test:stock-integration`; lần đầu cần tải binary MongoDB.

Xem `docs/KIEM-THU.md` để biết phần đã kiểm chứng trong môi trường biên soạn và phần phải chạy trên Docker. Không gộp unit tests với kết quả 25 E2E case.

## Demo theo 8 mục trên phiếu mới

Sau khi Compose healthy và đã npm ci:

```bash
npm run demo:setup
npm run demo:cham -- 4
npm run demo:cham -- 5
npm run demo:cham -- 6
npm run demo:cham -- 7
npm run demo:cham -- 8
```

Script tạo dữ liệu demo riêng và in HTTP/JSON/PASS cho từng mục. Hướng dẫn giải thích và các lệnh Compose/Kafka nằm trong `docs/DOI-CHIEU-PHIEU-CHAM.md`. Cần chạy xác nhận trên Mac; script demo chưa được kiểm chứng với toàn bộ Docker stack trong môi trường biên soạn.

## Demo bằng Postman

Import `docs/postman_collection.json`. Đặt collection variable `baseUrl=http://localhost:3002`. Chạy lần lượt Login Admin → Create Product → Register → Login User → Create Order → Get Shipment By Order → Update Shipment Status. Các script Postman lưu token, uid, pid, oid, shipid tự động. Khi muốn tạo một đơn mới với items khác, xoá giá trị collection variable orderKey trước khi gửi Create Order. Chờ 1–3 giây và gọi lại Get Shipment By Order nếu nhận 404 vì Shipment được tạo bất đồng bộ.

API trả giá/tiền dạng chuỗi decimal để tránh mất độ chính xác. Không cho client chọn uid, role, giá đơn hay discount khi đặt hàng. Header `Idempotency-Key` trên Create Order giúp gọi lại cùng yêu cầu mà không trừ tồn kho hai lần.

## Tài liệu nộp và bảo vệ

- `docs/BAO-CAO.md`: kiến trúc, DDD, schema, proto, luồng đăng ký/đặt hàng, Redis và Kafka.
- `docs/DOI-CHIEU-PHIEU-CHAM.md`: các lệnh demo tương ứng phiếu chấm.
- `docs/API.md`: endpoint, phân quyền và mã lỗi.
- `docs/KIEM-THU.md`: kiểm thử và giới hạn kiểm chứng.
- `docs/test-cases.csv`: 25 test case từ Excel của thầy.
- `docs/de-bai/`: tài liệu gốc đã gửi.

Phiếu chấm mới có 8 mục: proto/cấu trúc, Compose, Kafka và TC-PRO-01, TC-CUS-04, TC-CUS-05, TC-ORD-04, TC-ORD-05. Cả 5 bounded contexts hiện tại đủ phạm vi phiếu này. Xem `docs/DOI-CHIEU-PHIEU-CHAM.md` để chạy từng mục; không cần thêm contexts 6–9.

## Xử lý lỗi thường gặp

```bash
docker compose logs --tail=100 api-gateway auth-service customer-service product-service order-service shipment-service
docker compose logs --tail=100 kafka product-rs-init kafka-topic-init
docker compose ps -a
```

- Cổng 3002/15433–15435/27018–27019/16379/19092 bị chiếm: dừng Compose cũ cùng dự án; kiểm tra `lsof -nP -iTCP:3002 -sTCP:LISTEN`. Có thể đổi `GATEWAY_PORT` trong `.env` nếu chỉ cổng Gateway bị chiếm; khi đó sửa baseUrl trong Postman theo cổng mới.
- Kafka restarting do quyền volume: `kafka-permissions` tự sửa owner volume trước khi broker khởi động. Nếu init lỗi, đọc log init và Kafka; không xoá volume để chữa lỗi quyền.
- Mongo báo transaction chỉ dùng trên replica set: chạy `docker compose up -d product-db product-rs-init`, chờ init Exited (0), rồi khởi động Product. Compose đã cấu hình replica set một node.
- Login admin sai trên dữ liệu cũ: seed giữ nguyên tài khoản đã tồn tại. Chọn username demo mới trong `.env`, rồi `docker compose up -d --force-recreate auth-service`.
- HTTP 503 khi Customer bị dừng lúc đăng ký: User và CustomerProvisioning đã được lưu; khởi động lại Customer, worker Auth sẽ tạo hồ sơ, sau đó đăng nhập lại.
- HTTP 504 khi tạo đơn: kết quả có thể vẫn được worker hoàn thành. Gọi lại cùng `Idempotency-Key` và cùng items hoặc xem danh sách đơn; không đổi key để retry một đơn chưa rõ kết quả.
- Dừng hệ thống nhưng giữ dữ liệu: `docker compose down`.
