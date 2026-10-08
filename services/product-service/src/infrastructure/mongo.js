const { MongoClient } = require("mongodb");

if (!process.env.MONGODB_URI) {
  throw new Error("Thiếu MONGODB_URI.");
}

if (!process.env.MONGODB_DATABASE) {
  throw new Error("Thiếu MONGODB_DATABASE.");
}

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
});

const db = client.db(process.env.MONGODB_DATABASE);

async function connectMongo() {
  await client.connect();
  await db.command({ ping: 1 });
}

async function closeMongo() {
  await client.close();
}

module.exports = {
  client,
  db,
  connectMongo,
  closeMongo,
};
