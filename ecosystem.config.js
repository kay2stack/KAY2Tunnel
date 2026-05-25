module.exports = {
  apps: [
    {
      name: 'stan-cli',
      script: './server/index.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      },
      error_file: '~/.pm2/logs/stan-cli-error.log',
      out_file: '~/.pm2/logs/stan-cli-out.log',
      log_file: '~/.pm2/logs/stan-cli-combined.log'
    }
  ]
};
