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
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

const BLACKLISTED_PLATFORMS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'threads.net',
  'bilibili.com',
  'bilibili.tv',
  'b23.tv',
  'dailymotion.com',
  'dai.ly',
  'vimeo.com',
  'douyin.com',
  'kuaishou.com',
];

function isBlacklisted(url = '', publisher = '') {
  const target = `${url} ${publisher}`.toLowerCase();
  return (
    BLACKLISTED_PLATFORMS.some((platform) => target.includes(platform)) ||
    /bilibili|dailymotion|tiktok|youtube|facebook|instagram|vimeo/i.test(target)
  );
}

function decodeBingRedirectUrl(rawHref = '') {
  if (!rawHref) return null;
  const match = rawHref.match(/[?&](?:ru|rurl)=([^&]+)/i);
  if (match && match[1]) {
    try {
      let decoded = decodeURIComponent(match[1]);
      if (
        decoded.includes('%3A') ||
        decoded.includes('%2F') ||
        decoded.includes('%3a') ||
        decoded.includes('%2f')
      ) {
        decoded = decodeURIComponent(decoded);
      }
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        return decoded;
      }
    } catch {}
  }
  return null;
}

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', safeSearch = 'off', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  if (engine === 'yandex' || engine === 'duckduckgo') {
    const ddgResults = await fetchDuckDuckGoVideos(query, page, { safeSearch, count });
    if (ddgResults && ddgResults.length > 0) {
      console.log(`[Video Service] DDG tìm thấy: ${ddgResults.length} video`);
      return ddgResults;
    }
    console.log(`[Video Service] DDG rỗng, tự động fallback sang Bing Videos`);
    return await fetchBingVideos(query, page, { safeSearch, count });
  }

  const bingResults = await fetchBingVideos(query, page, { safeSearch, count });
  console.log(`[Video Service] Bing tìm thấy: ${bingResults.length} video`);
  return bingResults;
}

// ====================== BING VIDEOS ======================
async function fetchBingVideos(query, page = 1, options = {}) {
  const { count = 20 } = options;
  const cleanQuery = encodeURIComponent(query.trim());

  let aggregatedResults = [];
  const seenUrls = new Set();
  const pageBaseFirst = (Math.max(1, page) - 1) * count + 1;

  const targetUrl = `https://www.bing.com/videos/search?q=${cleanQuery}&first=${pageBaseFirst}&count=${count * 2}&adlt=off&setmkt=en-US&setlang=en`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=-1; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 10000,
    });

    if (res.data && typeof res.data === 'string') {
      aggregatedResults = parseBingHtml(res.data, query, seenUrls);
    }
  } catch (err) {
    console.warn(`[Bing Video Error]:`, err.message);
  }

  return aggregatedResults.slice(0, count);
}

