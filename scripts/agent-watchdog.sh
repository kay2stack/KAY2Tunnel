#!/usr/bin/env bash
# Agent watchdog — restarts pm2 processes that have CRASHED (status "errored" or
# stuck in a restart loop). It deliberately does NOT touch processes that are merely
# "stopped" — those were stopped on purpose and must stay down. Never restarts
# stan-cli (that would kill the process running this watchdog). Uses `pm2 restart`
# (kill-then-start), never `pm2 reload` (the double-load that has OOM-rebooted the Pi).
set -uo pipefail

SELF="stan-cli"
RESTART_LOOP_MAX=${RESTART_LOOP_MAX:-15}   # unstable_restarts above this = treat as crashed

jlist=$(pm2 jlist 2>/dev/null) || { echo "pm2 jlist failed"; exit 1; }

mapfile -t bad < <(printf '%s' "$jlist" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    let arr=[];try{arr=JSON.parse(d)}catch{ process.exit(0) }
    const loop = parseInt(process.env.RESTART_LOOP_MAX||"15",10);
    for(const p of arr){
      const st=(p.pm2_env&&p.pm2_env.status)||"";
      const ur=(p.pm2_env&&p.pm2_env.unstable_restarts)||0;
      if(st==="errored" || ur>loop) console.log(p.name);
    }
  });')

acted=0
for name in "${bad[@]}"; do
  [ -z "$name" ] && continue
  [ "$name" = "$SELF" ] && continue
  if pm2 restart "$name" >/dev/null 2>&1; then
    echo "@@PUSH: ♻️ Restarted crashed agent '${name}'"
    acted=$((acted+1))
  else
    echo "@@PUSH: ⚠️ Agent '${name}' crashed and would not restart"
    acted=$((acted+1))
  fi
done

echo "watchdog: crashed=${#bad[@]} acted=${acted}"
