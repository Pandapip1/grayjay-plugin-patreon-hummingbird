const PLATFORM = "Patreon";
const PLATFORM_CLAIMTYPE = 12;

const BASE_URL = "https://www.patreon.com";
const BASE_URL_API = "https://www.patreon.com/api";
const URL_HOME = BASE_URL + "/home";
const URL_POSTS = BASE_URL_API + "/posts";
const URL_SEARCH_CREATORS = BASE_URL_API + "/search";
const URL_USER = BASE_URL_API + "/current_user";
const URL_LAUNCHER_CARDS = BASE_URL_API + "/launcher/cards";

const REGEX_CHANNEL_DETAILS = /Object\.assign\(window\.patreon\.bootstrap, ({.*?})\);/s
const REGEX_CHANNEL_DETAILS2 = /window\.patreon = ({.*?});/s
const REGEX_CHANNEL_DETAILS3 = /id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
const REGEX_CHANNEL_URL = /https:\/\/(?:www\.)?patreon.com\/(.+)/s
const REGEX_PROFILE_URL = /https:\/\/(?:www\.)?patreon.com\/profile(?:\/creators)?\?u=(\d+)/s

const REGEX_MEMBERSHIPS = /<ul aria-label="Memberships".*?>(.*?)<\/ul>/s
const REGEX_MEMBERSHIPS_URLS = /<a href="(.*?)"/g
const REGEX_URL_ID = /https:\/\/(?:www\.)?patreon.com\/posts\/.*-(.*)\/?/s

// Common request modifier for all Patreon requests
let PATREON_REQUEST_MODIFIER = {
	headers: {
		"Referer": "https://www.patreon.com/",
		"Origin": "https://www.patreon.com"
	}
};

var config = {};
var _settings = {};

let _channelCache = {};

/**
 * Gets the requested url and returns the response body either as a string or as a parsed json object
 * @param {Object} options - The options object
 * @param {string} options.url - The URL to call
 * @param {boolean} [options.useAuthenticated=false] - If true, will use the authenticated headers
 * @param {boolean} [options.parseResponse=true] - If true, will parse the response as json and check for errors
 * @param {Object} [options.headers=null] - Custom headers to use for the request
 * @returns {string | Object} the response body as a string or the parsed json object
 * @throws {ScriptException}
 */
function httpGET(options) {
    const {
        url,
        useAuthenticated = false,
        parseResponse = true,
        headers = null
    } = options;

    const localHeaders = headers ?? PATREON_REQUEST_MODIFIER.headers;

    const resp = http.GET(
        url,
        localHeaders,
        useAuthenticated
    );

    if (!resp.isOk) {
        throwIfCaptcha(resp);
        const error = new ScriptException("Request [" + url + "] failed with code [" + resp.code + "]");
        error.code = resp.code;
        throw error;
    }

    if (parseResponse) {
        const json = JSON.parse(resp.body);
        if (json.errors && json.errors.length > 0) {
            throw new ScriptException(json.errors[0].message || "API returned errors");
        }
        return json;
    }

    return resp.body;
}


//Source Methods
source.enable = function (conf, settings, savedState) {
	config = conf ?? {};
	_settings = settings ?? {};

	PATREON_REQUEST_MODIFIER.headers["User-Agent"] = config.authentication.userAgent;

}
source.getHome = function () {

	if (!bridge.isLoggedIn()) {
		return new ContentPager([], false);
	}

	try {
		httpGET({
			url: BASE_URL,
			useAuthenticated: false,
			parseResponse: false
		});
	} catch (error) {
		throw new ScriptException("Failed to get home page");
	}
	
	return new HomePager();
};

source.searchSuggestions = function (query) {
	return [];
};
source.getSearchCapabilities = () => {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: []
	};
};
source.search = function (query, type, order, filters) {
	return new ContentPager([], false);
};
source.getSearchChannelContentsCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: []
	};
};

source.searchChannels = function (query) {
	return new SearchChannelPager(query);
};
class SearchChannelPager extends ChannelPager {
	constructor(query) {
		super(searchChannels(query, 1))
		this.query = query;
		this.page = 1;
	}
	nextPage() {
		this.page = this.page + 1;
		this.results = searchChannels(query, this.page + 1);
		this.hasMore = this.results.length > 0;
		return this;
	}
}

//Home Pager
class HomePager extends ContentPager {
	constructor() {
		const initialData = getHomeContent();
		super(initialData.results, initialData.hasMore);
		this.nextPageUrl = initialData.nextPageUrl;
	}
	
	nextPage() {
		if (!this.nextPageUrl) {
			this.hasMore = false;
			return this;
		}
		
		const newData = getHomeContent(this.nextPageUrl);
		this.results = newData.results;
		this.hasMore = newData.hasMore;
		this.nextPageUrl = newData.nextPageUrl;
		return this;
	}
}

//Channel
source.isChannelUrl = function (url) {
	return REGEX_CHANNEL_URL.test(url);
};

