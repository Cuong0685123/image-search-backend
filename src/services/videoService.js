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

  // 1. Nếu là từ khóa 18+ hoặc chọn Nguồn 2: Ưu tiên Eporner API (GIỮ NGUYÊN)
  if (isAdult || engine === 'yandex') {
    const r18Results = await fetchEpornerVideos(query, page, count);
    if (r18Results && r18Results.length > 0) {
      console.log(`[Video Service] Eporner API tìm thấy: ${r18Results.length} video`);
      return r18Results;
    }
  }

  // 2. Nếu là từ khóa thông thường (hoặc engine === 'bing'): Dùng YouTube InnerTube API siêu ổn định
  const normalResults = await fetchYouTubeInnerTubeVideos(query, page, count);
  if (normalResults && normalResults.length > 0) {
    console.log(`[Video Service] Video thông thường tìm thấy: ${normalResults.length} video`);
    return normalResults;
  }

  // 3. Fallback chéo sang Eporner nếu tìm thường không có
  return await fetchEpornerVideos(query, page, count);
}

// ====================== NGUỒN 1: TỪ KHÓA BÌNH THƯỜNG (YOUTUBE INNERTUBE NGUYÊN BẢN) ======================
async function fetchYouTubeInnerTubeVideos(query, page = 1, count = 20) {
  const cleanQuery = query.trim();

  // Cách 1: Gọi YouTube InnerTube API chính thức (Không cần token/key, không chặn Render)
  try {
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        query: cleanQuery,
      },
      {
        httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_HEADERS['User-Agent'],
        },
        timeout: 7000,
      }
    );

    const sections =
      res.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];

    const results = [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;

        const title = v.title?.runs?.[0]?.text || cleanQuery;
        const duration = v.lengthText?.simpleText || '';
        const publisher = v.ownerText?.runs?.[0]?.text || 'YouTube Video';
        const views = v.viewCountText?.simpleText || '';
        const thumbnails = v.thumbnail?.thumbnails || [];
        const thumbUrl =
          thumbnails[thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

        results.push({
          title,
          videoUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnailUrl: thumbUrl.startsWith('//') ? 'https:' + thumbUrl : thumbUrl,
          duration,
          publisher,
          views,
          engine: 'youtube',
        });

        if (results.length >= count) break;
      }
      if (results.length >= count) break;
    }

    if (results.length > 0) return results;
  } catch (err) {
    console.warn('[YouTube InnerTube Error]:', err.message);
  }

  // Cách 2: Fallback sang Piped API công khai nếu YouTube InnerTube gặp sự cố
  const pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://piped-api.lunar.icu',
  ];

  for (const instance of pipedInstances) {
    try {
      const res = await axios.get(
        `${instance}/search?q=${encodeURIComponent(cleanQuery)}&filter=videos`,
        {
          httpsAgent,
          headers: BROWSER_HEADERS,
          timeout: 5000,
        }
      );

      const items = res.data?.items || [];
      if (Array.isArray(items) && items.length > 0) {
        return items.slice(0, count).map((item) => {
          const totalSec = item.duration || 0;
          const min = Math.floor(totalSec / 60);
          const sec = totalSec % 60;
          const durStr = totalSec > 0 ? `${min}:${sec < 10 ? '0' : ''}${sec}` : '';

          return {
            title: item.title || cleanQuery,
            videoUrl: `https://www.youtube.com${item.url}`,
            thumbnailUrl: item.thumbnail || '',
            duration: durStr,
            publisher: item.uploaderName || 'Video',
            views: item.views ? `${item.views.toLocaleString()} lượt xem` : '',
            engine: 'youtube',
          };
        });
      }
    } catch {
      continue;
    }
  }

  return [];
}

// ====================== NGUỒN 2: EPORNER API CHUẨN (GIỮ NGUYÊN 100%) ======================
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