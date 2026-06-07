/* MacPiOs / KAY2Tunnel — Passkey (WebAuthn) login.
 *
 * Adds passwordless Face ID / Touch ID sign-in on top of the existing shared
 * AUTH_TOKEN, WITHOUT replacing it:
 *   - Enrollment endpoints sit behind the normal bearerAuth gate — you register
 *     a passkey only AFTER you've logged in once with the token. That token is
 *     the trust bootstrap that binds a device's passkey to this account.
 *   - Login endpoints are public (they ARE the login). On a valid assertion the
 *     server hands back the AUTH_TOKEN, which the client caches as `stan_token`
 *     exactly like the password path — so /api + /ws keep working unchanged.
 *
 * The credential private key never leaves the device (and syncs across the
 * user's Apple devices via iCloud Keychain). We only store the PUBLIC key.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');
const { AUTH_TOKEN } = require('./config');

// Relying-Party identity. RP_ID must be a registrable suffix of every origin
// the lock screen is served from; spikeradar.co.uk covers both subdomains.
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'MacPiOs';
const RP_ID   = process.env.WEBAUTHN_RP_ID   || 'spikeradar.co.uk';
const ORIGINS = (process.env.WEBAUTHN_ORIGINS ||
  'https://kay2os.spikeradar.co.uk,https://stan.spikeradar.co.uk')
  .split(',').map(s => s.trim()).filter(Boolean);

// Single operator ("Kane"); a stable user handle is all WebAuthn needs.
const USER_NAME = process.env.WEBAUTHN_USER || 'kane';
const USER_ID = new TextEncoder().encode('macpios:' + USER_NAME);

const STORE = path.join(__dirname, 'passkeys.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return []; }
}
function save(creds) {
  fs.writeFileSync(STORE, JSON.stringify(creds, null, 2));
}
function hasPasskeys() { return load().length > 0; }

// Single-user in-memory challenge slots (expire after 5 min). A registration or
// login flow is one quick round-trip, so a slot per kind is plenty.
const challenges = { register: null, auth: null };
function setChallenge(kind, value) { challenges[kind] = { value, at: Date.now() }; }
function takeChallenge(kind) {
  const c = challenges[kind];
  challenges[kind] = null;
  if (!c || Date.now() - c.at > 5 * 60 * 1000) return null;
  return c.value;
}

// ---- ENROLLMENT (gated by bearerAuth upstream) --------------------------------
const registerRouter = express.Router();

registerRouter.get('/register/options', async (req, res) => {
  try {
    const creds = load();
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: USER_ID, userName: USER_NAME, userDisplayName: 'Kane',
      attestationType: 'none',
      excludeCredentials: creds.map(c => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    setChallenge('register', options.challenge);
    res.json(options);
  } catch (e) { res.status(500).json({ error: 'register options failed: ' + e.message }); }
});

registerRouter.post('/register/verify', express.json({ limit: '64kb' }), async (req, res) => {
  const expectedChallenge = takeChallenge('register');
  if (!expectedChallenge) return res.status(400).json({ error: 'challenge expired — retry' });
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'verification failed' });
    }
    const { credential } = verification.registrationInfo;
    const creds = load();
    if (!creds.some(c => c.id === credential.id)) {
      creds.push({
        id: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: req.body?.response?.transports || [],
        label: String(req.body?.label || 'Passkey').slice(0, 40),
        createdAt: new Date().toISOString(),
      });
      save(creds);
    }
    res.json({ verified: true, count: creds.length });
  } catch (e) { res.status(400).json({ error: 'register verify failed: ' + e.message }); }
});

registerRouter.get('/credentials', (req, res) => {
  res.json({ credentials: load().map(c => ({ label: c.label, createdAt: c.createdAt })) });
});

// ---- LOGIN (public — this is the sign-in) -------------------------------------
const authRouter = express.Router();

// Lets the lock screen decide whether to show the passkey button.
authRouter.get('/status', (req, res) => res.json({ enrolled: hasPasskeys() }));

authRouter.get('/auth/options', async (req, res) => {
  const creds = load();
  if (!creds.length) return res.status(404).json({ error: 'no passkeys enrolled' });
  try {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: creds.map(c => ({ id: c.id, transports: c.transports })),
      userVerification: 'preferred',
    });
    setChallenge('auth', options.challenge);
    res.json(options);
  } catch (e) { res.status(500).json({ error: 'auth options failed: ' + e.message }); }
});

authRouter.post('/auth/verify', express.json({ limit: '64kb' }), async (req, res) => {
  const expectedChallenge = takeChallenge('auth');
  if (!expectedChallenge) return res.status(400).json({ error: 'challenge expired — retry' });
  const creds = load();
  const cred = creds.find(c => c.id === req.body?.id);
  if (!cred) return res.status(400).json({ error: 'unknown credential' });
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return res.status(401).json({ error: 'assertion failed' });
    // Persist the rolling signature counter (Apple passkeys stay at 0).
    cred.counter = verification.authenticationInfo.newCounter;
    save(creds);
    // Hand back the same shared token the password flow grants.
    res.json({ verified: true, token: AUTH_TOKEN });
  } catch (e) { res.status(401).json({ error: 'auth verify failed: ' + e.message }); }
});

module.exports = { authRouter, registerRouter, hasPasskeys, RP_ID, ORIGINS };