// Function to get channel information from vanity URL
function getChannelFromVanityUrl(url, htmlContent) {
	// First, try to extract campaign ID from HTML content
	let campaignId = null;
	
	if (htmlContent) {
		// Look for campaign ID in various places in the HTML
		const campaignIdPatterns = [
			/campaign\/(\d+)/g,
			/p\/campaign\/(\d+)/g,
			/campaign_id['":\s]*(\d+)/g,
			/"id":\s*"?(\d+)"?[,}]/g
		];
		
		for (const pattern of campaignIdPatterns) {
			let match;
			while ((match = pattern.exec(htmlContent)) !== null) {
				// Look for IDs that are likely campaign IDs (8+ digits)
				if (match[1] && match[1].length >= 5) {
					campaignId = match[1];
					break;
				}
			}
			if (campaignId) break;
		}
	}
	
	if (campaignId) {
		// Try to get campaign data via campaigns API
		const apiUrl = BASE_URL_API + "/campaigns/" + campaignId + "?" + SOCIAL_LINKS_QUERY;
		
		try {
			const apiData = httpGET({
				url: apiUrl,
				useAuthenticated: true,
				parseResponse: true
			});
			if (apiData.data && apiData.data.attributes) {
				// Convert API response to expected format
				const channel = {
					campaign: {
						data: {
							id: apiData.data.id,
							attributes: {
								name: apiData.data.attributes.name,
								description: apiData.data.attributes.description || apiData.data.attributes.summary,
								url: apiData.data.attributes.url,
								patron_count: apiData.data.attributes.patron_count,
								avatar_photo_url: apiData.data.attributes.avatar_photo_url,
								image_url: apiData.data.attributes.image_url || apiData.data.attributes.cover_photo_url
							}
						}
					}
				};
				
				const links = extractSocialLinks(apiData.included);
				return campaignToPlatformChannel(channel, links);
			}
		} catch (error) {
			// Continue to error handling below
		}
	}

	throw new ScriptException("Failed to get channel from HTML content. Campaign ID not found or API call failed.");
}

// Function to get channel information from user ID (for profile/creators URLs)
function getChannelFromUserId(userId, originalUrl) {
	// First, try to get user information from the API
	const userApiUrl = BASE_URL_API + "/user/" + userId + "?include=campaign";
	const userData = httpGET({
		url: userApiUrl,
		useAuthenticated: true,
		parseResponse: true
	});

	if (userData) {

		// Check if user has a campaign (is a creator) via relationships
		if (userData.data && userData.data.relationships && userData.data.relationships.campaign) {
			const campaignId = userData.data.relationships.campaign.data.id;
			const campaign = userData.included?.find(item => item.type === 'campaign' && item.id === campaignId);

			if (campaign) {
				const links = fetchSocialLinks(campaignId);
				const channel = campaignToPlatformChannel({ campaign: { data: campaign }}, links);
				_channelCache[originalUrl] = channel;
				return channel;
			}
		}

		// If we have user data, create a basic channel from the user information
		if (userData.data && userData.data.attributes) {
			const userAttrs = userData.data.attributes;

			// Create a minimal channel object from user data
			const basicChannel = {
				campaign: {
					data: {
						id: userId, // Use user ID as campaign ID
						attributes: {
							name: userAttrs.full_name || userAttrs.vanity || "Unknown Creator",
							description: userAttrs.about || "",
							url: userAttrs.url || (BASE_URL + "/" + userAttrs.vanity),
							patron_count: 0, // We don't have this info
							avatar_photo_url: userAttrs.image_url || userAttrs.thumb_url,
							image_url: userAttrs.image_url || userAttrs.thumb_url
						}
					}
				}
			};

			return campaignToPlatformChannel(basicChannel);
		}
	}

	throw new ScriptException("Failed to get channel from user ID: " + userId);
}
source.getChannel = function (url) {
	let channelResp;
	let finalUrl;
	
	try {
		const response = httpGET({
			url: url,
			useAuthenticated: false,
			parseResponse: false
		});
		channelResp = { body: response };
		finalUrl = url; // httpGET doesn't expose redirect URL, using original
	} catch (error) {
		if (error.code === 404)
			throw new UnavailableException("Channel not found");
		throw new ScriptException("Failed to get channel");
	}

	const urlSet = new Set([url, finalUrl]);
	
	// Check if this is a profile URL (with or without /creators)
	const profileMatch = REGEX_PROFILE_URL.exec(finalUrl);
	if (profileMatch) {
		const userId = profileMatch[1];
		const profileChannel = getChannelFromUserId(userId, finalUrl);
		urlSet.add(`https://www.patreon.com/profile/creators?u=${userId}`);
		profileChannel.urlAlternatives = Array.from(urlSet);
		_channelCache[url] = profileChannel;
		return profileChannel;
	}

	let channelJson = REGEX_CHANNEL_DETAILS.exec(channelResp.body);
	let channel = null;
	if (!channelJson || channelJson.length != 2) {
		channelJson = REGEX_CHANNEL_DETAILS2.exec(channelResp.body);
		if (channelJson && channelJson.length == 2) {
			channel = JSON.parse(channelJson[1]);

			if (channel && channel.bootstrap)
				channel = channel.bootstrap;
			else
				throw new ScriptException("Failed to parse channel");
		}
		else {
			channelJson = REGEX_CHANNEL_DETAILS3.exec(channelResp.body);
			if (channelJson && channelJson.length == 2) {
				const channelWrapperObj = JSON.parse(channelJson[1]);
				const envelope = channelWrapperObj?.props?.pageProps?.bootstrapEnvelope;
				channel = envelope?.bootstrap ?? envelope?.pageBootstrap;

				if (!channel)
					throw new ScriptException("Failed to parse channel");

				if (channel.curtainType === "campaign_removed")
					throw new UnavailableException("This page has been removed.");
			}
			else {
				// Try API approach
				const channel = getChannelFromVanityUrl(url, channelResp.body);
				channel.urlAlternatives = Array.from(urlSet);
				_channelCache[url] = channel;
				return channel;
			}
		}
	}
	else
		channel = JSON.parse(channelJson[1]);

	const campaignId = channel?.campaign?.data?.id;
	const links = campaignId ? fetchSocialLinks(campaignId) : {};
	_channelCache[url] = campaignToPlatformChannel(channel, links);
	return _channelCache[url];
};
source.getChannelContents = function (url) {
	const channel = (_channelCache[url]) ? _channelCache[url] : source.getChannel(url);
	_channelCache[url] = channel;
	return new ChannelContentPager(channel.id.value, channel);
};
class ChannelContentPager extends ContentPager {
	constructor(campaignId, channel) {
		const initialResults = getPosts(campaignId, channel);
		super(initialResults.results, true);
		this.nextPageUrl = initialResults.nextPage;
		this.hasMore = !!this.nextPageUrl;
		this.campaignId = campaignId;
		this.channel = channel;
	}
	nextPage() {
		if (!this.nextPage)
			throw new ScriptException("No next page");
		const newResults = getPosts(this.campaignId, this.channel, this.nextPageUrl) ?? [];
		this.results = newResults.results;
		this.nextPageUrl = newResults.nextPage;
		this.hasMore = !!newResults.nextPage;
		return this;
	}
}

