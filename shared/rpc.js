const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
function service(name) {
  const definition = loader.loadSync(
    path.join(__dirname, "../proto", `${name}.proto`),
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    },
  );
  return grpc.loadPackageDefinition(definition)[name][
    name[0].toUpperCase() + name.slice(1) + "Service"
  ];
}
function client(name, address) {
  const Service = service(name);
  return new Service(address, grpc.credentials.createInsecure());
}
function call(client, method, request, timeout = 8000) {
  return new Promise((resolve, reject) =>
    client[method](
      request,
      { deadline: Date.now() + timeout },
      (error, data) => (error ? reject(error) : resolve(data)),
    ),
  );
}
function fail(code, details) {
  return Object.assign(new Error(details), { code, details });
}
function handle(action) {
  return async (call, cb) => {
    try {
      cb(null, await action(call.request));
    } catch (e) {
      if (!Number.isInteger(e.code)) console.error(e);
      cb({
        code: Number.isInteger(e.code) ? e.code : grpc.status.INTERNAL,
        details: Number.isInteger(e.code)
          ? e.details || e.message
          : "Internal server error",
      });
    }
  };
}
function positive(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647)
    throw fail(
      grpc.status.INVALID_ARGUMENT,
      `${label} must be a positive int32`,
    );
  return value;
}
async function listen(server, port) {
  const address = `${process.env.GRPC_HOST || "127.0.0.1"}:${process.env.GRPC_PORT || port}`;
  await new Promise((res, rej) =>
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (e) =>
      e ? rej(e) : res(),
    ),
  );
  console.log(`gRPC listening ${address}`);
}
module.exports = {
  grpc,
  service,
  client,
  call,
  fail,
  handle,
  positive,
  listen,
};
