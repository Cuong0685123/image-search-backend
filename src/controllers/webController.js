import { fetchWebResults } from '../services/webService.js';

export async function searchWeb(req, res) {
  try {
    const query = req.query.q || '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rawEngine = (req.query.engine || 'bing').toLowerCase().trim();
    // Thêm 'duckduckgo' vào danh sách hợp lệ:
const engine = ['bing', 'yandex', 'duckduckgo'].includes(rawEngine) ? rawEngine : 'bing';

    if (!query.trim()) {
      return res.json({
        success: true,
        page: 1,
        engine,
        total: 0,
        hasMore: false,
        data: [],
      });
    }

    console.log(`Đang cào bài viết web: "${query}" - Trang: ${page} - Engine: ${engine}`);

    const results = await fetchWebResults(query, page, { engine });

    console.log(`Tìm thấy ${results.length} bài viết (${engine}) ở trang ${page}`);

    return res.json({
      success: true,
      page,
      engine,
      total: results.length,
      hasMore: results.length > 0,
      data: results,
    });
  } catch (error) {
    console.error('Lỗi controller web:', error.message);
    return res.status(500).json({
      success: false,
      page: 1,
      total: 0,
      hasMore: false,
      message: 'Không thể tìm kiếm bài viết lúc này.',
      data: [],
    });
  }
}