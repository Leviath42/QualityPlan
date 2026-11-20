import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { openDb, type Db } from '../src/db.js';
import { buildApp } from '../src/app.js';
import bcrypt from 'bcryptjs';
import { resetRateLimits } from '../src/auth/security.js';

const ADMIN_EMAIL = 'n.notamy@gmail.com';
const ADMIN_PASS = 'AdminPass123!';

let server: Server;
let base: string;
let db: Db;

async function j(
  method: string,
  url: string,
  body?: unknown,
  cookie?: string | null
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function login(email: string, password: string, totpCode?: string): Promise<Response> {
  return j('POST', '/api/auth/login', { email, password, ...(totpCode ? { totpCode } : {}) });
}

before(async () => {
  resetRateLimits();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-auth-'));
  db = openDb(path.join(dir, 'test.db'));
  db.prepare('INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES (?, ?, ?, ?, ?)')
    .run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASS, bcrypt.genSaltSync(10)), 'admin', 'Nicolas', 'Notamy');
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run('reader@test.local', bcrypt.hashSync('ReaderPass1!', bcrypt.genSaltSync(10)), 'reader');
  const app: Express = buildApp(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('health reste public (pas de session requise)', async () => {
  const r = await j('GET', '/api/health');
  assert.equal(r.status, 200);
});

test('API metier refuse sans session (401)', async () => {
  const r = await j('GET', '/api/lines', undefined, null);
  assert.equal(r.status, 401);
});

test('login avec mauvais mot de passe -> 401 + audit login_echec', async () => {
  const r = await login(ADMIN_EMAIL, 'MauvaisPass1!');
  assert.equal(r.status, 401);
  const log = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login_echec'").get() as { n: number };
  assert.ok(log.n >= 1, 'audit login_echec attendu');
});

test('login admin OK -> cookie + /me + acces API', async () => {
  resetRateLimits();
  const r = await login(ADMIN_EMAIL, ADMIN_PASS);
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /qp_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(';')[0];
  const body = (await r.json()) as { email: string; role: string };
  assert.equal(body.email, ADMIN_EMAIL);
  assert.equal(body.role, 'admin');

  const me = await j('GET', '/api/auth/me', undefined, cookie);
  assert.equal(me.status, 200);
  const meBody = (await me.json()) as { email: string; role: string; first_name: string };
  assert.equal(meBody.email, ADMIN_EMAIL);
  assert.equal(meBody.role, 'admin');
  assert.equal(meBody.first_name, 'Nicolas');

  const lines = await j('GET', '/api/lines', undefined, cookie);
  assert.equal(lines.status, 200);
});

test('login requete invalide -> 422', async () => {
  resetRateLimits();
  const r = await j('POST', '/api/auth/login', { email: 'pas-un-email', password: '' });
  assert.equal(r.status, 422);
});

test('mutation refusee pour un reader (403), Autorisee pour admin (pas 401/403)', async () => {
  resetRateLimits();
  const admin = await login(ADMIN_EMAIL, ADMIN_PASS);
  const adminCookie = (admin.headers.get('set-cookie') ?? '').split(';')[0];
  const reader = await login('reader@test.local', 'ReaderPass1!');
  const readerCookie = (reader.headers.get('set-cookie') ?? '').split(';')[0];

  // reader : lecture OK, mutation 403
  const read = await j('GET', '/api/lines', undefined, readerCookie);
  assert.equal(read.status, 200);
  const mutate = await j('POST', '/api/lines', { name: 'X' }, readerCookie);
  assert.equal(mutate.status, 403);

  // admin : pas de 401/403 sur mutation meme si validation metier peut refuser (422)
  const adminMut = await j('POST', '/api/lines', { name: 'X' }, adminCookie);
  assert.ok([200, 201, 400, 409, 422].includes(adminMut.status), 'statut inattendu: ' + adminMut.status);
});

test('logout invalide la session', async () => {
  resetRateLimits();
  const r = await login(ADMIN_EMAIL, ADMIN_PASS);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const out = await j('POST', '/api/auth/logout', {}, cookie);
  assert.equal(out.status, 200);
  const me = await j('GET', '/api/auth/me', undefined, cookie);
  assert.equal(me.status, 401);
});

test('change-password : mauvais mdp actuel -> 401, succes -> session fermee, nouveau mdp fonctionnel', async () => {
  resetRateLimits();
  const r = await login(ADMIN_EMAIL, ADMIN_PASS);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];

  const bad = await j('POST', '/api/auth/change-password', { currentPassword: 'Faux1!', newPassword: 'NouveauPass123!' }, cookie);
  assert.equal(bad.status, 401);

  const ok = await j('POST', '/api/auth/change-password', { currentPassword: ADMIN_PASS, newPassword: 'NouveauPass123!' }, cookie);
  assert.equal(ok.status, 200);
  const me = await j('GET', '/api/auth/me', undefined, cookie);
  assert.equal(me.status, 401);

  const reLogin = await login(ADMIN_EMAIL, 'NouveauPass123!');
  assert.equal(reLogin.status, 200);
});

test('rate limit : 11e tentative -> 429', async () => {
  resetRateLimits();
  for (let i = 0; i < 10; i++) {
    const r = await login(ADMIN_EMAIL, 'FauxPass' + i + '!');
    assert.equal(r.status, 401, 'tentative ' + i);
  }
  const r11 = await login(ADMIN_EMAIL, ADMIN_PASS);
  assert.equal(r11.status, 429);
});

test('CSRF : mutation cross-origin refusee (403)', async () => {
  resetRateLimits();
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  assert.equal(r.status, 403);
});
