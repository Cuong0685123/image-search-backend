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

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // Nguồn 2: Sử dụng Search API mở rộng
  if (engine === 'yandex') {
    const streamResults = await fetchExternalStreamVideos(query, page, count);
    if (streamResults && streamResults.length > 0) {
      console.log(`[Video Service] Nguồn 2 tìm thấy: ${streamResults.length} video`);
      return streamResults;
    }
  }

  // Nguồn 1: Video phân trang tổng hợp
  const mainResults = await fetchPagedMediaVideos(query, page, count);
  if (mainResults && mainResults.length > 0) {
    console.log(`[Video Service] Nguồn 1 tìm thấy: ${mainResults.length} video (Trang ${page})`);
    return mainResults;
  }

  // Fallback dự phòng giữa các nguồn
  return await fetchExternalStreamVideos(query, page, count);
}

// ====================== NGUỒN 1: TỔNG HỢP & PHÂN TRANG ======================
async function fetchPagedMediaVideos(query, page = 1, count = 20) {
  const cleanQuery = query.trim();

  const serviceNodes = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://piped-api.lunar.icu',
    'https://api.piped.projectsegfau.lt',
  ];

  for (const node of serviceNodes) {
    try {
      const searchQuery = page > 1 ? `${cleanQuery}&page=${page}` : cleanQuery;
      const res = await axios.get(
        `${node}/search?q=${encodeURIComponent(searchQuery)}&filter=videos`,
        {
          httpsAgent,
          headers: BROWSER_HEADERS,
          timeout: 4500,
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

  // Fallback direct request
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
        timeout: 6000,
      }
    );

    const sections =
      res.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];

    const allVideos = [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;

        const title = v.title?.runs?.[0]?.text || cleanQuery;
        const duration = v.lengthText?.simpleText || '';
        const publisher = v.ownerText?.runs?.[0]?.text || 'Media Stream';
        const views = v.viewCountText?.simpleText || '';
        const thumbnails = v.thumbnail?.thumbnails || [];
        const thumbUrl =
          thumbnails[thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

        allVideos.push({
          title,
          videoUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnailUrl: thumbUrl.startsWith('//') ? 'https:' + thumbUrl : thumbUrl,
          duration,
          publisher,
          views,
          engine: 'media',
        });
      }
    }

    if (allVideos.length > 0) {
      const offset = (page - 1) * count;
      if (offset < allVideos.length) {
        return allVideos.slice(offset, offset + count);
      }
      return allVideos.slice(0, count);
    }
  } catch (err) {
    console.warn('[Media Service Error]:', err.message);
  }

  return [];
}

// ====================== NGUỒN 2: PUBLIC STREAM API (GIỮ NGUYÊN HOÀN TOÀN) ======================
async function fetchExternalStreamVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const perPage = Math.min(count, 30);

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
      videoUrl: item.url,
      thumbnailUrl: item.default_thumb?.src || (item.thumbs && item.thumbs[0]?.src) || '',
      duration: item.length_min || '',
      publisher: 'Network Video',
      views: item.views ? `${item.views.toLocaleString()} lượt xem` : '',
      engine: 'stream',
    }));
  } catch (err) {
    console.warn(`[Stream API Error]:`, err.message);
    return [];
  }
}