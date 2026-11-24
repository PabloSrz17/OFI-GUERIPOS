const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { dbPath } = require('../config');

// Abrir la base aplica el esquema y las migraciones: una prueba sin DB_PATH modificaría la real.
if (process.env.NODE_TEST_CONTEXT && !process.env.DB_PATH) throw new Error('Una prueba intentó abrir la base real: define DB_PATH');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
// WAL: lecturas del tablero no bloquean escrituras del mostrador.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
require('./migraciones')(db);

module.exports = db;