source.getChannelTemplateByClaimMap = () => {
	return {
		//Patreon
		12: {
			0: BASE_URL + "/{{CLAIMVALUE}}"
		}
	};
};

//Video
source.isContentDetailsUrl = function (url) {
	return REGEX_URL_ID.test(url);
};

source.getContentDetails = function (url) {
    const postId = getPostIdFromUrl(url);
    
    try {
        const postBody = httpGET({
            url: `https://www.patreon.com/api/posts/${postId}`,
            useAuthenticated: true,
            parseResponse: true
        });
        const campaign = postBody.included.find(a => a.type == 'campaign');
        const channel = campaignToPlatformChannel({ campaign: { data : campaign }});
        return parseSinglePost(postBody.data, postBody, channel, true);
    } catch (error) {
        throw new ScriptException("Failed to get post details");
    }
};

//Comments
source.getComments = function (url, page = 0) {
	const idMatch = REGEX_URL_ID.exec(url) ?? [];
	if (idMatch.length != 2)
		return new CommentPager([], false);
	const id = idMatch[1];
	
	try {
		const commentsData = httpGET({
			url: "https://www.patreon.com/api/posts/" + id + "/comments" +
				"?include=include_replies%2Ccommenter%2Creplies%2Creplies.commenter" +
				"&fields[comment]=body%2Ccreated%2Cvote_sum%2Creply_count" +
				"&fields[post]=comment_count" +
				"&fields[user]=image_url%2Cfull_name%2Curl" +
				"&fields[flair]=image_tiny_url%2Cname" +
				"&page[count]=10" +
				"&sort=-created" +
				"&json-api-use-default-includes=false" +
				"&json-api-version=1.0",
			useAuthenticated: true,
			parseResponse: true
		});
		return new PatreonCommentPager(url, commentsData);
	} catch (error) {
		throw new ScriptException("Failed to get comments");
	}
}
source.getSubComments = function (comment) {
	return new CommentPager([], false);
}

class PatreonCommentPager extends CommentPager {

	constructor(url, resp) {
		if (IS_TESTING)
			log("CommentPager resp:", resp);

		const nextUrl = resp?.links?.next;
		super([], !!nextUrl);
		this.contextUrl = url;
		this.results = this.parseResponse(resp);
		this.nextPageUrl = nextUrl;
		this.hasMore = !!nextUrl;
	}

	nextPage() {
		try {
			const responseBody = httpGET({
				url: this.nextPageUrl,
				useAuthenticated: true,
				parseResponse: true
			});
			this.results = this.parseResponse(responseBody);
			this.nextPageUrl = responseBody?.links?.next;
			
			this.hasMore = !!this.nextPageUrl;
			
			return this;
		} catch (error) {
			throw new ScriptException("Failed to get next comment page");
		}
	}

