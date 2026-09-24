import { fetchDuckImages } from '../services/duckService.js';

export async function searchImages(req, res) {
  try {
    const query = req.query.q || '';
    const page = parseInt(req.query.page, 10) || 1;
    const engine = req.query.engine || 'bing';           // 'bing' | 'yandex'
    const safeSearch = req.query.safeSearch || 'off';    // 'off' | 'moderate' | 'strict'
    const count = parseInt(req.query.count, 10) || 35;

    if (!query.trim()) {
      return res.json({ success: true, page, total: 0, data: [] });
    }

    console.log(`Đang cào ảnh cho: "${query}" - Trang: ${page} - Engine: ${engine}`);
    
    const images = await fetchDuckImages(query, page, {
      engine,
      safeSearch,
      count,
    });

    console.log(`Tìm thấy ${images.length} ảnh ở trang ${page} (${engine})`);

    return res.json({
      success: true,
      page,
      engine,
      total: images.length,
      data: images,
    });
  } catch (error) {
    console.error('Lỗi controller:', error.message);
    return res.json({
      success: true,
      page: 1,
      total: 0,
      data: [],
    });
  }
}