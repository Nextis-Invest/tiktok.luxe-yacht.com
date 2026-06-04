const https = require('https');

const BASE_URL = 'https://www.tikwm.com/api';
const TIMEOUT_MS = 30000;

async function getHashtagVideos(hashtag, limit) {
    const normalizedHashtag = hashtag.replace(/^#/, '').trim();
    if (!normalizedHashtag) return [];

    const challenge = await requestJson('/challenge/info', {
        challenge_name: normalizedHashtag,
    });

    const challengeId = challenge?.data?.id;
    if (!challengeId) return [];

    const count = limit > 0 ? limit : 30;
    const posts = await requestJson('/challenge/posts', {
        challenge_id: challengeId,
        count,
        cursor: 0,
    });

    const videos = posts?.data?.videos;
    if (!Array.isArray(videos)) return [];

    return videos.slice(0, count).map((video) => mapVideo(video, challenge.data));
}

function mapVideo(video, challenge) {
    const author = video.author || {};
    const music = video.music_info || {};
    const userName = author.unique_id || null;
    const videoId = video.video_id || null;
    const caption = video.title || '';

    return {
        searchHashtag: challenge.cha_name || null,
        numberOfViewsOnHashtag: challenge.view_count || null,
        videoId,
        videoUrlOnTiktok: userName && videoId ? `https://www.tiktok.com/@${userName}/video/${videoId}` : null,
        userId: author.id || null,
        userName,
        userNickname: author.nickname || null,
        userImageUrl: author.avatar || null,
        caption,
        hashtags: extractHashtags(caption),
        music: music.title || null,
        musicId: music.id || null,
        musicAuthor: music.author || null,
        musicUrl: music.play || video.music || null,
        coverUrl: video.cover || null,
        dynamicCoverUrl: video.ai_dynamic_cover || null,
        originCoverUrl: video.origin_cover || null,
        videoUrl: video.play || null,
        watermarkedVideoUrl: video.wmplay || null,
        duration: video.duration || null,
        region: video.region || null,
        plays: video.play_count || 0,
        likes: video.digg_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
        downloads: video.download_count || 0,
        collections: video.collect_count || 0,
        uploadDate: video.create_time ? new Date(video.create_time * 1000).toISOString() : null,
        scrapedAt: new Date().toISOString(),
        source: 'tikwm',
    };
}

function extractHashtags(text) {
    return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => ({
        hashtag: match[1],
        url: `https://www.tiktok.com/tag/${match[1]}`,
    }));
}

function requestJson(path, params) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }

    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            timeout: TIMEOUT_MS,
            headers: {
                accept: 'application/json',
                'user-agent': 'Mozilla/5.0 (compatible; tiktok.luxe-yacht.com/1.0)',
            },
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`TikWM returned HTTP ${response.statusCode}.`));
                    return;
                }
                try {
                    const json = JSON.parse(body);
                    if (json.code !== 0) {
                        reject(new Error(json.msg || 'TikWM returned an unsuccessful response.'));
                        return;
                    }
                    resolve(json);
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('timeout', () => {
            request.destroy(new Error('TikWM request timed out.'));
        });
        request.on('error', reject);
    });
}

module.exports = {
    getHashtagVideos,
};
