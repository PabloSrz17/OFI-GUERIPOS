const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { dbPath } = require('../config');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
// WAL: lecturas del tablero no bloquean escrituras del mostrador.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
require('./migraciones')(db);

module.exports = db;
