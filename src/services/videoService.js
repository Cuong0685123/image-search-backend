import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
};

// Nhận diện từ khóa 18+ để ưu tiên route chính xác
function isR18Query(query = '') {
  return /sex|gay|nude|porn|hentai|loang|khongche|18\+|phimsex|dit|buu|trai|boy/i.test(query);
}

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  const isAdult = isR18Query(query);

  // Nếu là từ khóa 18+ hoặc chọn Nguồn 2: Ưu tiên Eporner API
  if (isAdult || engine === 'yandex') {
    const r18Results = await fetchEpornerVideos(query, page, count);
    if (r18Results && r18Results.length > 0) {
      console.log(`[Video Service] Eporner API tìm thấy: ${r18Results.length} video`);
      return r18Results;
    }
  }

  // Nếu là từ khóa thông thường hoặc Eporner rỗng: Gọi Invidious Open Search
  const normalResults = await fetchOpenVideoSearch(query, page, count);
  if (normalResults && normalResults.length > 0) {
    console.log(`[Video Service] Open Video Search tìm thấy: ${normalResults.length} video`);
    return normalResults;
  }

  // Fallback chéo nếu tìm thông thường rỗng thì quét qua Eporner
  return await fetchEpornerVideos(query, page, count);
}

// ====================== NGUỒN 1: EPORNER API CHUẨN (R18 / 18+ UNCENSORED) ======================
async function fetchEpornerVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const perPage = Math.min(count, 30);

  // Endpoint chuẩn: /api/v2/video/search/ kèm gay=1 và lq=1 để không bỏ sót bất kỳ video nào
  const targetUrl = `https://www.eporner.com/api/v2/video/search/?query=${cleanQuery}&per_page=${perPage}&page=${page}&thumbsize=big&order=top-weekly&gay=1&lq=1&format=json`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 8000,
    });

    const videos = res.data?.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) return [];

    return videos.map((item) => ({
      title: item.title || query,
      videoUrl: item.url, // Link xem video
      thumbnailUrl: item.default_thumb?.src || (item.thumbs && item.thumbs[0]?.src) || '',
      duration: item.length_min || '',
      publisher: 'Eporner Stream',
      views: item.views ? `${item.views.toLocaleString()} lượt xem` : '',
      engine: 'r18_stream',
    }));
  } catch (err) {
    console.warn(`[Eporner API Error]:`, err.message);
    return [];
  }
}

// ====================== NGUỒN 2: OPEN VIDEO SEARCH (CHO TỪ KHÓA BÌNH THƯỜNG) ======================
async function fetchOpenVideoSearch(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());

  // Các instance Invidious công khai cực nhanh, không chặn Render
  const instances = [
    'https://vid.puffyan.us',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
  ];

  for (const baseUrl of instances) {
    try {
      const targetUrl = `${baseUrl}/api/v1/search?q=${cleanQuery}&page=${page}&type=video`;
      const res = await axios.get(targetUrl, {
        httpsAgent,
        headers: BROWSER_HEADERS,
        timeout: 6000,
      });

      if (Array.isArray(res.data) && res.data.length > 0) {
        return res.data.slice(0, count).map((item) => {
          const totalSec = item.lengthSeconds || 0;
          const min = Math.floor(totalSec / 60);
          const sec = totalSec % 60;

          return {
            title: item.title || query,
            videoUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
            thumbnailUrl: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            duration: totalSec > 0 ? `${min}:${sec < 10 ? '0' : ''}${sec}` : '',
            publisher: item.author || 'Video',
            views: item.viewCount ? `${item.viewCount.toLocaleString()} lượt xem` : '',
            engine: 'open_video',
          };
        });
      }
    } catch {
      continue;
    }
  }

  return [];
}