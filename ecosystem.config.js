module.exports = {
  apps: [
    {
      name: 'stan-cli',
      script: './server/index.js',
      cwd: '/home/kay2/KAY2Tunnel',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/kay2/.pm2/logs/stan-cli-error.log',
      out_file:   '/home/kay2/.pm2/logs/stan-cli-out.log',
    },
    // VNC server — streams the Wayland desktop for the Screen tab
    {
      name: 'stan-vnc',
      script: 'wayvnc',
      args: '127.0.0.1 5900',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_RUNTIME_DIR: '/run/user/1000',
      },
      out_file:   '/home/kay2/.pm2/logs/stan-vnc-out.log',
      error_file: '/home/kay2/.pm2/logs/stan-vnc-error.log',
    },
    // Cloudflare quick tunnel — fallback only, URL rotates on restart.
    // Primary access: https://kay2.tail69c58c.ts.net (tailscale serve, already running)
    {
      name: 'stan-cli-tunnel',
      script: 'cloudflared',
      // Named tunnel — persistent URL: https://stan.spikeradar.co.uk
      args: 'tunnel --config /home/kay2/.cloudflared/config-stan-cli.yml run stan-cli',
      interpreter: 'none',
      cwd: '/home/kay2/KAY2Tunnel',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file:   '/home/kay2/.pm2/logs/stan-cli-tunnel-out.log',
      error_file: '/home/kay2/.pm2/logs/stan-cli-tunnel-error.log',
    },
  ],
};
