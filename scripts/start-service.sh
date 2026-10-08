#!/bin/sh
set -eu
if [ -f prisma/schema.prisma ]; then
 npx prisma migrate deploy
 if [ -f prisma/seed.cjs ]; then node prisma/seed.cjs; fi
fi
exec node src/server.js
