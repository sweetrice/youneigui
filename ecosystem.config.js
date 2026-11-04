module.exports = {
  apps: [
    {
      name: 'youneigui',
      script: 'src/app.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 3000,
      // pm2 启动时自动等 .env 存在，否则拒绝启动（空值也会被默认值替代，所以这里是 double-check）
      wait_ready: false,
    },
  ],
};