	parseResponse(resp) {
		return resp.data.map(x => this.parseComment(x, resp)).filter(x => x != null)
	}
	parseComment(comment, resp) {
		const commenterId = comment?.relationships?.commenter?.data?.id;
		if (!commenterId)
			return null;
		const commenter = resp.included?.find(y => y.id == commenterId);
		if (!commenter)
			return null;

		return new PatreonComment({
			contextUrl: this.contextUrl,
			author: new PlatformAuthorLink(new PlatformID(config.name, comment.id, PLATFORM_CLAIMTYPE), commenter.attributes.full_name, commenter.attributes.url, commenter.attributes.image_url),
			message: comment.attributes.body,
			rating: new RatingLikes(comment.attributes.vote_sum),
			date: parseInt(Date.parse(comment.attributes.created) / 1000),
			replyCount: comment.attributes.reply_count ?? 0,
			subComments: comment.relationships.replies?.data
				?.map(y => resp.included?.find(z => z.id == y.id))
				?.map(y => this.parseComment(y, resp))
				?.filter(z => z != null) ?? []
		});
	}
}

class PatreonComment extends Comment {
	constructor(obj) {
		super(obj);

		if (obj.subComments)
			this.subComments = obj.subComments;
		else
			this.subComments = [];
	}

	getReplies() {
		return new CommentPager(this.subComments, false);
	}
}

source.getUserSubscriptions = function () {
	try {
		const response = httpGET({
			url: URL_USER + "?include=active_memberships.campaign",
			useAuthenticated: true,
			parseResponse: true
		});

		return response.data.relationships.active_memberships.data.map((membership) => {
			const channel_id = response.included.find((extra) => extra.id === membership.id).relationships.campaign.data.id
			const channel_url = response.included.find((extra) => extra.id === channel_id).attributes.url
			return channel_url
		});
	} catch (error) {
		throw new ScriptException("Failed to get subscriptions");
	}
}

function getPosts(campaign, context, nextPage) {
	try {
		const data = httpGET({
			url: (!nextPage) ? BASE_URL_API + "/posts" +
				"?filter[campaign_id]=" + campaign +
				"&include=images" +
				"&filter[contains_exclusive_posts]=true" +
				"&sort=-published_at" : nextPage,
			useAuthenticated: true,
			parseResponse: true
		});

	if (IS_TESTING)
		console.log("getPosts data:", data);

		// Map all posts to Platform content using the reusable mapping functions
		const contents = data?.data
			?.map(post => mapPostToPlatformContent(post, context, data))
			?.filter(content => content != null) ?? [];

		return {
			results: contents,
			nextPage: data?.links?.next
		};
	} catch (error) {
		log("Failed to get posts: " + error.message);
		return {
			results: [],
			nextPage: null,
			hasMore: false
		};
	}
}

const SOCIAL_LINKS_QUERY = "&include=connected_socials,creator" +
	"&fields[connected_socials]=app_name,external_profile_url,is_public" +
	"&fields[user]=youtube,twitter,twitch,facebook" +
	"&json-api-use-default-includes=false";

const SOCIAL_APP_NAME_MAP = {
	"youtube": "YouTube",
	"twitter": "Twitter",
	"twitch": "Twitch",
	"facebook": "Facebook",
	"instagram": "Instagram",
	"tiktok": "TikTok",
	"discord": "Discord",
	"spotify": "Spotify",
	"reddit": "Reddit",
	"vimeo": "Vimeo"
};

function extractSocialLinks(included) {
	const links = {};
	if (!included) return links;

	// Extract from connected_socials (OAuth-connected, shown on about page)
	for (const item of included) {
		if (item.type === "social-connection" && item.attributes?.is_public && item.attributes?.external_profile_url) {
			const name = SOCIAL_APP_NAME_MAP[item.attributes.app_name] || item.attributes.app_name;
			links[name] = item.attributes.external_profile_url;
		}
	}

	// Extract legacy user fields as fallback
	const user = included.find(item => item.type === "user");
	if (user?.attributes) {
		if (user.attributes.youtube && !links["YouTube"])
			links["YouTube"] = user.attributes.youtube;
		if (user.attributes.twitter && !links["Twitter"])
			links["Twitter"] = "https://twitter.com/" + user.attributes.twitter;
		if (user.attributes.twitch && !links["Twitch"])
			links["Twitch"] = user.attributes.twitch;
		if (user.attributes.facebook && !links["Facebook"])
			links["Facebook"] = user.attributes.facebook;
	}

	return links;
}

function fetchSocialLinks(campaignId) {
	try {
		const data = httpGET({
			url: BASE_URL_API + "/campaigns/" + campaignId + "?" + SOCIAL_LINKS_QUERY,
			useAuthenticated: true,
			parseResponse: true
		});
		return extractSocialLinks(data.included);
	} catch (error) {
		return {};
	}
}

function campaignToPlatformChannel(channel, links) {

	return new PlatformChannel({
		id: new PlatformID(config.name, channel?.campaign?.data?.id, config.id, PLATFORM_CLAIMTYPE),
		name: channel?.campaign?.data?.attributes?.name,
		description: channel?.campaign?.data?.attributes?.description ?? channel?.campaign?.data?.attributes?.summary,
		url: channel?.campaign?.data?.attributes?.url,
		subscribers: channel?.campaign?.data?.attributes?.patron_count,
		banner: channel?.campaign?.data?.attributes?.image_url ?? channel?.campaign?.data?.attributes?.cover_photo_url ?? channel?.campaign?.data?.attributes?.cwh_cover_image_urls?.large,
		thumbnail: channel?.campaign?.data?.attributes?.avatar_photo_url ?? channel?.campaign?.data?.attributes?.avatar_photo_image_urls?.thumbnail,
		links: links ?? {}
	})
}

