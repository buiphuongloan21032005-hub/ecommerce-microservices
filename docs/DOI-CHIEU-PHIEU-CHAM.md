# Hướng dẫn thực hành theo phiếu chấm mới — 8 mục

Phiếu áp dụng: `docs/de-bai/Phieu-cham.png` (ảnh image(9).png gửi ngày 08/10/2026). Phiếu này chấm 3 mục giải thích/vận hành và 5 test case cụ thể, **không yêu cầu thêm 6–9 bounded contexts**. Mỗi mục tối đa 1 điểm; điểm thực tế phụ thuộc thao tác và giải thích trước giảng viên.

## Chuẩn bị trước buổi chấm

Mở Docker Desktop. Tại thư mục gốc dự án đã giải nén:

```bash
docker compose up -d --build --wait --wait-timeout 600
npm ci
npm run check:proto
npm run demo:setup
```

Setup tạo một người dùng normal, Customer score 10 và một Product price 100, quantity 100; lấy JWT và lưu dữ liệu demo trong `test-results/demo-phieu-cham.json`. Đây là dữ liệu kiểm thử mới; không xoá dữ liệu cũ. File có JWT: không gửi file này lên GitHub hoặc đưa vào báo cáo. Chạy lại setup nếu token hết hạn hoặc cần dữ liệu demo mới.

Mỗi mục 4–8 có lệnh độc lập. Chạy từ cùng thư mục gốc. Script in HTTP status, JSON và PASS/FAIL; PASS không thay thế yêu cầu thầy xem thao tác/giải thích. Mục 4–8 cũng có thể demo bằng Postman; script giúp tránh gõ tay token/uid/pid.

| Mục | Nội dung trên phiếu | Thao tác chính | Kết quả cần thấy |
|---|---|---|---|
| 1 | Giải thích proto và cấu trúc dự án | npm run check:proto, mở proto và src | 5 contract; giải thích các lớp |
| 2 | Compose và danh sách container đúng thiết kế | docker compose up -d --build; docker compose ps -a | 13 container dài hạn, 3 init exit 0 |
| 3 | Kiểm tra, giải thích Kafka | topics --list/--describe, consumer groups | order-created, group shipment-service-v1 |
| 4 | TC-PRO-01: Lấy danh sách Product | npm run demo:cham -- 4 | HTTP 200, items[] |
| 5 | TC-CUS-04: Lấy thông tin Membership | npm run demo:cham -- 5 | HTTP 200, mid/mname/score |
| 6 | TC-CUS-05: Customer không có token | npm run demo:cham -- 6 | HTTP 401 |
| 7 | TC-ORD-04: Discount theo score | npm run demo:cham -- 7 | subtotal 200, discount 10, total 190 với cấu hình mặc định |
| 8 | TC-ORD-05: Order và phát sự kiện | npm run demo:cham -- 8, kiểm tra DB/Kafka | Order+OrderDetail, OrderCreated, Shipment |

## Mục 1 — Proto và cấu trúc dự án

```bash
npm run check:proto
```

Mở `proto/auth.proto`, `customer.proto`, `product.proto`, `order.proto`, `shipment.proto` và chỉ ra:

- `package`: namespace của service; `service`: danh sách RPC; `message`: cấu trúc request/response.
- Số sau dấu `=` là field number trên wire, phải giữ ổn định khi nâng cấp contract.
- `repeated` cho danh sách, ví dụ items của Order; `optional` giúp phân biệt trường không gửi và giá trị 0/rỗng trong request cập nhật.
- REST đặt ở Gateway, các service gọi nội bộ bằng gRPC.

**Câu giải thích:** “Em phân rã 5 bounded contexts: Auth, Customer, Product, Order và Shipment. Mỗi service có database riêng. Domain chứa quy tắc, application phối hợp nghiệp vụ, infrastructure truy cập DB/client, interfaces tiếp nhận gRPC. Server lắp ghép các thành phần.”

Mở `docs/BAO-CAO.md` khi cần giải thích schema và luồng nghiệp vụ.

## Mục 2 — Compose và container

Nếu thầy yêu cầu sửa code: lưu file, rồi chạy build lại.

```bash
docker compose up -d --build
docker compose ps -a
curl http://localhost:3002/api/health
```

Kết quả mong đợi: 13 container dài hạn healthy, gồm Gateway + 5 service + 5 database + Redis + Kafka. Ba init container `kafka-permissions`, `product-rs-init`, `kafka-topic-init` Exited (0) là đã làm xong nhiệm vụ; không phải lỗi.

**Câu giải thích:** “up tạo và chạy các service; -d chạy nền; --build build lại image theo mã nguồn. ps -a liệt kê cả container đang chạy và container init đã kết thúc. Volume giữ dữ liệu qua các lần khởi động.”

## Mục 3 — Kafka

```bash
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic order-created
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group shipment-service-v1
```

Cần thấy topic `order-created`, 1 partition, replication factor 1; consumer group `shipment-service-v1`. Sau khi xử lý và commit offset, LAG về 0.

