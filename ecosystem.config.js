module.exports = {
  apps: [
    {
      name: 'kay2tunnel',
      script: './server/index.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      },
      error_file: '~/.pm2/logs/kay2tunnel-error.log',
      out_file: '~/.pm2/logs/kay2tunnel-out.log',
      log_file: '~/.pm2/logs/kay2tunnel-combined.log'
    }
  ]
};
