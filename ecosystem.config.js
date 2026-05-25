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
    {
      name: 'stan-cli-tunnel',
      script: 'cloudflared',
      args: 'tunnel --url http://127.0.0.1:7420 --logfile /home/kay2/.pm2/logs/stan-cli-tunnel.log',
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
