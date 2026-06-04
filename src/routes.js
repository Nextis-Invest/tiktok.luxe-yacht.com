const Apify = require('apify');
const { getHashtagVideos } = require('./tikwm');

const { utils: { log } } = Apify;

exports.handleList = async ({ request, page }, requestQueue, maxResultsPerPage) => {
    // Wait for the network to settle, initially there will be 36 videos loaded. There
    // are more with a scroll event - not implemented yet.
    await page.waitForNetworkIdle({
        idleTime: 2000,
    });

    let videoUrls = await extractVideoUrls(page);

    log.info(`[SEARCH VIDEOS]: Found ${videoUrls.length} videos.`);
    if (maxResultsPerPage !== undefined && maxResultsPerPage !== 0) {
        videoUrls = videoUrls.splice(0, maxResultsPerPage);
    }
    log.info(`[SEARCH VIDEOS]: Adding ${videoUrls.length} videos to queue.`);

    if (request.url.includes('tag')) {
        if (!videoUrls.length) {
            const hashtag = request.url.split('/tag/')[1]?.split(/[?#/]/)[0];
            const fallbackVideos = await getHashtagVideos(decodeURIComponent(hashtag || ''), maxResultsPerPage);
            log.info(`[SEARCH VIDEOS]: TikWM fallback found ${fallbackVideos.length} videos.`);
            for (const video of fallbackVideos) {
                await Apify.pushData(video);
            }
            return;
        }

        // hashtag url
        const header = await page.evaluate(() => {
            return {
                searchHashtag: document.querySelector('header .share-title')
                    ?.innerText
                    .substr(1) || null,
                numberOfViewsOnHashtag: document.querySelector('header [title="views"]')
                    ?.innerText
                    .split(' ')[0] || null,
            };
        });
        for (const videoUrl of videoUrls) {
            const matchUrl = videoUrl.match(/.*\/video/);
            const matchVideoId = videoUrl.match(/[0-9]+/);
            if (matchUrl) {
                const userUrl = matchUrl[0];
                if (matchVideoId) {
                    await requestQueue.addRequest({
                        // '/video' part of the url we matched before have to be truncated
                        url: userUrl.substr(0, (userUrl.length - 6)),
                        userData: {
                            label: 'USER',
                            header,
                            videoUrl,
                        },
                        uniqueKey: matchVideoId[0],
                    });
                } else {
                    throw new Error('The video has no id defined.');
                }
            } else {
                throw new Error('User url was not found in video url.');
            }
        }
    } else {
        // user url
        const userInfo = await getUserInfo(page, request.url);

        for (const videoUrl of videoUrls) {
            await requestQueue.addRequest({
                url: videoUrl,
                userData: {
                    label: 'VIDEO',
                    userInfo,
                },
            });
        }
    }
};

async function extractVideoUrls(page) {
    return page.evaluate(() => {
        const urls = new Set();
        const collectVideoUrls = (value) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                value.forEach((item) => collectVideoUrls(item));
                return;
            }

            const id = value.id || value.videoId || value.video_id;
            const author = value.author || value.authorInfo;
            const username = author?.uniqueId || author?.unique_id || value.authorUniqueId || value.author_unique_id;
            if (id && username) {
                urls.add(`https://www.tiktok.com/@${username}/video/${id}`);
            }

            Object.values(value).forEach((item) => collectVideoUrls(item));
        };

        for (const link of document.querySelectorAll('a[href*="/video/"]')) {
            const href = link.href || link.getAttribute('href');
            if (href) urls.add(new URL(href, window.location.origin).href);
        }

        for (const script of document.querySelectorAll('script[type="application/json"]')) {
            try {
                collectVideoUrls(JSON.parse(script.textContent));
            } catch (error) {
                // Ignore non-hydration JSON scripts.
            }
        }

        return [...urls];
    });
}

exports.handleUser = async ({ request, page }, requestQueue) => {
    const userInfo = await getUserInfo(page, request.url);

    await requestQueue.addRequest({
        url: request.userData.videoUrl,
        userData: {
            label: 'VIDEO',
            header: request.userData.header,
            userInfo,
        },
    }, { forefront: true });
};

exports.handleVideo = async ({ request, page }) => {
    const output = await page.evaluate(() => {
        const nicknameAndDate = document.querySelector('.feed-item-content .author-nickname').innerText.split(' · ');
        const hashtags = [];
        [...document.querySelector('.feed-item-content .tt-video-meta-caption').querySelectorAll('a')]
            .map((hashtag) => {
                hashtags.push({
                    hashtag: hashtag.innerText.substr(1).trim(),
                    url: `https://www.tiktok.com${hashtag.getAttribute('href')}`,
                });
            });
        const video = document.querySelector('.feed-item-content .item-video-container video');

        return {
            userImageUrl: document.querySelector('.video-detail .user-avatar img').getAttribute('src'),
            userName: document.querySelector('.feed-item-content .author-uniqueId').innerText,
            userNickname: nicknameAndDate[0] || null,
            uploadDate: nicknameAndDate[1] || null,
            caption: document.querySelector('.feed-item-content .tt-video-meta-caption').querySelector('strong').innerText.trim(),
            hashtags,
            music: document.querySelector('.feed-item-content .tt-video-music').innerText,
            userId: video.getAttribute('authorid'),
            videoUrl: video.getAttribute('src'),
            likes: document.querySelector('.feed-item-content .item-video-container [title="like"]').innerText,
            comments: document.querySelector('.feed-item-content .item-video-container [title="comment"]').innerText,
            shares: document.querySelector('.feed-item-content .item-video-container [title="share"]').innerText,
            scrapedAt: new Date().toISOString(),
        };
    });

    await Apify.pushData({
        ...(request.userData.header ?? {}),
        ...request.userData.userInfo,
        ...output,
        videoUrlOnTiktok: request.url,
        videoId: request.url.match(/[0-9]+/)[0],
    });
};

const getUserInfo = async (page, url) => {
    return page.evaluate((userPageUrl) => {
        const shareLinks = [];
        if (document.querySelector('.share-links')) {
            [...document.querySelector('.share-links')
                .querySelectorAll('a')]
                .map((link) => {
                    shareLinks.push(link.innerText);
                });
        }

        return {
            userUrl: userPageUrl,
            following: document.querySelector('.count-infos [title="Following"]').innerText,
            followers: document.querySelector('.count-infos [title="Followers"]').innerText,
            userTotalLikes: document.querySelector('.count-infos [title="Likes"]').innerText,
            userDescription: document.querySelector('.share-desc').innerText,
            userShareLinks: shareLinks,
        };
    }, url);
};
