# Báo cáo kỹ thuật Prompt 3

## Phạm vi và cấu trúc

Hệ thống có 5 bounded contexts, mỗi context có service và database riêng. API Gateway là cổng REST và không phải một business bounded context.

| Context | Service | Dữ liệu sở hữu | Database | gRPC nội bộ |
|---|---|---|---|---|
| Identity & Access | auth-service | User, Role, CustomerProvisioning | auth_db/PostgreSQL | 50051 |
| Customer & Membership | customer-service | Customer, MemberShip | customer_db/PostgreSQL | 50052 |
| Product Catalog | product-service | Product, StockReservation, Counter | product_db/MongoDB | 50053 |
| Order Management | order-service | Order, OrderDetail, OrderRequest, Outbox | order_db/PostgreSQL | 50054 |
| Shipment | shipment-service | Shipment, Counter, RejectedEvent | shipment_db/MongoDB | 50055 |

`services/*/src/domain` chứa validation và quy tắc nghiệp vụ; `application` phối hợp use case; `infrastructure` truy cập DB/client; `interfaces` ánh xạ request gRPC và lỗi. `server.js` lắp ghép dependency và khởi động service. Gateway đặt ở `services/api-gateway`. `shared/rpc.js` chỉ chia sẻ tải contract/transport, không chia sẻ dữ liệu nghiệp vụ. Outbox publisher và vòng đời Kafka nằm trong Order bootstrap; đây là triển khai DDD ở mức MVP, chưa xây một framework domain tổng quát.

Không truy cập DB của service khác từ mã nghiệp vụ. `uid`, `pid`, `oid` xuyên context là tham chiếu logic, không phải FK xuyên database. FK OrderDetail→Order và Customer→MemberShip chỉ nằm trong cùng database.

## Proto

`syntax = "proto3"` định nghĩa message và RPC. `package` tạo namespace; service gồm các RPC unary. Field number là định danh wire cần giữ ổn định khi nâng cấp. `optional` ở request cập nhật giúp phân biệt trường không gửi với giá trị 0/rỗng. `keepCase:true` giữ tên `unit_price`, `request_id`. ID và qty là int32 dương; money là string decimal vì kiểu floating point không phù hợp để tính tiền.

| File | RPC chính |
|---|---|
| auth.proto | Register, Login, GetUser, Health |
| customer.proto | CreateCustomer, GetCustomer, UpdateCustomer, GetMembership, CreateMembership, UpdateMembership, Health |
| product.proto | CRUD, ReserveStock, ReleaseStock, Health |
| order.proto | CreateOrder, ListOrders, GetOrder, Health |
| shipment.proto | GetShipment, GetShipmentByOrder, UpdateShipmentStatus, Health |

CreateMembership/UpdateMembership được bổ sung để admin quản lý hạng/score. `npm run check:proto` tải và in tất cả contract; unit contract test truyền request qua gRPC thật để kiểm tra trường optional và status.

## Đăng ký, JWT và phân quyền

Auth kiểm tra input, hash password bằng bcrypt cost 12, lưu User cùng CustomerProvisioning trong một transaction PostgreSQL. Auth gọi CreateCustomer qua gRPC. Customer tạo hồ sơ mặc định normal score 10 và hỗ trợ retry cùng uid. Nếu Customer tạm ngừng, job còn tồn tại; Auth retry khoảng 10 giây và login cũng thử xử lý job. Register khi hồ sơ chưa tạo trả 503 để báo tình trạng chưa hoàn tất; account có thể đã tồn tại.

JWT HS256 có sub=uid, role, iat, exp; Gateway xác minh chữ ký/expiry/algorithm, kiểm tra role. Customer chỉ đọc/sửa hồ sơ mình; admin được quản trị. Người dùng không được tự đổi membership. Admin quản lý sản phẩm/hạng; admin hoặc shipment_staff cập nhật shipment. Service nội bộ tin cậy Gateway, dùng network Docker riêng và không publish cổng gRPC ra host. MVP local chưa triển khai mTLS hoặc service identity cho RPC nội bộ.

## Đơn hàng, tồn kho và tính tiền

1. Gateway lấy uid từ JWT, không lấy uid từ request body. Client gửi pid/qty; mỗi pid chỉ xuất hiện một lần, tối đa 100 dòng.
2. Order lưu OrderRequest trước khi gọi dependency. Key gồm uid và Idempotency-Key; payload khác nhưng key giống bị 409. Worker retry các request PENDING.
3. Trong transaction PostgreSQL, Order khoá row OrderRequest bằng SELECT FOR UPDATE, đọc Customer membership qua gRPC, gọi Product ReserveStock với reservation ID ổn định.
4. Product dùng MongoDB transaction trên replica set một node: tất cả sản phẩm đủ tồn kho thì trừ quantity và lưu StockReservation; bất kỳ sản phẩm nào thiếu thì rollback toàn bộ. Giá được chụp tại lần reserve đầu tiên. Retry reservation không trừ lại.
5. Order tính subtotal = tổng(qty × unit_price), discount và total bằng decimal.js; lưu Order + OrderDetail + Outbox + state SUCCEEDED trong một transaction.
6. Nếu lỗi nghiệp vụ chắc chắn, Order gọi ReleaseStock rồi ghi FAILED. Release trả lại tồn kho đúng một lần; release trước reserve lưu tombstone để chặn yêu cầu reserve đến muộn. Lỗi tạm thời hoặc DB lỗi giữ PENDING để worker tiếp tục với cùng reservation.

