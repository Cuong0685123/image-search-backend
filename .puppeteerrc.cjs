const { join } = require('path');

/**
 * Cấu hình ép Puppeteer lưu binary Chrome vào thư mục cục bộ của dự án
 * thay vì thư mục ẩn hệ thống (/opt/render/.cache/puppeteer)
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};