function parseSinglePost(item, data, context, isDetails=false) {
    if (!item) return null;

    if (isDetails) {
        // Throw unsupported error for PlatformNestedMediaContent or PlatformPostDetails
        if (item?.attributes?.embed || 
            item?.attributes?.post_type == 'text_only' ||
            item?.attributes?.post_type == 'image_file') {
            throw new UnavailableException("Unsupported content type while deep linking. Consider opening it from inside the channel.");
        }
    }

    return mapPostToPlatformContent(item, context, data);
}


function searchChannels(query, page) {
	try {
		const data = httpGET({
			url: URL_SEARCH_CREATORS +
				"?q=" + query +
				"&page[number]=" + page +
				"&json-api-version=1.0&includes=[]",
			useAuthenticated: false,
			parseResponse: true
		});

		const channels = [];
		for (let item of data.data) {
			const id = item.id;
			if (id.startsWith("campaign_"))
				channels.push(new PlatformAuthorLink(new PlatformID(config.name, id.substring("campaign_".length), config.id, PLATFORM_CLAIMTYPE),
					item.attributes.name,
					item.attributes.url,
					item.attributes.avatar_photo_url,
					item.attributes.patron_count));
		}

		return channels.filter(x => x != null);
	} catch (error) {
		throw new ScriptException("Failed to search creators");
	}
}

function getPostIdFromUrl(url) {
	const match = url.match(/\/posts\/(?:[\w-]+-)?(\d+)/);
    return match ? match[1] : null;
}


// Function to get home content from launcher/cards API
function getHomeContent(url) {
	const requestUrl = url || (URL_LAUNCHER_CARDS + 
		"?include=campaign.creator.null,campaign.null,campaign.rewards.null,campaign.current_user_pledge.null," +
		"latest_posts,latest_posts.audio.null,latest_posts.recent_comments.parent,latest_posts.recent_comments.on_behalf_of_campaign.null," +
		"latest_posts.recent_comments.commenter.campaign.null,latest_posts.recent_comments.commenter_identity," +
		"latest_posts.recent_comments.commenter_identity.primary_avatar,latest_posts.recent_comments.first_reply.commenter_identity," +
		"latest_posts.recent_comments.first_reply.commenter_identity.primary_avatar,latest_posts.recent_comments.first_reply.commenter.campaign.null," +
		"latest_posts.recent_comments.first_reply.parent,latest_posts.recent_comments.first_reply.post," +
		"latest_posts.recent_comments.first_reply.on_behalf_of_campaign.null,latest_posts.images.null,latest_posts.poll.null," +
		"latest_posts.poll.choices,latest_posts.poll.current_user_responses.user.null,latest_posts.poll.current_user_responses.choice," +
		"latest_posts.access_rules,latest_posts.access_rules.tier,latest_posts.drop,latest_posts.livestream,latest_posts.shows," +
		"latest_posts.content_unlock_options,latest_posts.content_unlock_options.product_variant.null," +
		"latest_posts.content_unlock_options.product_variant.collection.null,latest_posts.content_unlock_options.reward.null," +
		"latest_highlights,latest_product_variant,latest_product_variant.content_media,latest_product_variant.preview_media," +
		"upcoming_drops.null,upcoming_drops.post.null,upcoming_drops.post.drop.null,upcoming_drops.post.livestream,upcoming_drops.post.audio.null%5E" +
		"&fields%5Bcampaign%5D=id,avatar_photo_image_urls,name,url,vanity,cover_photo_url_sizes,creation_count,currency," +
		"current_user_is_free_member,main_video_embed,main_video_url,offers_paid_membership,one_liner,pay_per_name,post_count," +
		"pledge_url,primary_theme_color,summary,is_monthly%5E" +
		"&fields%5Bcomment%5D=body,created,deleted_at,is_by_patron,is_by_creator,is_liked_by_creator,vote_sum,current_user_vote,reply_count,visibility_state" +
		"&fields%5Bcontent-unlock-option%5D=content_unlock_type,reward_benefit_categories" +
		"&fields%5Bdisplay-identity%5D=name,link_url" +
		"&fields%5Bpost%5D=id,attachments_media,change_visibility_at,comment_count,content,content_teaser_text,current_user_can_comment," +
		"current_user_can_report,current_user_can_view,current_user_has_liked,created_at,current_user_comment_disallowed_reason," +
		"embed,is_new_to_current_user,image,images,is_paid,like_count,likes,patreon_url,pledge_url,post_file,post_type," +
		"post_metadata,preview_asset_type,published_at,teaser_text,thumbnail,title,upgrade_url,url,was_posted_by_campaign_owner,video_preview" +
		"&fields%5Bproduct-variant%5D=name,id,price_cents,published_at_datetime,url,access_metadata,content_type,checkout_url" +
		"&fields%5Bdrop%5D=created_at,expires_at,scheduled_for,cover_image,cover_image.url,is_droppable,comments_cid,presence_cid,presence_count" +
		"&fields%5Bmedia%5D=id,image_urls,display,download_url,metadata,file_name,state" +
		"&fields%5Blivestream%5D=state,display" +
		"&filter%5Bshow_shop_posts%5D=false" +
		"&json-api-version=1.0" +
		"&json-api-use-default-includes=false" +
		"&page%5Bcount%5D=10");
	
	try {
		const data = httpGET({
			url: requestUrl,
			useAuthenticated: true,
			parseResponse: true
		});
	const contents = [];
	
	// Build lookup maps for efficient access
	const includedMap = createIncludedLookupMap(data.included);
	
	// Extract campaigns and their posts
	if (data.data) {
		for (const card of data.data) {
			if (card.type === "launcher-card" && card.attributes?.card_type === "campaign") {
				// Get campaign from included data
				const campaignId = card.relationships?.campaign?.data?.id;
				const campaign = includedMap.get(`campaign:${campaignId}`);
				
				if (campaign) {
					// Create campaign context for posts
					const campaignContext = {
						name: campaign.attributes?.name,
						url: campaign.attributes?.url,
						thumbnail: campaign.attributes?.avatar_photo_image_urls?.thumbnail,
						subscribers: campaign.attributes?.patron_count || 0
					};
					
					// Get latest posts for this campaign
					const postIds = card.relationships?.latest_posts?.data || [];
					for (const postRef of postIds) {
						const post = includedMap.get(`post:${postRef.id}`);
						if (post && post.attributes?.current_user_can_view) {
							// Process post based on type
							const content = processPost(post, includedMap, campaignContext);
							if (content) {
								contents.push(content);
							}
						}
					}
				}
			}
		}
	}
	
		return {
			results: contents,
			hasMore: !!data.links?.next,
			nextPageUrl: data.links?.next || null
		};
	} catch (error) {
		console.log("Failed to get home content: " + error.message);
		return { results: [], hasMore: false, nextPageUrl: null };
	}
}

