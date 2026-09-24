import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export async function extractAllVideosFromUrl(targetUrl) {
  if (!targetUrl) return [];

  // Nếu bản thân link đã là file stream .mp4/.m3u8/.webm
  if (/\.(mp4|webm|m3u8|ogg)($|\?)/i.test(targetUrl)) {
    try {
      const hostname = new URL(targetUrl).hostname;
      return [{
        title: 'Direct Video Stream',
        videoUrl: targetUrl,
        streamUrl: targetUrl,
        publisher: hostname,
      }];
    } catch {
      return [];
    }
  }

  try {
    const res = await axios.get(targetUrl, {
      headers: {
        ...BROWSER_HEADERS,
        'Referer': targetUrl,
      },
      httpsAgent,
      timeout: 15000,
      maxRedirects: 5,
    });

    const html = res.data;
    if (typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    let pageTitle = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || 
                    'Extracted Video';

    // 1. Quét thẻ meta video chuẩn (og:video, twitter:player:stream)
    const ogVideo = $('meta[property="og:video"]').attr('content') ||
                    $('meta[property="og:video:url"]').attr('content') ||
                    $('meta[property="og:video:secure_url"]').attr('content') ||
                    $('meta[name="twitter:player:stream"]').attr('content');

    if (ogVideo && !seenUrls.has(ogVideo)) {
      seenUrls.add(ogVideo);
      results.push({
        title: pageTitle,
        videoUrl: targetUrl,
        streamUrl: ogVideo,
        publisher: 'Meta Video',
      });
    }

    // 2. Quét thẻ <video> và <source>
    $('video source, video').each((_, el) => {
      let src = $(el).attr('src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        else if (src.startsWith('/')) {
          try {
            src = new URL(targetUrl).origin + src;
          } catch {}
        }
        if (!seenUrls.has(src)) {
          seenUrls.add(src);
          results.push({
            title: pageTitle,
            videoUrl: targetUrl,
            streamUrl: src,
            publisher: 'HTML5 Video',
          });
        }
      }
    });

    // 3. Regex quét tìm các URL đuôi .mp4 / .m3u8 nhúng trong script & JSON
    const matches = html.match(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:mp4|m3u8|webm)[^"'\s<>]*/gi) || [];
    for (let rawUrl of matches) {
      let cleanUrl = rawUrl.replace(/\\\//g, '/');
      try {
        cleanUrl = decodeURIComponent(cleanUrl);
      } catch {}

      if (!seenUrls.has(cleanUrl) && !cleanUrl.includes('placeholder')) {
        seenUrls.add(cleanUrl);
        results.push({
          title: pageTitle,
          videoUrl: targetUrl,
          streamUrl: cleanUrl,
          publisher: 'Direct Stream',
        });
      }
    }

    // 4. Nếu chưa có kết quả, quét iframe nhúng
    if (results.length === 0) {
      $('iframe[src]').each((_, el) => {
        let src = $(el).attr('src');
        if (src && !seenUrls.has(src)) {
          if (src.startsWith('//')) src = 'https:' + src;
          seenUrls.add(src);
          results.push({
            title: pageTitle,
            videoUrl: targetUrl,
            streamUrl: src,
            isEmbed: true,
            publisher: 'Embed Player',
          });
        }
      });
    }

    return results;
  } catch (err) {
    console.warn(`Lỗi bóc tách video từ ${targetUrl}:`, err.message);
    return [];
  }
}

export async function extractDirectVideo(targetUrl) {
  const videos = await extractAllVideosFromUrl(targetUrl);
  return videos.length > 0 ? (videos[0].streamUrl || null) : null;
}