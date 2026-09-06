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

      // ⚠ BẮT BUỘC giữ instances: 1 (fork). KHÔNG chuyển sang cluster/'max'.
      //
      // Phòng đấu online (server/realtime/match.js) giữ trạng thái TRONG RAM của
      // từng tiến trình: danh sách phòng, hàng chờ ghép trận, ván cờ đang đánh.
      // Chạy nhiều instance thì hai người chơi có thể rơi vào hai tiến trình khác
      // nhau -> không thấy phòng của nhau, và ván CƯỢC ĐIỂM sẽ hỏng giữa chừng.
      // (Session thì an toàn vì lưu ở MySQL — nhưng phòng đấu thì không.)
      // Muốn chạy nhiều instance: phải chuyển trạng thái phòng sang Redis trước.
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
