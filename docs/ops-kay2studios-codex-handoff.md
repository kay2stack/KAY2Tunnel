# Codex Handoff: ops.kay2studios.xyz

## Mission

Restore, inspect, redesign, secure, test, and document the KAY2 Studios operations dashboard running from the ASUS NUC.

Target: `https://ops.kay2studios.xyz`

This is the first-priority KAY2 Studios application. Do not work on other sites until the Ops dashboard is healthy and the work below is complete.

The intended result is a premium dark operations console for monitoring and controlling KAY2 Studios websites, analytics, infrastructure, alerts, backups, and security. Preserve working functionality and real data. Do not replace real metrics with demo values.

## Critical operating rules

1. Start with discovery. Do not assume the app path, framework, process manager, port, database, or tunnel configuration.
2. Do not print, commit, paste, or log secrets, API tokens, cookies, private keys, Cloudflare credentials, database URLs, or `.env` contents.
3. Do not delete databases, volumes, logs, backups, systemd services, PM2 processes, containers, tunnel definitions, or DNS records.
4. Before editing, create a timestamped backup and a Git branch.
5. Preserve all existing dashboard capabilities unless they are proven broken, unsafe, or explicitly obsolete.
6. Use real application data. Empty states are acceptable; invented production metrics are not.
7. Keep the origin private. Public traffic should reach the app through Cloudflare, not through an exposed NUC port.
8. Record every material change in an audit-friendly implementation report.

---

## Phase 1: Discover the real deployment

Create a working report named `OPS_DISCOVERY_REPORT.md` in the actual Ops app repository. Redact sensitive values.

Run the following non-destructive checks from the NUC:

```bash
set -u
printf '\n== HOST ==\n'
hostnamectl 2>/dev/null || hostname
uptime
uname -a

printf '\n== NETWORK ==\n'
ip -brief address 2>/dev/null || true
tailscale status 2>/dev/null || true

printf '\n== LISTENING PORTS ==\n'
ss -lntup 2>/dev/null || sudo ss -lntup

printf '\n== CLOUDFLARED ==\n'
systemctl status cloudflared --no-pager 2>/dev/null || true
systemctl is-enabled cloudflared 2>/dev/null || true
journalctl -u cloudflared -n 120 --no-pager 2>/dev/null || true

printf '\n== PM2 ==\n'
pm2 list 2>/dev/null || true
pm2 jlist 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.map(x=>({name:x.name,pid:x.pid,status:x.pm2_env?.status,cwd:x.pm2_env?.pm_cwd,script:x.pm2_env?.pm_exec_path}))) }catch{}})'

printf '\n== CONTAINERS ==\n'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true
podman ps 2>/dev/null || true

printf '\n== SERVICES LIKELY RELATED TO OPS ==\n'
systemctl list-units --type=service --all --no-pager | grep -Ei 'ops|kay2|node|next|vite|docker|caddy|nginx|cloudflared' || true

printf '\n== REPOSITORY SEARCH ==\n'
find "$HOME" /opt /srv /var/www -maxdepth 5 -type d -name .git 2>/dev/null | sed 's#/.git$##' | sort -u

printf '\n== DOMAIN REFERENCE SEARCH ==\n'
for root in "$HOME" /opt /srv /var/www; do
  [ -d "$root" ] || continue
  grep -RIl --exclude-dir=node_modules --exclude-dir=.git --exclude='*.log' 'ops.kay2studios.xyz' "$root" 2>/dev/null | head -100
done
```

Identify and record:

- App repository/path
- Git remote and branch
- Framework and package manager
- Production build/start commands
- Process manager or systemd unit
- Local bind address and port
- Database type and storage path, without exposing credentials
- Cloudflare Tunnel name/ID and config path, with credentials redacted
- Reverse proxy, if any
- Current authentication method
- Current analytics data source
- Existing backup method
- Existing health-check method
- Current errors from app, tunnel, proxy, and browser console

Do not proceed to destructive or architectural changes until this map exists.

---

## Phase 2: Restore public availability

The app was externally unreachable when this handoff was written. Determine whether the cause is DNS, Cloudflare Tunnel, local service failure, incorrect ingress, certificate/TLS, firewall, or application startup.

### Local checks

Replace `<PORT>` after discovery:

```bash
curl -fsS -D- http://127.0.0.1:<PORT>/ -o /tmp/ops-home.html
curl -fsS http://127.0.0.1:<PORT>/api/health 2>/dev/null || true
```