Mở terminal thứ hai để quan sát sự kiện trước khi chạy mục 8:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic order-created --from-beginning
```

Terminal này tiếp tục chờ sự kiện; Ctrl+C để dừng. Có thể thấy sự kiện cũ do --from-beginning; đối chiếu đúng oid mới in ra ở mục 8.

**Câu giải thích:** “Order là producer, Shipment là consumer. OrderCreated truyền qua topic order-created. Outbox lưu cùng transaction với Order rồi worker gửi Kafka. Kafka có thể giao lại sự kiện nên Shipment dùng unique oid để chống tạo trùng. Broker chạy KRaft, không cần ZooKeeper; một broker phù hợp bài local.”

## Mục 4 — TC-PRO-01: Lấy danh sách Product

```bash
npm run demo:cham -- 4
```

Script gọi `GET /api/products` kèm `Authorization: Bearer <JWT>`. Cần thấy HTTP 200 và `items` là mảng chứa Product demo.

**Câu giải thích:** “Gateway xác minh JWT, lấy danh sách qua Product Service; Redis cache kết quả trong 5 giây. Product lưu trong MongoDB riêng.”

## Mục 5 — TC-CUS-04: Lấy thông tin Membership

```bash
npm run demo:cham -- 5
```

Script lấy Customer để biết mid, rồi gọi trực tiếp `GET /api/memberships/:mid` với JWT. Cần thấy HTTP 200, có mid, mname=`normal`, score=10. Trong Postman có thể GET Customer để thấy membership lồng trong response.

**Câu giải thích:** “Customer lưu mid tham chiếu MemberShip trong customer_db. Mname và score thuộc hạng thành viên. Khách đăng ký mới thuộc normal, score 10.”

## Mục 6 — TC-CUS-05: Customer không có token

```bash
npm run demo:cham -- 6
```

Script gọi `GET /api/customers/:uid` và **không gửi Authorization**. Cần thấy HTTP 401, thông báo Missing or invalid token.

Trong Postman: mở Get Customer → Authorization → No Auth → Send. Sau demo, đổi lại Bearer Token nếu dùng tiếp request đó.

**Câu giải thích:** “Gateway chặn request thiếu JWT trước khi gọi Customer Service, nên không trả dữ liệu khách hàng.”

## Mục 7 — TC-ORD-04: Discount theo score

```bash
npm run demo:cham -- 7
```

Input: Product giá 100, qty=2; Customer normal score=10. Với `.env` mặc định DISCOUNT_PER_POINT=1:

```text
subtotal = 100 × 2 = 200
discount = min(200, 10 × 1) = 10
total = 200 − 10 = 190
```

Cần thấy HTTP 201, các trường subtotal/discount/total đúng. Tiền trả dạng chuỗi decimal, có thể không giữ số 0 ở cuối. Giá và score được server lấy qua gRPC; client không được quyết định discount.

**Câu giải thích:** “Order lấy điểm của Customer và giá từ Product, dùng decimal.js tính tiền để tránh sai số floating point; discount không vượt subtotal.”

**Giả định cần xác nhận:** phiếu và tài liệu chỉ ghi discount theo score, chưa nêu tỉ lệ/công thức. Bản này dùng số tiền giảm = score × DISCOUNT_PER_POINT, không mặc định score là phần trăm. Nếu thầy quy định công thức khác thì cần chỉnh logic này trước khi chấm.

## Mục 8 — TC-ORD-05: Tạo Order và phát sự kiện

Mở Kafka consumer ở mục 3, rồi:

```bash
npm run demo:cham -- 8
```

Script gửi Create Order với key riêng cho mục 8, in HTTP 201 và oid. Nó chờ Shipment xuất hiện để kiểm chứng luồng nhận sự kiện. Chạy lại cùng mục và cùng dữ liệu demo nhận cùng oid, không phát sinh đơn thứ hai do idempotency. Muốn có một sự kiện mới để quan sát, chạy lại demo:setup rồi chạy mục 8.

Cần thấy trên terminal consumer: `type:OrderCreated`, `eventId`, `oid`, `uid`. Đối chiếu oid với output script. Để xem dữ liệu, chạy các lệnh sau **sau khi mục 8 đã thành công**; subquery lấy đúng oid vừa lưu ở file demo:

```bash
OID=$(node -p "require('./test-results/demo-phieu-cham.json').oid")
docker compose exec order-db psql -U ecommerce -d order_db -c "SELECT oid, uid, discount, subtotal, total FROM \"Order\" WHERE oid=$OID;"
docker compose exec order-db psql -U ecommerce -d order_db -c "SELECT oid, pid, qty, \"unitPrice\" FROM \"OrderDetail\" WHERE oid=$OID;"
docker compose exec order-db psql -U ecommerce -d order_db -c "SELECT oid, \"publishedAt\", payload FROM \"Outbox\" WHERE oid=$OID;"
```

Các lệnh DB dùng username/database mặc định trong `.env`; đổi tham số nếu đã tuỳ chỉnh. Cần thấy Order và OrderDetail đã lưu, Outbox có publishedAt; sự kiện Kafka đúng oid và Shipment liên kết cùng đơn. PublishedAt có thể còn null trong khoảng ngắn trước khi publisher cập nhật; đợi rồi kiểm tra lại.

**Câu giải thích:** “Em lưu Order, OrderDetail và Outbox trong một transaction PostgreSQL. Publisher gửi Outbox sang Kafka rồi đánh dấu publishedAt. Shipment đọc OrderCreated và tạo bản ghi PENDING. Vì bất đồng bộ nên response Create Order ban đầu có thể có shipment:null.”

## Kiểm tra tổng thể và phạm vi đã kiểm chứng

```bash
npm run test:e2e
```

Bộ E2E vẫn có đủ 25 test case gốc, bao gồm 5 case được chọn trên phiếu mới. Script demo giúp thao tác từng mục, không thay thế kiểm thử toàn bộ.

Đã kiểm chứng khi biên soạn: 34 unit/contract tests, 5 kiểm tra MongoDB thật, tải 5 proto và kiểm tra cấu hình Compose. Chưa chạy toàn bộ stack Docker/E2E vì môi trường biên soạn không có Docker daemon. Các script demo cũng cần chạy xác nhận trên Mac sau khi Compose healthy. Không coi tài liệu hoặc mã test là bằng chứng đã đạt điểm thực hành.
