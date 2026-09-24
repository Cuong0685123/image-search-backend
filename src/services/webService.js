import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const BROWSER_HEADERS = {
  'User-Agent': 'OmniSearchApp/1.0 (contact: student@iuh.edu.vn)',
  'Accept': 'application/json',
};

export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing', count = 10 } = options;
  console.log(`[Tri Thức Service] Tìm kiếm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // Nguồn 2: Tra cứu khái niệm nhanh (DuckDuckGo Instant Answer)
  if (engine === 'yandex' || engine === 'yahoo' || engine === 'duckduckgo') {
    const instantResults = await fetchDuckDuckGoInstant(query);
    if (instantResults && instantResults.length > 0) {
      console.log(`[Tri Thức Service] DDG Instant tìm thấy: ${instantResults.length} mục`);
      return instantResults;
    }
  }

  // Nguồn 1 (Mặc định): Wikipedia Tiếng Việt Open API (Hỗ trợ phân trang vô hạn)
  const wikiResults = await fetchWikipediaVN(query, page, count);
  if (wikiResults && wikiResults.length > 0) {
    console.log(`[Tri Thức Service] Wikipedia tìm thấy: ${wikiResults.length} bài viết (Trang ${page})`);
    return wikiResults;
  }

  // Fallback sang DuckDuckGo Instant nếu Wikipedia rỗng
  return await fetchDuckDuckGoInstant(query);
}

// ====================== NGUỒN 1: WIKIPEDIA TIẾNG VIỆT API ======================
async function fetchWikipediaVN(query, page = 1, count = 10) {
  const cleanQuery = encodeURIComponent(query.trim());
  const offset = (Math.max(1, page) - 1) * count;

  // Endpoint chính thức của Wikipedia tiếng Việt, trả về JSON trực tiếp
  const targetUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${cleanQuery}&sroffset=${offset}&srlimit=${count}&format=json`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 6000,
    });

    const searchItems = res.data?.query?.search || [];
    if (!Array.isArray(searchItems) || searchItems.length === 0) return [];

    return searchItems.map((item) => {
      // Làm sạch các thẻ HTML <span> do Wikipedia highlight từ khóa
      const cleanSnippet = (item.snippet || '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/&quot;/g, '"')
        .trim();

      const pageUrl = `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;

      return {
        title: item.title,
        url: pageUrl,
        domain: 'vi.wikipedia.org',
        snippet: cleanSnippet.endsWith('.') ? cleanSnippet : `${cleanSnippet}...`,
        engine: 'wikipedia',
      };
    });
  } catch (err) {
    console.warn('[Wikipedia API Warning]:', err.message);
    return [];
  }
}

// ====================== NGUỒN 2: DUCKDUCKGO INSTANT ANSWER API ======================
async function fetchDuckDuckGoInstant(query) {
  const cleanQuery = encodeURIComponent(query.trim());
  const targetUrl = `https://api.duckduckgo.com/?q=${cleanQuery}&format=json&no_html=1&skip_disambig=0`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 5000,
    });

    const data = res.data;
    const results = [];

    // 1. Kết quả định nghĩa trừu tượng chính (Abstract)
    if (data?.AbstractText && data?.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        domain: data.AbstractSource || 'duckduckgo.com',
        snippet: data.AbstractText,
        engine: 'knowledge',
      });
    }

    // 2. Các chủ đề liên quan (RelatedTopics)
    const related = data?.RelatedTopics || [];
    for (const item of related) {
      if (item.Text && item.FirstURL) {
        let domain = 'duckduckgo.com';
        try {
          domain = new URL(item.FirstURL).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title: item.Text.split(' - ')[0] || item.Text.slice(0, 50),
          url: item.FirstURL,
          domain,
          snippet: item.Text,
          engine: 'knowledge',
        });
      }
    }

    return results;
  } catch (err) {
    console.warn('[DDG Instant Warning]:', err.message);
    return [];
  }
}