If the service is managed by systemd:

```bash
sudo systemctl restart <OPS_SERVICE>
sudo systemctl status <OPS_SERVICE> --no-pager
journalctl -u <OPS_SERVICE> -n 160 --no-pager
```

If managed by PM2:

```bash
pm2 restart <OPS_PROCESS>
pm2 logs <OPS_PROCESS> --lines 160 --nostream
pm2 save
```

If containerised:

```bash
docker compose ps
docker compose logs --tail=160
docker compose up -d --build
```

### Cloudflare Tunnel checks

Locate the real config. Common locations include `/etc/cloudflared/config.yml` and `~/.cloudflared/config.yml`.

```bash
sudo cloudflared tunnel ingress validate 2>/dev/null || cloudflared tunnel ingress validate
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
journalctl -u cloudflared -n 160 --no-pager
```

The ingress rule for `ops.kay2studios.xyz` must point to the correct private local service, preferably `http://127.0.0.1:<PORT>`. Keep the final catch-all rule.

Example shape only; do not overwrite a working config blindly:

```yaml
ingress:
  - hostname: ops.kay2studios.xyz
    service: http://127.0.0.1:<PORT>
  - service: http_status:404
```

Verify:

```bash
curl -I https://ops.kay2studios.xyz
curl -fsS https://ops.kay2studios.xyz/api/health 2>/dev/null || true
```

Do not expose `<PORT>` on the public internet. Bind to localhost where possible and restrict host firewall rules.

---

## Phase 3: Protect the current app before redesigning

From the discovered repository:

```bash
cd <OPS_APP_PATH>
git status --short --branch
git remote -v
git rev-parse --show-toplevel
```

If there are uncommitted user changes, preserve them. Do not discard them.

Create a backup outside the working tree:

```bash
stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$HOME/backups/ops-kay2studios/$stamp"
mkdir -p "$backup_dir"
git bundle create "$backup_dir/repository.bundle" --all
```

Back up the database using the correct engine. Do not copy a live database unsafely; use its supported backup mechanism.

Create a branch:

```bash
git switch -c codex/ops-ui-security-$(date +%Y%m%d)
```

Run the existing test/build commands and save the baseline result in `OPS_IMPLEMENTATION_REPORT.md`.

---

## Phase 4: UI redesign specification

### Design direction

Build a premium, compact operations console rather than a generic template dashboard.

Visual character:

- Near-black/navy foundation
- Restrained red KAY2 accent for brand and destructive/offline states
- Green for healthy/online states
- Blue for analytics and informational states
- Purple for uptime/infrastructure metrics
- Amber for warnings
- Crisp typography, subtle borders, controlled glow, minimal gradients
- Dense enough for operations work, but not cramped
- Fast and highly readable on iPhone, tablet, desktop, and ultrawide displays

Avoid:

- Huge empty hero sections
- Excessive glassmorphism
- Random neon decoration
- Fake charts or static demo numbers
- Tiny inaccessible text
- Horizontally scrolling desktop tables on mobile
- Red used for normal navigation text

### Core layout

Desktop:

- Fixed or sticky left sidebar, approximately 220-250px
- Main content with a compact top command bar
- Responsive 12-column content grid
- Bottom or secondary system-health strip where useful

Mobile:

- Compact top bar with KAY2 Ops branding, current status, notifications, and menu
- Sidebar becomes a sheet/drawer
- Metric cards become a horizontally scrollable snap row or a two-column grid
- Site table becomes stacked site cards with essential actions
- Charts remain readable at 320px width
- Minimum touch target 44px

### Navigation

Use this information architecture unless the existing product requires additional sections:

1. Overview
2. Sites
3. Analytics
4. Alerts
5. Logs
6. Security
7. Backups
8. Users / Access
9. Settings

Show the signed-in operator at the bottom of the sidebar. Display role clearly.

### Top command bar

Include:

- Page title and concise context
- Global system status pill
- Search/command palette trigger
- Notification centre
- Theme control only if both themes are fully supported
- Account/session menu

### Overview page

Top KPI cards:

- Total sites
- Online
- Offline/degraded
- Visits in selected period
- Average uptime
- Active alerts, if available

Each card should include context such as change from previous period, percentage of fleet, or last updated time. Do not fabricate comparisons when the backend does not have historical data.

Main content:

- Site Status panel
- Real-time Analytics chart
- Top Pages panel
- Recent Activity/Audit Log panel
- Infrastructure health strip: CPU, memory, disk, load, temperature where supported, backup status, tunnel status

### Sites page

Provide:

- Search and filters: all, healthy, degraded, offline, maintenance
- Sort by status, uptime, traffic, latency, or name
- Domain, environment, status, uptime, response time, 24h traffic, last check
- Small trend sparkline when historical data exists
- Site detail drawer/page
- Safe quick actions with confirmation: recheck, open, inspect logs, enter maintenance mode, restart only when the backend already supports controlled restart

Destructive controls must require confirmation and suitable authorization.

### Analytics page

Provide:

- Time range controls
- Visits, unique visitors, requests, errors, bandwidth where available
- Top sites, pages, referrers, countries, devices only when supported by the data source
- Comparison periods
- Clear loading, empty, partial-data, and API-error states
- Chart tooltips and accessible summaries

### Alerts page

Provide:

- Severity, source, site, first seen, last seen, status, owner
- Acknowledge and resolve actions
- Alert rules and destinations where supported
- Clear distinction between system alerts and security alerts

### Logs page

Provide:

- Searchable, filterable, paginated or virtualised log stream
- Level, timestamp, source, site/service, message, correlation/request ID
- Pause live stream
- Copy event JSON with secret redaction
- No raw secret-bearing headers, tokens, cookies, or environment values

### Security page

Provide truthful status indicators for:

- Cloudflare Access coverage
- Origin exposure
- TLS status
- Authentication/session health
- Rate limiting
- Security headers
- Failed login activity
- Dependency vulnerability scan age/result
- Backup encryption/status
- Last privileged action

Do not show a green security state unless verified.

### Backups page

Provide:

- Last successful backup
- Backup scope
- Retention
- Size
- Verification result
- Restore-test date
- Manual backup control only with permissions and confirmation
- Restore workflow should never be a one-click accidental action

### UI components

Create or standardise:

- AppShell
- Sidebar / MobileNav
- TopBar
- StatusPill
- MetricCard
- SiteStatusTable and SiteStatusCard
- ChartPanel
- ActivityFeed
- AlertRow
- LogViewer
- ResourceGauge / Sparkline
- EmptyState
- ErrorState
- Skeleton loaders
- ConfirmationDialog
- Toast/notification system
- Command palette

Use the project’s existing component system where practical. Do not introduce a second overlapping UI framework without a clear migration plan.

### Suggested design tokens

Adapt these to the existing stack rather than hard-coding them repeatedly:

```css
--bg: #070a12;
--surface-1: #0b101d;
--surface-2: #101624;
--surface-3: #151c2c;
--border: rgba(148, 163, 184, 0.14);
--border-strong: rgba(148, 163, 184, 0.24);
--text: #f8fafc;
--text-muted: #94a3b8;
--brand: #ff3159;
--success: #24d17e;
--warning: #f4a62a;
--danger: #ff475d;
--info: #3b82f6;
--purple: #8b5cf6;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--shadow-panel: 0 18px 60px rgba(0, 0, 0, 0.28);
```

### Accessibility

- WCAG 2.2 AA contrast
- Full keyboard operation
- Visible focus indicators
- Semantic landmarks and headings
- `aria-live` for meaningful live updates, not constant noisy announcements
- Charts must include text summaries or accessible data tables
- Respect reduced motion
- Never communicate status through colour alone

---

## Phase 5: Backend and data integrity

Do not let the redesign become a visual shell over unreliable data.

### Health checks

- Use server-side health checks, not browser `no-cors` guesses
- Set explicit connect/read timeouts
- Distinguish DNS failure, connect timeout, TLS failure, HTTP failure, and application-health failure
- Prevent SSRF: only check configured/approved targets; reject private/link-local/metadata destinations unless intentionally allowlisted
- Limit redirects and revalidate every redirect target
- Store check timestamps and duration
- Add jitter to recurring jobs
- Avoid a thundering herd after NUC reboot

### Analytics

- Validate time ranges and query parameters
- Apply server-side limits and pagination
- Cache expensive aggregates appropriately
- Preserve timezone meaning and display the timezone explicitly
- Do not expose raw provider credentials to the browser

### Infrastructure metrics

- Collect only required metrics
- Bound query frequency and retention
- Avoid privileged shell execution from user-controlled input
- Never build commands by concatenating request values
- Use strict allowlisted service actions

### Control actions

