const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
let count = 0;
function visit(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(e.name)) continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) visit(file);
    else if (/\.(js|cjs)$/.test(e.name)) {
      execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
      count++;
    }
  }
}
visit(path.join(__dirname, ".."));
console.log(`${count} JavaScript files: syntax OK`);
require("./check-protos.cjs");