// Unified post processing function
function processPost(post, includedMap, context) {
	return mapPostToPlatformContent(post, context, includedMap);
}

// Helper to create author from post and context
function createAuthor(post, context) {
	return new PlatformAuthorLink(
		new PlatformID(config.name, post.relationships?.campaign?.data?.id, config.id, PLATFORM_CLAIMTYPE),
		context.name,
		context.url,
		context.thumbnail,
		context.subscribers || 0
	);
}

// ===== REUSABLE MAPPING FUNCTIONS =====

// Maps a Patreon post to the appropriate Platform content class
function mapPostToPlatformContent(post, context, includedLookup) {
	const attrs = post?.attributes;
	if (!attrs) return null;
	
	// Handle locked content
	if (!attrs.current_user_can_view) {
		return mapToLockedContent(post, context);
	}
	
	// Handle embedded content first
	if (attrs.embed?.url) {
		return mapToNestedMediaContent(post, context);
	}
	
	// Handle different post types
	switch (attrs.post_type) {
		case "video_external_file":
		case "podcast":
			{
				const contentDetails = mapToVideoContent(post, context);
				
				if (contentDetails) {
					contentDetails.getContentRecommendations = function () {
						return source.getContentRecommendations(contentDetails.url);
					};
				}

				return contentDetails;
			}
			
		case "audio_file":
			{
				const contentDetails =  mapToAudioContent(post, context);
				
				if (contentDetails) {
					contentDetails.getContentRecommendations = function () {
						return source.getContentRecommendations(contentDetails.url);
					};
				}

				return contentDetails;
			}
			
		case "text_only":
			return mapToTextContent(post, context);
			
		case "image_file":
			return mapToImageContent(post, context, includedLookup);
			
		default:
			return null;
	}
}

