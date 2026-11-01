import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from '../src/db/schema.js';
import { whatsappStatus } from '../src/views/whatsapp.js';

const baileys = { id: 1, name: 'Loja', whatsappMode: 'baileys' } as Client;
const cloud = { ...baileys, whatsappMode: 'cloud' } as Client;
const render = (...a: Parameters<typeof whatsappStatus>) => whatsappStatus(...a).value;

test('tela de conexão mostra cada estado', () => {
  const off = render(baileys, { state: 'desconectado' });
  assert.match(off, /Conectar WhatsApp/);
  assert.match(off, /action="\/painel\/whatsapp\/conectar"/);
  assert.doesNotMatch(off, /hx-trigger="every 2s"/, 'parado não consulta o servidor');

  const connecting = render(baileys, { state: 'conectando' });
  assert.match(connecting, /Conectando/);
  assert.match(connecting, /hx-get="\/painel\/whatsapp\/estado" hx-trigger="every 2s"/);

  const qr = render(baileys, { state: 'aguardando_qr', qr: 'X' }, '<svg id="qr-fake"></svg>');
  assert.match(qr, /<div class="qr"[^>]*><svg id="qr-fake"><\/svg><\/div>/);
  assert.match(qr, /Aparelhos conectados/);
  assert.match(qr, /hx-trigger="every 2s"/);

  const ok = render(baileys, { state: 'conectado', phone: '+5511999990000' });
  assert.match(ok, /Conectado/);
  assert.match(ok, /\(11\) 99999-0000/);
  assert.match(ok, /action="\/painel\/whatsapp\/desconectar"/);
  assert.doesNotMatch(ok, /hx-trigger="every 2s"/, 'conectado não consulta o servidor');

  const expired = render(baileys, { state: 'qr_expirado' });
  assert.match(expired, /QR expirado/);
  assert.match(expired, /Gerar novo QR/);

  const retrying = render(baileys, { state: 'reconectando', attempt: 3 });
  assert.match(retrying, /Reconectando/);
  assert.match(retrying, /Tentativa 3/);

  const loggedOut = render(baileys, { state: 'desconectado_logout' });
  assert.match(loggedOut, /Desconectado/);
  assert.match(loggedOut, /Escaneie o QR code/);
  assert.match(loggedOut, /Conectar WhatsApp/);

  const limit = render(baileys, { state: 'desconectado' }, undefined, 'Limite de conexões atingido');
  assert.match(limit, /role="alert">Limite de conexões atingido/);

  const cl = render(cloud, { state: 'desconectado' });
  assert.match(cl, /Cloud API da Meta/);
  assert.doesNotMatch(cl, /<button/);
});
