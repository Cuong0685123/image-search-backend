import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

export async function fetchDuckImages(query, page = 1, options = {}) {
  const {
    engine = 'bing',
    safeSearch = 'off',
    count = 35,
  } = options;

  if (engine === 'yandex') {
    return await fetchYandexImages(query, page, { safeSearch, count });
  }

  // Thử Bing trước
  const bingResults = await fetchBingImages(query, page, { safeSearch, count });
  if (bingResults && bingResults.length > 0) {
    return bingResults;
  }

  // Nếu Bing trên Render bị chặn rỗng, tự động nhảy sang Yandex Images
  console.log(`[Fallback Ảnh] Bing rỗng, chuyển sang Yandex Images cho: ${query}`);
  return await fetchYandexImages(query, page, { safeSearch, count });
}

// ====================== BING ======================
async function fetchBingImages(query, page = 1, options = {}) {
  const { safeSearch = 'off', count = 35 } = options;
  const first = (Math.max(1, page) - 1) * count + 1;
  const cleanQuery = encodeURIComponent(query.trim());

  let targetUrl = `https://www.bing.com/images/async?q=${cleanQuery}&first=${first}&count=${count}&mmasync=1&setlang=en`;

  if (safeSearch === 'off') {
    targetUrl += '&safeSearch=off&adlt=off';
  }

  let html = '';
  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SRCHHPGUSR=ADLT=OFF; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUID=3B863C2E5D1E6F342D7D28455CA66E5B;',
        'Referer': 'https://www.bing.com/images/search?q=' + cleanQuery,
        'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
      timeout: 10000,
    });
    html = res.data;
  } catch (err) {
    return [];
  }

  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  const domainCount = new Map();
  const MAX_PER_DOMAIN = 3;

  $('a.iusc').each((_, el) => {
    try {
      const meta = JSON.parse($(el).attr('m') || '{}');
      if (meta.murl && !seen.has(meta.murl)) {
        let domain = 'web';
        try {
          if (meta.purl) domain = new URL(meta.purl).hostname.replace(/^www\./, '');
        } catch {}

        const currentCount = domainCount.get(domain) || 0;
        if (currentCount >= MAX_PER_DOMAIN) return;

        seen.add(meta.murl);
        domainCount.set(domain, currentCount + 1);

        results.push({
          title: meta.t || meta.desc || query,
          imageUrl: meta.murl,
          thumbnailUrl: meta.turl || meta.murl,
          width: meta.imgw || 400,
          height: meta.imgh || 300,
          sourceUrl: meta.purl || '',
          domain,
          engine: 'bing',
        });
      }
    } catch {}
  });

  return results;
}

// ====================== YANDEX ======================
async function fetchYandexImages(query, page = 1, options = {}) {
  const { safeSearch = 'off', count = 35 } = options;
  const cleanQuery = encodeURIComponent(query.trim());
  const p = Math.max(0, page - 1);
  const family = safeSearch === 'off' ? 0 : safeSearch === 'strict' ? 2 : 1;

  const targetUrl = `https://yandex.com/images/search?text=${cleanQuery}&p=${p}&family=${family}&nomisspell=1`;

  let html = '';
  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `yp=1750000000.sp.family:${family}; yandexuid=${Math.floor(Math.random() * 1e18)};`,
        'Referer': 'https://yandex.com/',
      },
      timeout: 15000,
    });
    html = res.data;
  } catch (err) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const proxyRes = await axios.get(proxyUrl, { timeout: 15000 });
      html = proxyRes.data;
    } catch {
      console.error('Yandex error:', err.message);
      return [];
    }
  }

  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  const domainCount = new Map();
  const MAX_PER_DOMAIN = 3;

  // Cách 1: Parse từ data-state
  try {
    const app = $('[id^="ImagesApp-"][data-state]').first();
    const stateStr = app.attr('data-state');

    if (stateStr) {
      const state = JSON.parse(stateStr);
      const items = state?.initialState?.serpList?.items?.entities || {};
      const keys = state?.initialState?.serpList?.items?.keys || Object.keys(items);

      for (const key of keys) {
        const item = items[key];
        if (!item) continue;

        const imageUrl = item.origUrl || item.img_href || item.url;
        if (!imageUrl || seen.has(imageUrl)) continue;

        let domain = 'web';
        try {
          const source = item.snippet?.url || item.url;
          if (source) domain = new URL(source).hostname.replace(/^www\./, '');
        } catch {}

        const currentCount = domainCount.get(domain) || 0;
        if (currentCount >= MAX_PER_DOMAIN) continue;

        seen.add(imageUrl);
        domainCount.set(domain, currentCount + 1);

        results.push({
          title: item.snippet?.title || item.alt || query,
          imageUrl,
          thumbnailUrl: item.thumb?.url
            ? (item.thumb.url.startsWith('//') ? 'https:' + item.thumb.url : item.thumb.url)
            : imageUrl,
          width: item.thumb?.width || item.width || 400,
          height: item.thumb?.height || item.height || 300,
          sourceUrl: item.snippet?.url || item.url || '',
          domain,
          engine: 'yandex',
        });
      }
    }
  } catch (e) {
    console.warn('Yandex data-state parse failed:', e.message);
  }

  // Cách 2: Fallback (data-bem)
  if (results.length === 0) {
    $('div.serp-item, div.SerpItem').each((_, el) => {
      try {
        const data = $(el).attr('data-bem');
        if (!data) return;

        const parsed = JSON.parse(data);
        const item = parsed['serp-item'] || parsed;
        const imageUrl = item.img_href || item.origUrl;

        if (!imageUrl || seen.has(imageUrl)) return;

        let domain = 'yandex';
        try {
          if (item.snippet?.url) domain = new URL(item.snippet.url).hostname.replace(/^www\./, '');
        } catch {}

        const currentCount = domainCount.get(domain) || 0;
        if (currentCount >= MAX_PER_DOMAIN) return;

        seen.add(imageUrl);
        domainCount.set(domain, currentCount + 1);

        results.push({
          title: item.snippet?.title || query,
          imageUrl,
          thumbnailUrl: item.thumb?.url
            ? (item.thumb.url.startsWith('//') ? 'https:' + item.thumb.url : item.thumb.url)
            : imageUrl,
          width: item.thumb?.width || 400,
          height: item.thumb?.height || 300,
          sourceUrl: item.snippet?.url || '',
          domain,
          engine: 'yandex',
        });
      } catch {}
    });
  }

  return results.slice(0, count);
}