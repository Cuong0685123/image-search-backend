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
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing' } = options;
  console.log(`[Web Service] Tìm kiếm bài viết: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // NGUỒN 2: DuckDuckGo Lite (Chuyên trị từ khóa R18/Forum/Web tiếng Việt không kiểm duyệt)
  if (engine === 'yandex' || engine === 'duckduckgo') {
    const ddgResults = await fetchDuckDuckGoLiteWeb(query, page);
    if (ddgResults && ddgResults.length > 0) {
      console.log(`[Web Service] Nguồn 2 tìm thấy: ${ddgResults.length} bài viết (Trang ${page})`);
      return ddgResults;
    }
  }

  // NGUỒN 3: Yahoo Web Search
  if (engine === 'yahoo') {
    const yahooResults = await fetchYahooWeb(query, page);
    if (yahooResults && yahooResults.length > 0) {
      console.log(`[Web Service] Nguồn 3 tìm thấy: ${yahooResults.length} bài viết (Trang ${page})`);
      return yahooResults;
    }
  }

  // NGUỒN 1 (Mặc định): Bing Web Việt Nam (Ép thị trường vi-VN, SafeSearch OFF)
  const bingResults = await fetchBingWeb(query, page);
  if (bingResults && bingResults.length > 0) {
    console.log(`[Web Service] Nguồn 1 tìm thấy: ${bingResults.length} bài viết (Trang ${page})`);
    return bingResults;
  }

  // Fallback chéo sang DuckDuckGo Lite nếu nguồn được chọn không có dữ liệu
  return await fetchDuckDuckGoLiteWeb(query, page);
}

// ====================== NGUỒN 1: BING WEB CHUẨN THỊ TRƯỜNG VIỆT NAM ======================
async function fetchBingWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;

  // setmkt=vi-VN & setlang=vi giúp tìm chính xác từ khóa tiếng Việt ("Giáo dục iuh", tin tức, diễn đàn)
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&first=${first}&count=10&setmkt=vi-VN&setlang=vi&adlt=off&FORM=PERE`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=10; _EDGE_S=mkt=vi-VN&ui=vi-VN&F=1; MUIDB=1;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 9000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

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
  } catch (err) {
    console.warn('[Bing Web Warning]:', err.message);
  }

  // Fallback sang RSS chỉ ở trang đầu nếu HTML gặp trục trặc
  if (page === 1) {
    return await fetchBingWebRSS(query);
  }

  return [];
}

async function fetchBingWebRSS(query) {
  const cleanQuery = encodeURIComponent(query.trim());
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss&setmkt=vi-VN`;

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

// ====================== NGUỒN 2: DUCKDUCKGO LITE (KHÔNG LỌC R18 / BÀI VIẾT MỞ) ======================
async function fetchDuckDuckGoLiteWeb(query, page = 1) {
  const cleanQuery = query.trim();
  const sOffset = (Math.max(1, page) - 1) * 30;

  try {
    const params = new URLSearchParams();
    params.append('q', cleanQuery);
    params.append('kp', '-1'); // kp=-1: Tắt hoàn toàn SafeSearch để tìm được mọi bài viết R18
    params.append('kl', 'vn-vi'); // Ưu tiên định vị bài viết tiếng Việt
    if (sOffset > 0) {
      params.append('s', sOffset.toString());
    }

    const res = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://lite.duckduckgo.com',
        'Referer': 'https://lite.duckduckgo.com/',
      },
      timeout: 9000,
    });

    const $ = cheerio.load(res.data);
    const results = [];
    const seenUrls = new Set();

    $('a.result-link').each((_, el) => {
      try {
        let rawUrl = $(el).attr('href') || '';
        const title = $(el).text().trim();

        if (!title || !rawUrl) return;

        // Bóc link gốc từ uddg
        if (rawUrl.includes('uddg=')) {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match && match[1]) {
            try {
              rawUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!rawUrl.startsWith('http') || rawUrl.includes('duckduckgo.com') || seenUrls.has(rawUrl)) return;
        seenUrls.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        let snippet = '';
        const trParent = $(el).closest('tr');
        const nextTr = trParent.next();
        if (nextTr.length) {
          const snippetTd = nextTr.find('.result-snippet');
          if (snippetTd.length) {
            snippet = snippetTd.text().trim();
          }
        }

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet,
          engine: 'duckduckgo',
        });
      } catch {}
    });

    return results;
  } catch (err) {
    console.warn('[DDG Lite Web Warning]:', err.message);
    return [];
  }
}

// ====================== NGUỒN 3: YAHOO WEB (PHÂN TRANG OFFSET) ======================
async function fetchYahooWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const b = (Math.max(1, page) - 1) * 10 + 1;
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
    return [];
  }
}