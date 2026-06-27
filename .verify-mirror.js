// Detached restart + verification for the Stan Chat ⇄ terminal mirror.
// Launched with setsid so it survives stan-cli (and this claude session) dying
// during the restart. Logs to .stanchat-mirror-verify.log and pushes a summary.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/kay2/KAY2Tunnel';
const LOG = path.join(ROOT, '.stanchat-mirror-verify.log');
const BASE = 'http://127.0.0.1:7420';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => { try { fs.appendFileSync(LOG, a.join(' ') + '\n'); } catch {} };

(async () => {
  try { fs.writeFileSync(LOG, ''); } catch {}
  log('=== stanchat mirror verify @ ' + new Date().toISOString() + ' ===');
  await sleep(3000);

  log('-- pm2 restart stan-cli --update-env --');
  try { log(execSync('pm2 restart stan-cli --update-env 2>&1', { cwd: ROOT, timeout: 40000 }).toString().trim()); }
  catch (e) { log('restart error: ' + e.message); }

  // Read the bearer token (filesystem API + term sessions are gated by it).
  let token = '';
  try { const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^AUTH_TOKEN=(.*)$/m); if (m) token = m[1].trim().replace(/^["']|["']$/g, ''); } catch {}
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // Wait for the HTTP listener to come back.
  let up = false, tries = 0;
  for (; tries < 40; tries++) {
    try { const r = await fetch(BASE + '/api/term/sessions', { headers: H }); if (r.ok) { up = true; break; } } catch {}
    await sleep(1500);
  }
  log('-- server healthy: ' + up + ' (after ' + tries + ' polls)');

  let pass = false, detail = '';
  if (up) {
    // End-to-end: create a chat, confirm its mirror appears in the terminal list.
    let id = null;
    try {
      const r = await fetch(BASE + '/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ name: 'MirrorVerify', mode: 'plan' }) });
      id = (await r.json()).id;
      log('-- created test chat: ' + id);
    } catch (e) { log('create chat error: ' + e.message); }

    await sleep(1500);
    if (id) {
      try {
        const list = await (await fetch(BASE + '/api/term/sessions', { headers: H })).json();
        log('-- /api/term/sessions: ' + JSON.stringify(list));
        const mirror = list.find(s => s.id === 'chat:' + id);
        if (mirror && mirror.type === 'chat') { pass = true; detail = 'mirror chat:' + id.slice(0, 8) + ' present (type=chat)'; log('PASS: ' + detail); }
        else { detail = 'mirror not found for chat ' + id; log('FAIL: ' + detail); }

        // killSession guard: deleting a chat mirror via the term API must 404.
        const rk = await fetch(BASE + '/api/term/sessions/' + encodeURIComponent('chat:' + id), { method: 'DELETE', headers: H });
        log('-- DELETE mirror via term API → ' + rk.status + ' (expect 404)');

        // Cleanup: deleting the chat should unregister the mirror.
        await fetch(BASE + '/api/chat/' + id, { method: 'DELETE', headers: H });
        await sleep(800);
        const list2 = await (await fetch(BASE + '/api/term/sessions', { headers: H })).json();
        log('-- mirror removed after chat delete: ' + !list2.find(s => s.id === 'chat:' + id));
      } catch (e) { log('verify error: ' + e.message); }
    }
  }

  // Scan the error log for a require-cycle / boot crash.
  let errLines = '';
  try { errLines = execSync("tail -n 80 ~/.pm2/logs/stan-cli-error*.log 2>/dev/null | grep -iE 'cannot find|circular|is not a function|throw|ReferenceError|TypeError' | tail -n 20", { cwd: ROOT, timeout: 10000 }).toString().trim(); } catch {}
  log('-- recent error lines: ' + (errLines || '(none)'));
  log('=== done @ ' + new Date().toISOString() + ' — ' + (pass ? 'PASS' : 'CHECK LOG') + ' ===');

  try {
    const push = require(path.join(ROOT, 'server/push'));
    await push.notify({
      title: pass ? '✅ Chat⇄Terminal mirror live' : '⚠️ Mirror verify — check log',
      body: pass ? ('StanCLI restarted · ' + detail) : ('Restart done; ' + (up ? 'mirror not confirmed' : 'server slow to return') + '. See .stanchat-mirror-verify.log'),
      tag: 'mirror-verify', url: '/stanchat/', category: 'system',
    });
  } catch (e) { log('push error: ' + e.message); }
  process.exit(0);
})();