Any restart, backup, maintenance, or deployment action must have:

- Authentication
- Authorisation
- CSRF protection where cookies are used
- Strict allowlisting
- Confirmation
- Audit event
- Rate limit
- Timeout
- Idempotency or duplicate-action protection
- Sanitised output

---

## Phase 6: Security hardening

Implement based on the actual framework and threat model. Document what was added and what remains.

### Cloudflare and origin

- Put the Ops hostname behind Cloudflare Access or equivalent strong identity enforcement
- Restrict access to Kane’s approved identity/account; add additional users only deliberately
- Require MFA at the identity-provider level
- Ensure origin app port binds to `127.0.0.1` or a private interface only
- Use Cloudflare Tunnel rather than router port forwarding
- Remove obsolete public firewall rules after verifying they are unused
- Keep tunnel credentials readable only by the cloudflared service account/root
- Add rate-limiting/WAF rules appropriate for login and sensitive API routes
- Do not rely on a hidden URL as authentication

### Authentication and sessions

- Use a mature authentication library or Cloudflare Access identity headers validated at the origin
- If trusting Access headers, validate the Access JWT, issuer, audience, expiry, and signature server-side
- Add role-based permissions: viewer, operator, admin
- Short idle timeout for privileged sessions
- Secure, `HttpOnly`, `SameSite` cookies; `Secure` in production
- Rotate session identifiers after login and privilege changes
- Re-authenticate for highly sensitive actions where practical
- Prevent user enumeration in login/recovery responses
- Rate-limit failed authentication attempts
- Record failed and successful privileged logins without recording credentials

### Request protection

- Validate every request at the server boundary using schemas
- Enforce body-size limits
- Reject unexpected fields for sensitive operations
- CSRF protection for cookie-authenticated state changes
- Correct CORS allowlist; do not use `*` with credentials
- Parameterised database queries
- Context-appropriate output encoding
- Sanitise any user-controlled rich text
- Validate uploads by size, type, and content; store outside executable paths

### Security headers

Set centrally and verify in production:

- Content-Security-Policy tailored to actual assets
- Strict-Transport-Security after confirming HTTPS-only operation
- X-Content-Type-Options: nosniff
- Referrer-Policy
- Permissions-Policy
- Frame restrictions via CSP `frame-ancestors`
- Cross-origin headers when compatible with the app

Avoid CSP `unsafe-eval`. Remove `unsafe-inline` where practical using nonces or hashes.

### Secrets

- Keep secrets outside Git and client bundles
- Scan Git history and working tree for leaked credentials without printing values
- Rotate any credential proven exposed
- Use restricted service tokens with minimum permissions
- Separate development and production secrets
- Ensure logs redact authorization headers, cookies, tokens, passwords, database URLs, and API keys

### Dependencies and supply chain

- Identify the package manager lockfile and keep it committed
- Run the ecosystem’s vulnerability audit
- Review high/critical findings manually; do not blindly force-upgrade breaking major versions
- Remove abandoned or unused packages
- Pin CI actions and container images appropriately
- Produce an SBOM if practical
- Add automated dependency update tooling with review, not unattended production deployment

### Database and backups

- Use least-privilege database credentials
- Restrict database network exposure
- Encrypt backups at rest
- Define retention
- Verify backup completion
- Perform and document a restore test in a safe temporary location
- Never claim backups work merely because files exist

### Audit logging

Record at minimum:

- Login success/failure
- Logout/session expiry
- Role or user changes
- Site configuration changes
- Alert acknowledgement/resolution
- Maintenance mode changes
- Restart/deploy/backup actions
- Security-setting changes

Each event should include timestamp, actor, action, target, outcome, request/correlation ID, and safe metadata. Do not log secrets.

Protect audit logs from ordinary modification and apply retention.

### NUC host hardening

Audit before changing:

```bash
sudo ufw status verbose 2>/dev/null || true
sudo nft list ruleset 2>/dev/null || true
systemctl --failed --no-pager
sudo journalctl -p warning -b --no-pager | tail -200
find /etc/systemd/system -maxdepth 2 -type f -perm /022 -ls 2>/dev/null
```

Then, where compatible:

- Apply OS security updates with a rollback-aware approach
- Run the app as a non-root service account
- Use systemd hardening options appropriate to the service
- Restrict writable directories
- Protect environment files with `chmod 600` and correct ownership
- Disable unused services
- Keep SSH key-based; disable password login only after verifying key access
- Do not lock Kane out of the NUC
- Configure automatic service restart with bounded backoff
- Add disk-space and thermal alerts

