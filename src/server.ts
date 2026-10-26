import { createApp } from './app.js';
import { openDatabase } from './db/database.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? 'data/ledger.db';

const db = openDatabase(databasePath);
const server = createApp(db).listen(port, () => {
  console.log(`Transaction Ledger API listening on http://localhost:${port} (database: ${databasePath})`);
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