function parseBingHtml(html, query, seenUrls = new Set()) {
  const $ = cheerio.load(html);
  const results = [];

  $('div.dg_u, div.mc_vtvc, div.videoCard, .inline_video_card').each((_, el) => {
    try {
      const card = $(el);
      const linkEl = card.find('a[href*="/videos/search"], a.vturl, a').first();
      const rawHref = linkEl.attr('href') || '';

      const rawMeta =
        card.attr('vrhm') ||
        card.attr('data-vrm') ||
        card.attr('data-promoted') ||
        linkEl.attr('data-vrm') ||
        card.find('[vrhm]').attr('vrhm') ||
        card.find('[data-vrm]').attr('data-vrm');

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

      let externalUrl = null;
      if (meta?.purl && !meta.purl.includes('bing.com')) {
        externalUrl = meta.purl;
      } else if (meta?.curl && !meta.curl.includes('bing.com')) {
        externalUrl = meta.curl;
      } else if (meta?.url && !meta.url.includes('bing.com')) {
        externalUrl = meta.url;
      } else if (meta?.mediaurl && !meta.mediaurl.includes('bing.com')) {
        externalUrl = meta.mediaurl;
      }

      if (!externalUrl) {
        externalUrl = decodeBingRedirectUrl(rawHref);
      }

      if (!externalUrl || externalUrl.includes('bing.com') || externalUrl.startsWith('/')) {
        return;
      }

      const publisher =
        card.find('.mc_vtvc_meta_row span, .source, .publisher').first().text().trim() ||
        meta?.publisher ||
        meta?.source ||
        'Web Video';

      if (seenUrls.has(externalUrl) || isBlacklisted(externalUrl, publisher)) {
        return;
      }
      seenUrls.add(externalUrl);

      const title =
        card.find('.mc_vtvc_title, .b_tit, .title').text().trim() ||
        card.find('a[title]').attr('title') ||
        meta?.title ||
        query;

      const imgEl = card.find('img').first();
      let thumbnailUrl =
        imgEl.attr('src') ||
        imgEl.attr('data-src') ||
        imgEl.attr('data-thumb') ||
        meta?.thumb?.url ||
        '';

      if (thumbnailUrl.startsWith('//')) {
        thumbnailUrl = 'https:' + thumbnailUrl;
      }

      const duration =
        card.find('.b_duration, .mc_vtvc_duration, .duration').text().trim() ||
        meta?.duration ||
        '';

      const views = card.find('.mc_vtvc_meta_row_sub span, .views').text().trim() || '';

      results.push({
        title,
        videoUrl: externalUrl,
        thumbnailUrl,
        duration,
        publisher,
        views,
        engine: 'bing',
      });
    } catch {}
  });

  return results;
}

// ====================== DUCKDUCKGO VIDEOS ======================
async function fetchDuckDuckGoVideos(query, page = 1, options = {}) {
  const { count = 20 } = options;
  const cleanQuery = encodeURIComponent(query.trim());

  try {
    // 1. Lấy token vqd với timeout nhanh
    const pageRes = await axios.get(
      `https://duckduckgo.com/?q=${cleanQuery}&t=h_&ia=videos&kp=-2&p=-2`,
      {
        httpsAgent,
        headers: {
          ...BROWSER_HEADERS,
          'Cookie': 'p=-2; kp=-2;',
        },
        timeout: 5000,
      }
    );

    let vqd = null;
    const match =
      pageRes.data.match(/vqd=['"]([^'"]+)['"]/) ||
      pageRes.data.match(/vqd=([\d-]+)/);

    if (match && match[1]) {
      vqd = match[1];
    }

    if (!vqd) return [];

    // 2. Gọi API video của DDG
    const offset = (Math.max(1, page) - 1) * count;
    const apiUrl = `https://duckduckgo.com/v.js?l=us-en&o=json&q=${cleanQuery}&vqd=${vqd}&f=,,,duration:&p=-2&kp=-2&s=${offset}`;

    const apiRes = await axios.get(apiUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'p=-2; kp=-2;',
        'Referer': 'https://duckduckgo.com/',
      },
      timeout: 7000,
    });

    const items = apiRes.data?.results || [];
    const results = [];
    const seen = new Set();

    items.forEach((item) => {
      let videoUrl = item.content || item.embed_url || item.uploader_url;
      const publisher = item.publisher || item.provider || 'Web Video';

      if (
        !videoUrl ||
        videoUrl.includes('duckduckgo.com') ||
        seen.has(videoUrl) ||
        isBlacklisted(videoUrl, publisher)
      ) {
        return;
      }

      seen.add(videoUrl);

      results.push({
        title: item.title || query,
        videoUrl,
        thumbnailUrl: item.images?.large || item.images?.medium || item.images?.small || '',
        duration: item.duration || '',
        publisher,
        views: item.views ? `${item.views} views` : '',
        engine: 'duckduckgo',
      });
    });

    return results.slice(0, count);
  } catch (err) {
    console.warn(`[DDG Video Warning]:`, err.message);
    return [];
  }
}