Suggested systemd properties to assess, not paste blindly:

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=<only-required-paths>
```

Some Node/native dependencies may conflict with particular restrictions. Test each change.

---

## Phase 7: Reliability and recovery

Implement:

- `/api/health` or equivalent that checks app readiness without leaking internals
- Local service health check
- Cloudflare Tunnel health visibility
- Graceful shutdown
- Automatic restart with bounded backoff
- Startup ordering so the app is ready before monitoring marks it healthy
- Scheduled backup verification
- Disk, memory, CPU, temperature, and service failure alerts
- Alert deduplication and recovery notifications
- A reboot test: the NUC must restore app + tunnel without manual intervention

Do not create restart loops that hide the root cause.

---

## Phase 8: Testing

Run tests appropriate to the discovered stack.

Minimum verification:

### Functional

- Login and logout
- Permission boundaries for viewer/operator/admin
- Overview loads real data
- Site filters and search
- Site detail
- Analytics period changes
- Alert acknowledge/resolve
- Log filters and redaction
- Backup status
- Allowed control action
- Rejected unauthorised control action
- Loading, empty, partial failure, and total failure states

### Security

- Unauthenticated requests rejected
- Invalid/expired session rejected
- CSRF attempt rejected where applicable
- IDOR attempts rejected
- SSRF targets rejected
- Oversized body rejected
- Invalid schema rejected
- Rate limit observed
- Security headers present
- Cookies correctly flagged
- Secrets absent from client bundle and logs
- Privileged action appears in audit log

### UI

Test at minimum:

- 320 x 568
- 390 x 844
- 768 x 1024
- 1440 x 900
- Keyboard-only navigation
- Reduced-motion mode
- Empty and long-content cases

### Production

- Local origin works
- Public hostname works
- TLS valid
- Cloudflare Access enforcement works
- Origin port is not publicly reachable
- NUC reboot restores service and tunnel
- Backup restore test succeeds in an isolated location

---

## Required deliverables

Commit these to the actual Ops repository:

1. Redesigned production UI
2. Security and reliability changes
3. Tests
4. `OPS_DISCOVERY_REPORT.md`
5. `OPS_IMPLEMENTATION_REPORT.md`
6. `OPS_SECURITY_REPORT.md`
7. `OPS_RUNBOOK.md`
8. `.env.example` with names only, never real values
9. Updated README with install, build, deploy, restart, backup, and recovery instructions

`OPS_IMPLEMENTATION_REPORT.md` must include:

- App path/repository
- Architecture discovered
- Root cause of outage
- Files changed
- Commands run
- Tests and results
- Screenshots or references for desktop and mobile views
- Known limitations
- Rollback instructions

`OPS_SECURITY_REPORT.md` must include:

- Threat model summary
- Controls implemented
- Controls verified
- Findings not yet fixed, ranked by severity
- Credentials rotated, named only by service, never value
- Date of next recommended review

`OPS_RUNBOOK.md` must include:

- Check app status
- Check tunnel status
- Restart safely
- Read logs
- Back up
- Restore
- Roll back deployment
- Respond to a site-down alert
- Respond to suspicious login activity
- Recover after NUC reboot

---

## Definition of done

The task is complete only when all of the following are true:

- `https://ops.kay2studios.xyz` loads reliably through Cloudflare
- Strong access control protects the dashboard
- The origin service is not publicly exposed
- Existing real functionality is preserved or improved
- The redesigned interface matches the KAY2 Ops direction described above
- Desktop and mobile layouts are production quality
- Health, analytics, alerts, logs, security, and backups use truthful data/states
- Privileged actions are authorised, confirmed, rate-limited, and audited
- Security headers, session controls, validation, and secret redaction are verified
- Automated tests and production smoke checks pass
- NUC reboot recovery is verified
- Backup and isolated restore test are verified
- Reports and runbook are committed
- Changes are committed on a dedicated branch with a clear commit history

## Final instruction to Codex

Work autonomously through discovery, repair, redesign, hardening, testing, and documentation. Make conservative, reversible changes. Do not stop after producing recommendations: implement and verify what can safely be implemented on the machine. Where a change could lock out the owner, destroy data, rotate a critical credential, alter DNS, or interrupt unrelated services, document the exact proposed action and preserve a rollback path before proceeding.