source.getContentRecommendations = function (url) {
	const postId = getPostIdFromUrl(url);

	if (!postId) {
		return new ContentPager([], false);
	}

	try {
		const postBody = httpGET({
			url: `https://www.patreon.com/api/posts/${postId}`,
			useAuthenticated: true,
			parseResponse: true
		});
		const campaign = postBody.included?.find(a => a.type == 'campaign');

		if (!campaign) {
			return new ContentPager([], false);
		}

		// Create campaign context for posts
		const campaignContext = {
			name: campaign.attributes?.name,
			url: campaign.attributes?.url,
			thumbnail: campaign.attributes?.avatar_photo_image_urls?.thumbnail,
			subscribers: campaign.attributes?.patron_count || 0
		};

		const requestUrl = `https://www.patreon.com/api/related_posts/${campaign.id}/${postId}?include=campaign%2Caccess_rules%2Caccess_rules.tier.null%2Cattachments_media%2Caudio%2Caudio_preview.null%2Ccustom_thumbnail_media.null%2Cdrop%2Cimages%2Cmedia%2Cnative_video_insights%2Cpoll.choices%2Cpoll.current_user_responses.user%2Cpoll.current_user_responses.choice%2Cpoll.current_user_responses.poll%2Cshows.null%2Cuser%2Cuser_defined_tags%2Cvideo.null%2Ccontent_unlock_options.product_variant.null%2Ccontent_unlock_options.reward.null%2Ccontent_unlock_options.product_variant.collection.null%2Clivestream%2Clivestream.state%2Clivestream.display%2Crss_synced_feed%2Cpost_new_comment_identity%2Cpost_new_comment_identity.avatar%2Cpost_new_comment_identity.community_profile%2Cpost_new_comment_identity.identity_badges&fields[campaign]=currency%2Cshow_audio_post_download_links%2Cavatar_photo_url%2Cavatar_photo_image_urls%2Cearnings_visibility%2Cis_nsfw%2Cis_monthly%2Cname%2Curl%2Cpatron_count%2Cprimary_theme_color&fields[post]=attachments_preview_metadata%2Cchange_visibility_at%2Ccomment_count%2Ccommenter_count%2Ccontent%2Ccontent_json_string%2Ccreated_at%2Ccurrent_user_can_comment%2Ccurrent_user_can_delete%2Ccurrent_user_can_report%2Ccurrent_user_can_view%2Ccurrent_user_comment_disallowed_reason%2Ccurrent_user_has_liked%2Cembed%2Cimage%2Cinsights_last_updated_at%2Cis_paid%2Cis_preview_blurred%2Chas_custom_thumbnail%2Clike_count%2Cmeta_image_url%2Cmin_cents_pledged_to_view%2Cmonetization_ineligibility_reason%2Cpost_file%2Cpost_metadata%2Cpublished_at%2Cpatreon_url%2Cpost_type%2Cpledge_url%2Cpreview_asset_type%2Cthumbnail%2Cthumbnail_url%2Cteaser_text%2Cteaser_text_json_string%2Ccontent_teaser_text%2Ccleaned_teaser_text%2Ctitle%2Cupgrade_url%2Curl%2Cwas_posted_by_campaign_owner%2Chas_ti_violation%2Cmoderation_status%2Cpost_level_suspension_removal_date%2Cpls_one_liners_by_category%2Cvideo%2Cvideo_preview%2Cview_count%2Ccontent_unlock_options%2Cis_new_to_current_user%2Cwatch_state&fields[post_tag]=tag_type%2Cvalue&fields[user]=image_url%2Cfull_name%2Curl&fields[access_rule]=access_rule_type%2Camount_cents&fields[livestream]=display%2Cstate&fields[media]=id%2Cimage_urls%2Cdisplay%2Cdownload_url%2Cmetadata%2Cfile_name%2Cstate&fields[native_video_insights]=average_view_duration%2Caverage_view_pct%2Chas_preview%2Cid%2Clast_updated_at%2Cnum_views%2Cpreview_views%2Cvideo_duration&fields[content-unlock-option]=content_unlock_type%2Cis_current_user_eligible%2Creward_benefit_categories&fields[product-variant]=price_cents%2Ccurrency_code%2Ccheckout_url%2Cis_hidden%2Cpublished_at_datetime%2Ccontent_type%2Corders_count%2Caccess_metadata%2Clive_sale_discounted_price_cents%2Clive_sale_discounted_price_info&fields[shows]=id%2Ctitle%2Cdescription%2Cthumbnail&fields[display-identity]=name%2Clink_url&fields[primary-image]=image_icon&fields[identity-badge]=badge_type&page[cursor]=null&page[count]=5&filter[is_by_creator]=true&filter[contains_exclusive_posts]=true&json-api-use-default-includes=false&json-api-version=1.0`;
		
		const data = httpGET({
			url: requestUrl,
			useAuthenticated: true,
			parseResponse: true
		});

		const content = data?.data
			?.map(post => mapPostToPlatformContent(post, campaignContext, data))
			?.filter(content => content != null) ?? [];

		return new ContentPager(content, false);
	} catch (error) {
		return new ContentPager([], false);
	}
};

// Maps post to PlatformVideoDetails for video content
function mapToVideoContent(post, context) {
	
	const attrs = post?.attributes;
	if (!attrs?.post_file?.url) return null;
	
	return new PlatformVideoDetails({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title,
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		duration: attrs.post_file.duration || 0,
		description: attrs.content || attrs.teaser_text || "",
		rating: new RatingLikes(attrs.like_count || 0),
		thumbnails: new Thumbnails([
			new Thumbnail(attrs.thumbnail?.url || attrs.image?.thumb_url, 1)
		].filter(t => t.url)),
		video: createVideoDescriptor(attrs.post_file)
	});
}

// Maps post to PlatformVideoDetails for audio content
function mapToAudioContent(post, context) {
	const attrs = post?.attributes;
	if (!attrs?.post_file?.url) return null;
	
	return new PlatformVideoDetails({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title,
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		duration: attrs.post_file.duration || 0,
		description: attrs.content || attrs.teaser_text || "",
		rating: new RatingLikes(attrs.like_count || 0),
		thumbnails: new Thumbnails([
			new Thumbnail(attrs.thumbnail?.url, 1)
		].filter(t => t.url)),
		video: new UnMuxVideoSourceDescriptor([], [
			new AudioUrlSource({
				name: "Audio",
				url: attrs.post_file.url,
				duration: attrs.post_file.duration,
				requestModifier: PATREON_REQUEST_MODIFIER
			})
		])
	});
}

