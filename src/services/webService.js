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
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing' } = options;
  console.log(`[Web Service] Đang tìm kiếm bài viết: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // Nguồn 2: Ưu tiên Yahoo Search
  if (engine === 'yandex' || engine === 'yahoo') {
    const yahooResults = await fetchYahooWeb(query, page);
    if (yahooResults && yahooResults.length > 0) {
      console.log(`[Web Service] Yahoo tìm thấy: ${yahooResults.length} bài viết (Trang ${page})`);
      return yahooResults;
    }
  }

  // Nguồn 1 (Mặc định): Bing Web Search (Hỗ trợ phân trang chuẩn xác)
  const bingResults = await fetchBingWeb(query, page);
  if (bingResults && bingResults.length > 0) {
    console.log(`[Web Service] Bing tìm thấy: ${bingResults.length} bài viết (Trang ${page})`);
    return bingResults;
  }

  // Fallback sang Yahoo nếu Bing không ra kết quả
  const fallbackYahoo = await fetchYahooWeb(query, page);
  if (fallbackYahoo && fallbackYahoo.length > 0) {
    console.log(`[Web Service] Fallback Yahoo tìm thấy: ${fallbackYahoo.length} bài viết`);
    return fallbackYahoo;
  }

  return [];
}

// ====================== NGUỒN 1: BING WEB (PHÂN TRANG CHUẨN XÁC) ======================
async function fetchBingWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;

  // 1. Thử cào giao diện HTML chính thức của Bing với tham số first= chuẩn
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&first=${first}&FORM=PERE`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=10; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 8000,
    });

    const html = res.data;
    if (html && typeof html === 'string') {
      const $ = cheerio.load(html);
      const results = [];
      const seenUrls = new Set();

      $('li.b_algo').each((_, el) => {
        try {
          const titleEl = $(el).find('h2 a').first();
          const rawUrl = titleEl.attr('href');
          const title = titleEl.text().trim();
          const snippet = $(el).find('.b_caption p, .b_lineclamp2, .b_snippet').first().text().trim();

          if (!rawUrl || !title || !rawUrl.startsWith('http') || rawUrl.includes('bing.com')) return;
          if (seenUrls.has(rawUrl)) return;
          seenUrls.add(rawUrl);

          let domain = 'web';
          try {
            domain = new URL(rawUrl).hostname.replace(/^www\./, '');
          } catch {}

          results.push({
            title,
            url: rawUrl,
            domain,
            snippet: snippet.replace(/<[^>]*>?/gm, '').trim(),
            engine: 'bing',
          });
        } catch {}
      });

      if (results.length > 0) return results;
    }
  } catch (err) {
    console.warn('[Bing HTML Web Warning]:', err.message);
  }

  // 2. Fallback sang Bing RSS nếu HTML bị chặn (chỉ hiệu quả nhất ở trang 1)
  if (page === 1) {
    return await fetchBingWebRSS(query);
  }

  return [];
}

// Bing RSS hỗ trợ dự phòng cho trang đầu
async function fetchBingWebRSS(query) {
  const cleanQuery = encodeURIComponent(query.trim());
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 7000,
    });

    const xmlData = res.data;
    if (!xmlData || typeof xmlData !== 'string') return [];

    const $ = cheerio.load(xmlData, { xmlMode: true });
    const results = [];
    const seenUrls = new Set();

    $('item').each((_, el) => {
      try {
        const title = $(el).find('title').first().text().trim();
        const rawUrl = $(el).find('link').first().text().trim();
        const snippet = $(el).find('description').first().text().trim();

        if (!title || !rawUrl || !rawUrl.startsWith('http') || seenUrls.has(rawUrl)) return;
        seenUrls.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet: snippet.replace(/<[^>]*>?/gm, '').trim(),
          engine: 'bing',
        });
      } catch {}
    });

    return results;
  } catch {
    return [];
  }
}

// ====================== NGUỒN 2: YAHOO WEB (PHÂN TRANG OFFSET) ======================
async function fetchYahooWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const b = (Math.max(1, page) - 1) * 10 + 1; // 1, 11, 21, 31...
  const targetUrl = `https://search.yahoo.com/search?p=${cleanQuery}&b=${b}&nojs=1`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://search.yahoo.com/',
      },
      timeout: 8000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    $('.algo, .searchCenterMiddle li, #web li').each((_, el) => {
      try {
        const linkEl = $(el).find('h3 a, a.fz-m').first();
        let rawUrl = linkEl.attr('href');
        const title = linkEl.text().trim();
        const snippet = $(el).find('.compText, .fz-ms, span.fc-2nd').first().text().trim();

        if (!rawUrl || !title) return;

        // Bóc link thực từ chuyển hướng RU= của Yahoo
        if (rawUrl.includes('/RU=')) {
          const match = rawUrl.match(/\/RU=([^/]+)/);
          if (match && match[1]) {
            try {
              rawUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!rawUrl.startsWith('http') || rawUrl.includes('yahoo.com') || seenUrls.has(rawUrl)) return;
        seenUrls.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet,
          engine: 'yahoo',
        });
      } catch {}
    });

    return results;
  } catch (err) {
    console.warn('[Yahoo Web Error]:', err.message);
    return [];
  }
}