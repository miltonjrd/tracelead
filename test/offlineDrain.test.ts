import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAIN_MAX_REQUESTS, DRAIN_QUIET_MS, drainOfflineBatches, type DrainSocket } from '../src/services/offlineDrain.js';
import { FakeTimers, settle, silentLog } from './fakeWhatsApp.js';

function setup() {
  const handlers = new Map<string, (() => void)[]>();
  const sent: unknown[] = [];
  const sock: DrainSocket = {
    ws: { on: (e, fn) => void handlers.set(e, [...(handlers.get(e) ?? []), fn]) },
    sendNode: async (n) => void sent.push(n),
  };
  const timers = new FakeTimers();
  const log = silentLog();
  drainOfflineBatches(sock, log, timers.schedule);
  const emit = (e: string) => handlers.get(e)?.forEach((fn) => fn());
  return { sent, timers, log, emit };
}

test('pede o próximo lote enquanto o fim da fila offline não chega', async () => {
  const { sent, timers, emit } = setup();
  emit('CB:ib,,offline_preview');
  await timers.advance(DRAIN_QUIET_MS);
  assert.equal(sent.length, 1);
  await timers.advance(DRAIN_QUIET_MS);
  assert.equal(sent.length, 2);
});

test('frames chegando adiam o pedido', async () => {
  const { sent, timers, emit } = setup();
  emit('CB:ib,,offline_preview');
  await timers.advance(DRAIN_QUIET_MS - 1000);
  emit('frame');
  await timers.advance(DRAIN_QUIET_MS - 1000);
  assert.equal(sent.length, 0);
  await timers.advance(1000);
  assert.equal(sent.length, 1);
});

test('o marcador de fim da fila encerra os pedidos', async () => {
  const { sent, timers, log, emit } = setup();
  emit('CB:ib,,offline_preview');
  await timers.advance(DRAIN_QUIET_MS);
  emit('CB:ib,,offline');
  await timers.advance(DRAIN_QUIET_MS * 3);
  assert.equal(sent.length, 1);
  assert.deepEqual(log.infos[0], { extraBatches: 1, afterSec: 0 });
});

test('fila que termina sem lotes extras também é registrada', () => {
  const { log, emit } = setup();
  emit('CB:ib,,offline_preview');
  emit('CB:ib,,offline');
  assert.deepEqual(log.infos[0], { extraBatches: 0, afterSec: 0 });
});

test('marcador sem preview anterior não registra nada', () => {
  const { log, emit } = setup();
  emit('CB:ib,,offline');
  assert.equal(log.infos.length, 0);
});

test('para no limite de pedidos', async () => {
  const { sent, timers, log, emit } = setup();
  emit('CB:ib,,offline_preview');
  await timers.advance(DRAIN_QUIET_MS * (DRAIN_MAX_REQUESTS + 5));
  await settle();
  assert.equal(sent.length, DRAIN_MAX_REQUESTS);
  assert.equal(log.warns.length, 1);
});

test('sem fila offline pendente nada é pedido', async () => {
  const { sent, timers } = setup();
  await timers.advance(DRAIN_QUIET_MS * 3);
  assert.equal(sent.length, 0);
});
