const { grpc, fail, positive } = require("../../../../shared/rpc");
function validateEvent(e) {
  if (
    !e ||
    e.type !== "OrderCreated" ||
    e.version !== 1 ||
    typeof e.eventId !== "string" ||
    !e.eventId ||
    e.eventId.length > 128
  )
    throw new Error("Invalid OrderCreated envelope");
  positive(e.oid, "oid");
  positive(e.uid, "uid");
  return e;
}
function access(s, i, write = false) {
  if (write) {
    if (!["admin", "shipment_staff"].includes(i.requester_role))
      throw fail(grpc.status.PERMISSION_DENIED, "Forbidden");
  } else if (
    s.uid !== i.requester_uid &&
    !["admin", "shipment_staff"].includes(i.requester_role)
  )
    throw fail(grpc.status.PERMISSION_DENIED, "Forbidden");
}
function transition(old, next) {
  const allowed = {
    PENDING: ["SHIPPING", "CANCELLED"],
    SHIPPING: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  };
  if (!Object.hasOwn(allowed, next))
    throw fail(grpc.status.INVALID_ARGUMENT, "Invalid shipment status");
  if (old !== next && !allowed[old]?.includes(next))
    throw fail(
      grpc.status.FAILED_PRECONDITION,
      `Cannot change ${old} to ${next}`,
    );
  return next;
}
function response(s) {
  return {
    shipid: s.shipid,
    oid: s.oid,
    uid: s.uid,
    status: s.status,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}
module.exports = { validateEvent, access, transition, response };