**Giả định công thức:** đề chỉ nói discount dựa vào score, chưa nêu công thức. Mặc định `discount = min(subtotal, score × DISCOUNT_PER_POINT)`; cấu hình mặc định 1 đơn vị tiền/điểm. Score 10, subtotal 200 → discount 10 → total 190. Không coi score là phần trăm. Có thể đổi DISCOUNT_PER_POINT trong `.env` khi thầy xác nhận quy tắc. Normal luôn score 10; admin tạo/sửa các hạng khác và gán mid cho khách hàng. Score thuộc hạng MemberShip, không phải điểm cá nhân riêng.

Số tiền DB giới hạn dưới 10^18; ID/qty là int32. Product delete là soft delete để vẫn có thể hoàn tồn kho nếu một saga đang xử lý. Admin cập nhật quantity là đặt số tồn kho khả dụng hiện tại. Cache Product TTL 5 giây có thể chưa phản ánh ngay retry Order từ background; Order luôn kiểm tra tồn kho trực tiếp tại Product.

Cơ chế này không tạo transaction phân tán xuyên PostgreSQL/MongoDB. Request đã chấp nhận có thể hoàn thành sau khi caller timeout; client cần retry cùng key. PENDING sẽ được retry vô hạn cho lỗi tạm thời; MVP chưa có trang quản trị job lỗi hoặc cơ chế huỷ đơn từ client. Chưa có thanh toán và hoàn hàng vì không có trong 5 contexts được giao.

## Kafka và Shipment

Kafka chạy KRaft: broker/controller cùng một node, không dùng ZooKeeper. Topic order-created có 1 partition, replication factor 1 phù hợp bài local; không chịu được mất broker/volume. Producer Order lấy Outbox chưa publish, send acks=-1, rồi ghi publishedAt. Nếu send thành công nhưng cập nhật DB thất bại, sự kiện có thể được gửi lại: delivery là at-least-once.

OrderCreated có eventId, type, version, oid, uid, createdAt, items. Consumer group shipment-service-v1 đọc từ đầu khi chưa có offset, validate schema, tạo shipment PENDING. Unique index oid chống tạo trùng kể cả event phát lại. Event thiếu oid/uid hoặc envelope sai được ghi RejectedEvent và bỏ qua; lỗi DB xử lý được throw để consumer không xác nhận thành công. KafkaJS có retry/restart; health consumer DOWN khi crash/disconnect và UP khi join group.

Shipment được tạo bất đồng bộ. POST order có thể trả `shipment:null`; gọi GET order hoặc GET `/api/shipments/by-order/:oid` để lấy sau. Trạng thái: PENDING→SHIPPING→DELIVERED; PENDING/SHIPPING có thể chuyển CANCELLED; trạng thái cuối không quay lại. Cập nhật cùng trạng thái hỗ trợ retry. CANCELLED chỉ mô tả trạng thái giao hàng, không huỷ Order hoặc hoàn tồn kho đơn đã thành công.

## Redis, logging và health

Gateway cache GET products 5 giây, dùng revision để vô hiệu cache khi admin thay đổi hoặc Gateway tạo order xong. Rate limit Redis INCR/EXPIRE qua Lua, fixed window 60 giây/IP, mặc định 300 request/phút; 429 có Retry-After. Redis mất kết nối thì API phụ thuộc rate limit trả lỗi, health DOWN; cache miss có thể fallback tải Product. Health không áp dụng rate limit/JWT.

Gateway log method/path/status/duration JSON, không log token/password/body. GET /api/health kiểm tra 5 service và Redis; Order health gọi describeCluster trực tiếp và Shipment health kiểm tra trạng thái consumer Kafka, các service kiểm tra DB. Compose dùng gRPC health nội bộ, Gateway health qua HTTP.

## Docker và vận hành

Compose có 13 container chạy dài hạn: Gateway + 5 services + 5 databases + Redis + Kafka. Ba init container sửa quyền Kafka volume, khởi tạo replica set Product và tạo topic; chúng kết thúc exit 0. Volume giữ dữ liệu sau down/up. PostgreSQL service chạy migrate deploy, seed idempotent. Dockerfile dùng Node 24 Debian slim, cài OpenSSL cho Prisma, npm ci với lockfile. Cổng DB/Kafka/Redis chỉ bind 127.0.0.1 để hỗ trợ bài thực hành; ứng dụng trao đổi bằng hostname Docker.

Đây là MVP chạy local, chưa có triển khai nhiều broker, observability tập trung, TLS hay cơ chế scale/retention job lâu dài. Mật khẩu demo và JWT secret mẫu cần thay nếu đưa lên môi trường thật.
