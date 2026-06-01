import * as SQLite from 'expo-sqlite';

import type {
  Load,
  LoadSummary,
  Pallet,
  PendingPickerContext,
  RoboflowAnalysis,
} from './types';

export const MAX_PALLETS_PER_LOAD = 20;
const PENDING_PICKER_CONTEXT_KEY = 'pending_picker_context';

const dbPromise = SQLite.openDatabaseAsync('contador-pupunha.db');

async function getDatabase() {
  return dbPromise;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultPalletName(palletNumber: number) {
  return `Palete ${palletNumber}`;
}

export async function initDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS loads (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      note TEXT,
      total_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pallets (
      id INTEGER PRIMARY KEY NOT NULL,
      load_id INTEGER NOT NULL,
      pallet_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      original_image_base64 TEXT NOT NULL,
      ai_image_base64 TEXT,
      ai_count INTEGER NOT NULL DEFAULT 0,
      manual_count INTEGER,
      final_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      predictions_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (load_id) REFERENCES loads (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pallets_load_id ON pallets(load_id);

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const palletColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(pallets)');
  const hasPalletName = palletColumns.some((column) => column.name === 'name');

  if (!hasPalletName) {
    await db.execAsync('ALTER TABLE pallets ADD COLUMN name TEXT;');
  }

  await db.runAsync(
    "UPDATE pallets SET name = 'Palete ' || pallet_number WHERE name IS NULL OR TRIM(name) = ''",
  );
}

function parsePendingPickerContext(value: string): PendingPickerContext | null {
  try {
    const parsed = JSON.parse(value) as Partial<PendingPickerContext>;

    if (
      typeof parsed.loadId === 'number' &&
      (parsed.source === 'camera' || parsed.source === 'gallery')
    ) {
      return {
        loadId: parsed.loadId,
        source: parsed.source,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function savePendingPickerContext(context: PendingPickerContext) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `,
    PENDING_PICKER_CONTEXT_KEY,
    JSON.stringify(context),
    nowIso(),
  );
}

export async function getPendingPickerContext() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    PENDING_PICKER_CONTEXT_KEY,
  );

  if (!row) {
    return null;
  }

  const context = parsePendingPickerContext(row.value);

  if (!context) {
    await clearPendingPickerContext();
  }

  return context;
}

export async function clearPendingPickerContext() {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', PENDING_PICKER_CONTEXT_KEY);
}

export async function listLoads() {
  const db = await getDatabase();

  return db.getAllAsync<LoadSummary>(
    `
      SELECT
        l.*,
        COUNT(p.id) AS pallet_count
      FROM loads l
      LEFT JOIN pallets p ON p.load_id = l.id
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `,
  );
}

export async function getLoad(loadId: number) {
  const db = await getDatabase();
  return db.getFirstAsync<Load>('SELECT * FROM loads WHERE id = ?', loadId);
}

export async function createLoad(name: string, note: string | null) {
  const db = await getDatabase();
  const timestamp = nowIso();
  const result = await db.runAsync(
    'INSERT INTO loads (name, note, total_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    name.trim(),
    note?.trim() || null,
    timestamp,
    timestamp,
  );

  return Number(result.lastInsertRowId);
}

export async function updateLoad(loadId: number, name: string, note: string | null) {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE loads SET name = ?, note = ?, updated_at = ? WHERE id = ?',
    name.trim(),
    note?.trim() || null,
    nowIso(),
    loadId,
  );
}

export async function deleteLoad(loadId: number) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM loads WHERE id = ?', loadId);
}

export async function listPallets(loadId: number) {
  const db = await getDatabase();
  return db.getAllAsync<Pallet>(
    'SELECT * FROM pallets WHERE load_id = ? ORDER BY pallet_number ASC, id ASC',
    loadId,
  );
}

export async function getPallet(palletId: number) {
  const db = await getDatabase();
  return db.getFirstAsync<Pallet>('SELECT * FROM pallets WHERE id = ?', palletId);
}

export async function createProcessingPallet(
  loadId: number,
  originalImageBase64: string,
  name?: string,
) {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number; next_number: number }>(
    'SELECT COUNT(*) AS count, COALESCE(MAX(pallet_number), 0) + 1 AS next_number FROM pallets WHERE load_id = ?',
    loadId,
  );

  if ((existing?.count ?? 0) >= MAX_PALLETS_PER_LOAD) {
    throw new Error(`Cada carga aceita no máximo ${MAX_PALLETS_PER_LOAD} paletes.`);
  }

  const palletNumber = existing?.next_number ?? 1;
  const timestamp = nowIso();
  const result = await db.runAsync(
    `
      INSERT INTO pallets (
        load_id,
        pallet_number,
        name,
        original_image_base64,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'processing', ?, ?)
    `,
    loadId,
    palletNumber,
    name?.trim() || defaultPalletName(palletNumber),
    originalImageBase64,
    timestamp,
    timestamp,
  );

  return Number(result.lastInsertRowId);
}

export async function savePalletAnalysis(
  palletId: number,
  loadId: number,
  analysis: RoboflowAnalysis,
) {
  const db = await getDatabase();
  const timestamp = nowIso();

  await db.runAsync(
    `
      UPDATE pallets
      SET
        ai_image_base64 = ?,
        ai_count = ?,
        final_count = COALESCE(manual_count, ?),
        predictions_json = ?,
        status = 'done',
        error_message = NULL,
        updated_at = ?
      WHERE id = ?
    `,
    analysis.outputImageBase64,
    analysis.count,
    analysis.count,
    JSON.stringify(analysis.predictions),
    timestamp,
    palletId,
  );

  await recalculateLoadTotal(loadId);
}

export async function markPalletError(palletId: number, loadId: number, message: string) {
  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE pallets
      SET status = 'error', error_message = ?, updated_at = ?
      WHERE id = ?
    `,
    message,
    nowIso(),
    palletId,
  );

  await recalculateLoadTotal(loadId);
}

export async function updatePalletManualCount(
  palletId: number,
  loadId: number,
  manualCount: number | null,
) {
  const db = await getDatabase();
  const pallet = await getPallet(palletId);

  if (!pallet) {
    return;
  }

  const finalCount = manualCount ?? pallet.ai_count;

  await db.runAsync(
    `
      UPDATE pallets
      SET manual_count = ?, final_count = ?, updated_at = ?
      WHERE id = ?
    `,
    manualCount,
    finalCount,
    nowIso(),
    palletId,
  );

  await recalculateLoadTotal(loadId);
}

export async function updatePalletName(palletId: number, name: string) {
  const db = await getDatabase();
  const pallet = await getPallet(palletId);

  if (!pallet) {
    return;
  }

  await db.runAsync(
    'UPDATE pallets SET name = ?, updated_at = ? WHERE id = ?',
    name.trim() || defaultPalletName(pallet.pallet_number),
    nowIso(),
    palletId,
  );
}

export async function resetPalletForProcessing(palletId: number) {
  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE pallets
      SET status = 'processing', error_message = NULL, updated_at = ?
      WHERE id = ?
    `,
    nowIso(),
    palletId,
  );
}

export async function deletePallet(palletId: number, loadId: number) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM pallets WHERE id = ?', palletId);

  const pallets = await listPallets(loadId);
  for (let index = 0; index < pallets.length; index += 1) {
    await db.runAsync(
      'UPDATE pallets SET pallet_number = ?, updated_at = ? WHERE id = ?',
      index + 1,
      nowIso(),
      pallets[index].id,
    );
  }

  await recalculateLoadTotal(loadId);
}

export async function recalculateLoadTotal(loadId: number) {
  const db = await getDatabase();
  await db.runAsync(
    `
      UPDATE loads
      SET
        total_count = (
          SELECT COALESCE(SUM(final_count), 0)
          FROM pallets
          WHERE load_id = ?
        ),
        updated_at = ?
      WHERE id = ?
    `,
    loadId,
    nowIso(),
    loadId,
  );
}
