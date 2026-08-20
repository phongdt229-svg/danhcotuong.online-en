/*
 * ecosystem.config.js — Cấu hình PM2 cho production.
 *
 * Dùng:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save           # lưu danh sách app để khôi phục sau reboot
 *   pm2 startup        # tạo service tự khởi động cùng hệ điều hành
 *   pm2 logs danhcotuong
 *   pm2 reload danhcotuong   # reload không downtime sau khi cập nhật code
 */
module.exports = {
  apps: [
    {
      name: 'danhcotuong',
      script: 'server/server.js',
      // 'max' = 1 process / 1 CPU core (cluster). Lưu ý: session đã lưu ở MySQL nên
      // chạy nhiều instance vẫn chia sẻ phiên đăng nhập an toàn.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
