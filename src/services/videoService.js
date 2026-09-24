import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // 1. Nếu người dùng chọn Nguồn 2 (Yandex): Ưu tiên Yandex Video Uncensored
  if (engine === 'yandex') {
    const yandexRes = await fetchYandexVideos(query, page, count);
    if (yandexRes && yandexRes.length > 0) {
      console.log(`[Video Service] Yandex Video tìm thấy: ${yandexRes.length} video`);
      return yandexRes;
    }
  }

  // 2. Nguồn 1 (Bing Video): Thử cào Bing Video với cookie tắt SafeSearch
  const bingResults = await fetchBingVideos(query, page, count);
  if (bingResults && bingResults.length > 0) {
    console.log(`[Video Service] Bing Video tìm thấy: ${bingResults.length} video`);
    return bingResults;
  }

  // 3. Fallback 1: Yandex Video (R18 cực mạnh không kiểm duyệt)
  console.log(`[Video Service] Bing rỗng, chuyển sang quét Yandex Video...`);
  const yandexFallback = await fetchYandexVideos(query, page, count);
  if (yandexFallback && yandexFallback.length > 0) {
    console.log(`[Video Service] Yandex Video Fallback tìm thấy: ${yandexFallback.length} video`);
    return yandexFallback;
  }

  // 4. Fallback 2: Eporner API (Chuyên trị từ khoá 18+/R18/Sex/Gay, JSON cực nhanh không bao giờ lỗi)
  console.log(`[Video Service] Chuyển hướng sang Eporner Open API...`);
  const r18Results = await fetchEpornerVideos(query, page, count);
  if (r18Results && r18Results.length > 0) {
    console.log(`[Video Service] Eporner API tìm thấy: ${r18Results.length} video`);
    return r18Results;
  }

  return [];
}

// ====================== NGUỒN 1: BING VIDEOS ======================
async function fetchBingVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * count + 1;
  const targetUrl = `https://www.bing.com/videos/search?q=${cleanQuery}&first=${first}&count=${count}&adlt=off&safesearch=off&qft=+filterui:duration-all&FORM=HDRSC3`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=-1; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1; SRCHD=AF=NOFORM;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 9000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    $('.mc_vtvc, div.videoCard, .inline_video_card, div.dg_u').each((_, el) => {
      try {
        const card = $(el);
        const linkEl = card.find('a.vturl, a[href*="/videos/search"], a').first();
        const rawHref = linkEl.attr('href') || '';

        const rawMeta = card.attr('vrhm') || card.find('[vrhm]').attr('vrhm') || card.attr('data-vrm');
        let meta = null;
        if (rawMeta) {
          try {
            meta = JSON.parse(rawMeta);
          } catch {
            try {
              meta = JSON.parse(rawMeta.replace(/&quot;/g, '"'));
            } catch {}
          }
        }

        let videoUrl = meta?.purl || meta?.curl || meta?.mediaurl;

        if (!videoUrl && rawHref) {
          const match = rawHref.match(/[?&](?:ru|rurl)=([^&]+)/i);
          if (match && match[1]) {
            try {
              videoUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!videoUrl || videoUrl.includes('bing.com') || !videoUrl.startsWith('http')) return;
        if (seenUrls.has(videoUrl)) return;
        seenUrls.add(videoUrl);

        const title = card.find('.mc_vtvc_title, .b_tit, .title').text().trim() || meta?.title || query;
        const imgEl = card.find('img').first();
        let thumbnailUrl = imgEl.attr('src') || imgEl.attr('data-src') || meta?.thumb?.url || '';

        if (thumbnailUrl.startsWith('//')) {
          thumbnailUrl = 'https:' + thumbnailUrl;
        }

        const duration = card.find('.b_duration, .mc_vtvc_duration').text().trim() || meta?.duration || '';
        const publisher = card.find('.mc_vtvc_meta_row span, .source').first().text().trim() || meta?.publisher || 'Web Video';

        results.push({
          title,
          videoUrl,
          thumbnailUrl,
          duration,
          publisher,
          views: '',
          engine: 'bing',
        });
      } catch {}
    });

    return results.slice(0, count);
  } catch (err) {
    return [];
  }
}

// ====================== NGUỒN 2: YANDEX VIDEO (UNCENSORED family=0) ======================
async function fetchYandexVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const p = Math.max(0, page - 1);
  const targetUrl = `https://yandex.com/video/search?text=${cleanQuery}&p=${p}&family=0`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': `yp=1750000000.sp.family:0; yandexuid=${Math.floor(Math.random() * 1e18)};`,
        'Referer': 'https://yandex.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // 1. Quét JSON state
    const stateEl = $('[id^="VideoApp-"][data-state], [data-bem*="serp-list"]').first();
    const rawState = stateEl.attr('data-state');

    if (rawState) {
      try {
        const state = JSON.parse(rawState);
        const items = state?.initialState?.serpList?.items?.entities || {};
        for (const key of Object.keys(items)) {
          const item = items[key];
          const rawUrl = item?.url || item?.shareUrl;
          if (!rawUrl || seenUrls.has(rawUrl)) continue;

          seenUrls.add(rawUrl);
          results.push({
            title: item.title || item.alt || query,
            videoUrl: rawUrl,
            thumbnailUrl: item.thumb?.url || item.thumbnailUrl || '',
            duration: item.duration || '',
            publisher: item.host || 'Yandex Video',
            views: item.views ? `${item.views} views` : '',
            engine: 'yandex',
          });
        }
      } catch {}
    }

    // 2. Quét data-bem item
    if (results.length === 0) {
      $('[data-bem*="serp-item"]').each((_, el) => {
        try {
          const bem = $(el).attr('data-bem');
          if (!bem) return;
          const parsed = JSON.parse(bem);
          const data = parsed['serp-item'] || parsed;
          const videoUrl = data.url || data.link;

          if (!videoUrl || seenUrls.has(videoUrl)) return;
          seenUrls.add(videoUrl);

          results.push({
            title: data.title || $(el).find('.thumb-image__image').attr('alt') || query,
            videoUrl,
            thumbnailUrl: data.thumb || $(el).find('img').attr('src') || '',
            duration: data.duration || '',
            publisher: data.provider || 'Web Video',
            views: '',
            engine: 'yandex',
          });
        } catch {}
      });
    }

    return results.slice(0, count);
  } catch (err) {
    return [];
  }
}

// ====================== NGUỒN 3: EPORNER OPEN API (R18 CHUYÊN BIỆT) ======================
async function fetchEpornerVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const perPage = Math.min(count, 30);
  const targetUrl = `https://www.eporner.com/api/v2/web/search/?query=${cleanQuery}&per_page=${perPage}&page=${page}&thumbsize=medium&order=top-weekly&format=json`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Accept': 'application/json',
      },
      timeout: 8000,
    });

    const videos = res.data?.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) return [];

    return videos.map((item) => ({
      title: item.title || query,
      videoUrl: item.url, // Link video gốc
      thumbnailUrl: item.default_thumb?.src || item.thumbs?.[0]?.src || '',
      duration: item.length_min || '',
      publisher: 'Eporner Stream',
      views: item.views ? `${item.views.toLocaleString()} views` : '',
      engine: 'r18_stream',
    }));
  } catch (err) {
    console.warn(`[Eporner API Error]:`, err.message);
    return [];
  }
}