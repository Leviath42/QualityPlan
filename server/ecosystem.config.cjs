module.exports = {
  apps: [
    {
      name: 'qualityplan',
      cwd: '/opt/qualityplan/server',
      script: 'dist/index.js',
      env: { PORT: '3100', QP_DB: '/opt/qualityplan/data/qualityplan.db' },
      max_memory_restart: '300M',
      autorestart: true,
    },
  ],
};
