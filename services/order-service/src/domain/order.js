const { grpc, fail, positive } = require("../../../../shared/rpc");
const Decimal = require("decimal.js").clone({ precision: 40 });
function normalize(input) {
  positive(input.uid, "uid");
  if (
    typeof input.request_id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.request_id)
  )
    throw fail(grpc.status.INVALID_ARGUMENT, "Invalid request_id");
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100
  )
    throw fail(grpc.status.INVALID_ARGUMENT, "Provide 1–100 items");
  const seen = new Set();
  return input.items
    .map((i) => {
      positive(i.pid, "pid");
      positive(i.qty, "qty");
      if (seen.has(i.pid))
        throw fail(grpc.status.INVALID_ARGUMENT, "Duplicate pid");
      seen.add(i.pid);
      return { pid: i.pid, qty: i.qty };
    })
    .sort((a, b) => a.pid - b.pid);
}
function totals(items, score, unit = "1") {
  if (!Number.isInteger(score) || score < 0)
    throw fail(grpc.status.FAILED_PRECONDITION, "Invalid membership score");
  const rate = new Decimal(unit);
  if (!rate.isFinite() || rate.isNegative())
    throw new Error("Invalid DISCOUNT_PER_POINT");
  const subtotal = items.reduce(
    (s, i) => s.plus(new Decimal(i.unit_price).times(i.qty)),
    new Decimal(0),
  );
  if (subtotal.gte(new Decimal(10).pow(18)))
    throw fail(
      grpc.status.FAILED_PRECONDITION,
      "Order amount exceeds database limit",
    );
  const discount = Decimal.min(subtotal, rate.times(score)).toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_UP,
  );
  return {
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    total: subtotal.minus(discount).toFixed(2),
  };
}
function response(o) {
  return {
    oid: o.oid,
    uid: o.uid,
    discount: String(o.discount),
    subtotal: String(o.subtotal),
    total: String(o.total),
    created_at: o.createdAt.toISOString(),
    items: o.details.map((i) => ({
      pid: i.pid,
      qty: i.qty,
      unit_price: String(i.unitPrice),
    })),
  };
}
module.exports = { normalize, totals, response };
