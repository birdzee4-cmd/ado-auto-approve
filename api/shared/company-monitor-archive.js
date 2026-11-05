const { createHash, randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { TableClient } = require('@azure/data-tables');
const monitor = require('./company-deployment-monitor');
const { eventKey } = require('./company-monitor-tracking');
const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function validDay(day) { try { return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day; } catch { return false; } }
function today(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
function sourceDay(item) {
  const day = item.updatedAt.slice(0, 10);
  if (!day || !validDay(day) || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('Invalid source timestamp');
  return day;
}
function identity(raw) { return hash(canonical([raw.Branch.toLowerCase().trim(), raw.BuildId])); }
function createStore(table) {
  let ready;
  async function ensure() {
    if (!ready) ready = table.createTable().catch(error => { if (error.statusCode !== 409) { ready = null; throw error; } });
    await ready;
  }
  async function get(partitionKey, rowKey) { try { return await table.getEntity(partitionKey, rowKey); } catch (error) { if (error.statusCode === 404) return null; throw error; } }
  async function readSnapshot(id) {
    const meta = await get('snapshot-' + id, 'meta');
    if (!meta?.complete) throw new Error('Incomplete archive snapshot');
    const chunks = [];
    for (let index = 0; index < meta.chunks; index++) {
      const chunk = await get('snapshot-' + id, 'chunk-' + String(index).padStart(5, '0'));
      if (!chunk) throw new Error('Missing archive chunk'); chunks.push(chunk.data);
    }
    const json = gunzipSync(Buffer.from(chunks.join(''), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
    if (hash(json) !== id) throw new Error('Archive integrity check failed');
    return JSON.parse(json);
  }
  async function saveSnapshot(snapshot) {
    const json = canonical(snapshot), id = hash(json);
    if ((await get('snapshot-' + id, 'meta'))?.complete) return id;
    const data = gzipSync(json).toString('base64');
    const chunks = Math.ceil(data.length / 24000);
    for (let index = 0; index < chunks; index++) {
      await table.upsertEntity({ partitionKey: 'snapshot-' + id, rowKey: 'chunk-' + String(index).padStart(5, '0'), data: data.slice(index * 24000, (index + 1) * 24000) }, 'Replace');
    }
    await table.upsertEntity({ partitionKey: 'snapshot-' + id, rowKey: 'meta', chunks, complete: true, encoding: 'gzip-base64', schemaVersion: 1 }, 'Replace');
    return id;
  }
  async function saveEvents(records, index = new Map()) {
    // Append only semantic status observations; duration-only changes are deduplicated.
    const pending = new Map();
    for (const record of records) {
      const item = record.item;
      const day = sourceDay(item);
      if (!index.has(day)) index.set(day, new Set((await readEvents(day)).map(eventKey)));
      const keys = index.get(day);
      const entity = { partitionKey: 'events-' + day, rowKey: eventKey(item),
        item: JSON.stringify(item), observedAt: record.lastChangedObservedAt || record.firstObservedAt, origin: 'snapshot' };
      if (keys.has(entity.rowKey)) continue;
      keys.add(entity.rowKey);
      if (!pending.has(day)) pending.set(day, []);
      pending.get(day).push(entity);
    }
    for (const entities of pending.values()) {
      for (let offset = 0; offset < entities.length; offset += 100) {
        const batch = entities.slice(offset, offset + 100);
        if (table.submitTransaction) {
          try { await table.submitTransaction(batch.map(entity => ['create', entity])); continue; } catch (error) { if (error.statusCode !== 409) throw error; }
        }
        for (const entity of batch) { try { await table.createEntity(entity); } catch (error) { if (error.statusCode !== 409) throw error; } }
      }
    }
  }
  async function readEvents(day) {
    if (!validDay(day)) throw new Error('Invalid date');
    await ensure();
    const events = [];
    for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq 'events-${day}'` } })) {
      events.push({ ...JSON.parse(entity.item), observedAt: entity.observedAt });
    }
    return events;
  }
  async function backfillEvents() {
    await ensure();
    const ids = new Map();
    for await (const poll of table.listEntities({ queryOptions: { filter: "PartitionKey ge 'polls-' and PartitionKey lt 'polls.'" } })) {
      if (!poll.snapshots) continue;
      for (const entry of JSON.parse(poll.snapshots)) if (!ids.has(entry.snapshotId)) ids.set(entry.snapshotId, entry.day);
    }
    // Include a complete daily snapshot even if its poll failed after publishing the pointer.
    for await (const pointer of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'days'" } })) ids.set(pointer.snapshotId, pointer.rowKey);
    let snapshots = 0;
    const index = new Map();
    for (const id of ids.keys()) { await saveEvents((await readSnapshot(id)).records, index); snapshots++; }
    return { snapshots };
  }
  async function read(day) {
    if (!validDay(day)) throw new Error('Invalid date');
    await ensure();
    const [pointer, health] = await Promise.all([get('days', day), get('system', 'health')]);
    const snapshot = pointer ? await readSnapshot(pointer.snapshotId) : null;
    return { items: snapshot ? snapshot.records.map(record => ({ ...record.item, firstObservedAt: record.firstObservedAt, lastChangedObservedAt: record.lastChangedObservedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [],
      archive: { date: day, snapshotId: pointer?.snapshotId || '', savedAt: pointer?.savedAt || '', firstCollectedAt: pointer?.firstCollectedAt || '', latestPollSourceRows: pointer?.latestPollSourceRows ?? null,
        lastAttemptAt: health?.lastAttemptAt || '', lastSuccessAt: health?.lastSuccessAt || '', lastAttemptStatus: health?.status || 'not-started', collectionStartedAt: health?.collectionStartedAt || '', intervalMinutes: 1,
        note: 'ประวัติตามวัน LastUpdate จาก Monitor (สมมติเวลาไทย) รวมรายการที่เคยพบ ไม่ลบเมื่อ API หยุดส่ง; เก็บสถานะที่ตรวจพบทุก 1 นาที อาจไม่ครบทุกรายการก่อนเริ่มเก็บหรือการเปลี่ยนแปลงระหว่างรอบ' } };
  }
  async function collect(raw, observedAt = new Date().toISOString()) {
    await ensure();
    const pollId = observedAt.replace(/[:.]/g, '-') + '-' + randomUUID();
    const poll = { partitionKey: 'polls-' + today(new Date(observedAt)), rowKey: pollId, observedAt, status: 'running', schemaVersion: 1 };
    const previousHealth = await get('system', 'health');
    const health = { partitionKey: 'system', rowKey: 'health', collectionStartedAt: previousHealth?.collectionStartedAt || observedAt, lastSuccessAt: previousHealth?.lastSuccessAt || '', lastAttemptAt: observedAt, status: 'running' };
    await table.upsertEntity(poll, 'Replace');
    await table.upsertEntity(health, 'Replace');
    try {
      const payload = typeof raw === 'function' ? await raw() : raw;
      monitor.normalize(payload); // Validate the whole response before publishing any day.
      const byDay = new Map(), seen = new Set();
      for (const source of payload) {
        const item = monitor.normalize([source])[0], day = sourceDay(item), key = identity(source);
        if (!source.BuildId.trim() || seen.has(key)) throw new Error('Duplicate or empty source identity');
        seen.add(key);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ key, raw: source, item });
      }
      const saved = [];
      for (const [day, incoming] of byDay) {
        const pointer = await get('days', day);
        const previous = pointer ? await readSnapshot(pointer.snapshotId) : { records: [] };
        const beforeByKey = new Map(previous.records.map(record => [record.key, record]));
        const records = new Map(beforeByKey);
        for (const entry of incoming) {
          const old = records.get(entry.key);
          if (old && canonical(old.raw) === canonical(entry.raw)) continue;
          records.set(entry.key, { ...entry, firstObservedAt: old?.firstObservedAt || observedAt, lastChangedObservedAt: observedAt });
        }
        const snapshotId = await saveSnapshot({ schemaVersion: 1, day, records: [...records.values()].sort((a, b) => a.key.localeCompare(b.key)) });
        const changed = incoming.filter(entry => {
          const before = beforeByKey.get(entry.key);
          return !before || eventKey(before.item) !== eventKey(entry.item);
        }).map(entry => records.get(entry.key));
        await saveEvents(changed);
        const entity = { partitionKey: 'days', rowKey: day, snapshotId, savedAt: observedAt, firstCollectedAt: pointer?.firstCollectedAt || observedAt, latestPollSourceRows: incoming.length, itemCount: records.size };
        if (pointer) await table.updateEntity(entity, 'Replace', { etag: pointer.etag });
        else await table.createEntity(entity);
        saved.push({ day, snapshotId, itemCount: records.size, sourceRows: incoming.length });
      }
      // Poll references retain each observed snapshot even after the daily pointer advances.
      await table.upsertEntity({ ...poll, status: 'succeeded', completedAt: new Date().toISOString(), rowCount: payload.length, snapshots: JSON.stringify(saved) }, 'Replace');
      await table.upsertEntity({ ...health, status: 'succeeded', lastSuccessAt: observedAt, rowCount: payload.length }, 'Replace');
      return { pollId, observedAt, rowCount: payload.length, days: saved };
    } catch (error) {
      await table.upsertEntity({ ...poll, status: 'failed', completedAt: new Date().toISOString(), error: 'Collection failed; check application logs' }, 'Replace');
      await table.upsertEntity({ ...health, status: 'failed' }, 'Replace');
      throw error;
    }
  }
  return { read, collect, readSnapshot, readEvents, backfillEvents };
}
let instance;
function store() {
  if (!instance) {
    const connection = process.env.COMPANY_MONITOR_STORAGE_CONNECTION_STRING || process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
    if (!connection) throw new Error('Missing company monitor storage configuration');
    instance = createStore(TableClient.fromConnectionString(connection, process.env.COMPANY_MONITOR_ARCHIVE_TABLE || 'CompanyDeploymentArchive'));
  }
  return instance;
}
module.exports = { createStore, store, validDay, today, canonical };
