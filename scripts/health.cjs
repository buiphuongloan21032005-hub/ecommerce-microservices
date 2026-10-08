const { client, call } = require("../shared/rpc");
const name = process.argv[2];
async function main() {
  if (name === "gateway") {
    const r = await fetch("http://127.0.0.1:3002/api/health", {
      signal: AbortSignal.timeout(6500),
    });
    if (!r.ok) throw Error("Gateway unhealthy");
    return;
  }
  const c = client(name, `127.0.0.1:${process.env.GRPC_PORT}`);
  try {
    const r = await call(c, "Health", {}, 5000);
    if (r.status !== "UP") throw Error("Unhealthy");
  } finally {
    c.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
