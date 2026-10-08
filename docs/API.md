# REST API và phân quyền

Base URL: http://localhost:3002. JSON request/response. Bearer JWT với mọi API trừ register, login, health. Money trả chuỗi decimal; có thể parse để hiển thị nhưng không dùng Number làm logic tiền phía server.

| Method | Endpoint | Quyền | Body/Ghi chú |
|---|---|---|---|
| POST | /api/auth/register | public | username,password; fullname,email,phone optional |
| POST | /api/auth/login | public | username,password; trả accessToken,tokenType,expiresIn |
| GET | /api/customers/:uid | chính chủ/admin | kèm membership.mname/score |
| PUT | /api/customers/:uid | chính chủ/admin | fullname; mid chỉ admin |
| GET | /api/memberships/:mid | JWT | thông tin hạng |
| POST | /api/memberships | admin | mname,score |
| PUT | /api/memberships/:mid | admin | mname hoặc score; normal giữ score 10 |
| GET | /api/products | JWT | items[] |
| GET | /api/products/:pid | JWT | product |
| POST | /api/products | admin | pname,price,quantity |
| PUT | /api/products/:pid | admin | pname/price/quantity |
| DELETE | /api/products/:pid | admin | soft delete, trả message,pid |
| POST | /api/orders | JWT | items:[{pid,qty}]; Idempotency-Key khuyến nghị |
| GET | /api/orders | JWT | đơn của người đang đăng nhập |
| GET | /api/orders/:oid | chính chủ/admin | kèm items và shipment hoặc null |
| GET | /api/shipments/by-order/:oid | chính chủ/staff/admin | endpoint polling thêm cho luồng async |
| GET | /api/shipments/:shipid | chính chủ/staff/admin | thông tin giao hàng |
| PATCH | /api/shipments/:shipid/status | staff/admin | status |
| GET | /api/health | public | 200 UP hoặc 503 DOWN, dependencies |

Mã lỗi: 400 input sai; 401 JWT/đăng nhập sai; 403 thiếu quyền; 404 không tồn tại; 409 trùng dữ liệu, thiếu tồn kho, chuyển trạng thái sai hoặc xung đột; 429 rate limit; 503 dependency chưa sẵn sàng; 504 timeout; 500 lỗi nội bộ. Response lỗi có `error`.

Đặt hàng không nhận unit_price hay discount từ client. Idempotency key 1–100 ký tự `[a-zA-Z0-9_-]`. Gọi lại với cùng JWT uid/key/items nhận cùng oid; đổi payload với key cũ trả 409. Nếu không gửi key, Gateway sinh UUID và trả header Idempotency-Key; với yêu cầu quan trọng, client nên tự sinh key trước khi gọi để có thể retry khi mất response.

Ví dụ tạo đơn sau khi đã login và có pid:

```http
POST /api/orders
Authorization: Bearer <accessToken>
Content-Type: application/json
Idempotency-Key: demo-order-001

{"items":[{"pid":1,"qty":2}]}
```

Ví dụ kết quả có subtotal 200, discount 10, total 190. Shipment ban đầu có thể null do Kafka chưa được xử lý; đây là nhất quán cuối cùng, không phải lỗi tạo Order.