// Maps post to PlatformPostDetails for text content
function mapToTextContent(post, context) {
	const attrs = post?.attributes;
	if (!attrs?.title && !attrs?.content) return null;
	
	const maxDescriptionLength = 500;
	let description = attrs.teaser_text || "";
	
	if (attrs.content) {
		const text = domParser.parseFromString(attrs.content).text;
		description = text.length > maxDescriptionLength 
			? text.substring(0, maxDescriptionLength) + "..."
			: text;
	}
	
	return new PlatformPostDetails({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title || "Text Post",
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		rating: new RatingLikes(attrs.like_count || 0),
		description: description,
		textType: Type.Text.HTML,
		content: attrs.content || attrs.teaser_text || "",
		images: [],
		thumbnails: []
	});
}

// Maps post to PlatformPostDetails for image content
function mapToImageContent(post, context, includedLookup) {
	const attrs = post?.attributes;
	if (!attrs?.post_metadata?.image_order) return null;
	
	// Use provided lookup or search in included data
	const images = attrs.post_metadata.image_order
		.map(id => {
			if (includedLookup instanceof Map) {
				return includedLookup.get(`media:${id}`);
			} else if (includedLookup?.included) {
				return includedLookup.included.find(item => item.id === id);
			}
			return null;
		})
		.filter(item => item && item.attributes?.image_urls);
	
	if (images.length === 0) return null;
	
	const maxDescriptionLength = 500;
	let description = attrs.teaser_text || "";
	
	if (attrs.content) {
		const text = domParser.parseFromString(attrs.content).text;
		description = text.length > maxDescriptionLength 
			? text.substring(0, maxDescriptionLength) + "..."
			: text;
	}
	
	return new PlatformPostDetails({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title || "Image Post",
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		rating: new RatingLikes(attrs.like_count || 0),
		description: description,
		textType: Type.Text.HTML,
		content: attrs.content || "",
		images: images.map(img => img.attributes.image_urls.original),
		thumbnails: images.map(img => img.attributes.image_urls.thumbnail 
			? new Thumbnails([new Thumbnail(img.attributes.image_urls.thumbnail, 1)]) 
			: null)
	});
}

// Maps post to PlatformNestedMediaContent for embedded content
function mapToNestedMediaContent(post, context) {
	const attrs = post?.attributes;
	if (!attrs?.embed?.url) return null;
	
	return new PlatformNestedMediaContent({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title,
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		contentUrl: attrs.embed.url,
		contentName: attrs.embed.subject,
		contentDescription: attrs.embed.description,
		contentProvider: attrs.embed.provider,
		contentThumbnails: new Thumbnails([
			new Thumbnail(attrs.thumbnail?.url || attrs.image?.url, 1)
		].filter(x => x.url))
	});
}

// Maps post to PlatformLockedContent for locked content
function mapToLockedContent(post, context) {
	const attrs = post?.attributes;
	if (_settings?.hideUnpaidContent) return null;
	
	return new PlatformLockedContent({
		id: new PlatformID(config.name, post.id, config.id),
		name: attrs.title,
		author: createAuthor(post, context),
		datetime: attrs.published_at ? (Date.parse(attrs.published_at) / 1000) : 0,
		url: attrs.url || (BASE_URL + "/posts/" + post.id),
		contentName: attrs.embed?.subject,
		contentThumbnails: new Thumbnails([
			new Thumbnail(attrs.thumbnail?.large || attrs.image?.thumb_url, 1)
		].filter(x => x.url)),
		lockDescription: "Exclusive for members",
		unlockUrl: attrs.url || (BASE_URL + "/posts/" + post.id),
	});
}

// Creates appropriate video descriptor based on file type
function createVideoDescriptor(postFile) {
	if (!postFile?.url) return null;
	
	if (postFile.url.includes('.m3u8')) {
		return new VideoSourceDescriptor([
			new HLSSource({
				name: "Original",
				duration: postFile.duration,
				url: postFile.url,
				requestModifier: PATREON_REQUEST_MODIFIER
			})
		]);
	} else {
		return new VideoSourceDescriptor([
			new VideoUrlSource({
				name: "Original",
				url: postFile.url,
				duration: postFile.duration,
				requestModifier: PATREON_REQUEST_MODIFIER
			})
		]);
	}
}

// Creates a Map for efficient lookup of included data
function createIncludedLookupMap(includedData) {
	const map = new Map();
	if (includedData) {
		for (const item of includedData) {
			const key = `${item.type}:${item.id}`;
			map.set(key, item);
		}
	}
	return map;
}

function throwIfCaptcha(resp) {
    if (resp != null && resp.body != null && resp.code == 403) {

        const body = resp.body.toLowerCase();

		// Check for Cloudflare captcha
        if (body.includes('/cdn-cgi/challenge-platform')) {
            throw new CaptchaRequiredException(resp.url, resp.body);
        }
    }
    return true;
}


log("LOADED");