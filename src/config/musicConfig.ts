import type { MusicPlayerConfig } from "../types/musicConfig";

// 音乐播放器配置
export const musicPlayerConfig: MusicPlayerConfig = {
	// 总开关：false=播放器显示但不加载音乐，true=正常播放
	enabled: false,

	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件
	showInSidebar: true,

	// 使用方式："meting" 使用 Meting API，"local" 使用本地音乐列表
	mode: "meting",

	// 默认音量 (0-1)
	volume: 0.5,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode: "random",

	// 是否显启用歌词
	showLyrics: true,

	// Meting API 配置
	meting: {
		// Meting API 地址（主用，实测 api.injahow.cn 可用）
		api: "https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐
		server: "netease",
		// 类型：song=单曲, playlist=歌单, album=专辑
		type: "playlist",
		// 默认歌单 ID
		id: "3778678",
		// 多歌单源（打开网页时随机选一个）
		sources: [
			// 网易云
			{ server: "netease", type: "playlist", id: "3778678", name: "云音乐热歌榜" },
			{ server: "netease", type: "playlist", id: "3779629", name: "云音乐新歌榜" },
			{ server: "netease", type: "playlist", id: "37773386", name: "云音乐飙升榜" },
			{ server: "netease", type: "playlist", id: "2250011582", name: "官方歌单-私人订制" },
			{ server: "netease", type: "playlist", id: "745194740", name: "下班放松" },
			{ server: "netease", type: "playlist", id: "7516692258", name: "治愈系纯音乐" },
			{ server: "netease", type: "playlist", id: "4827682849", name: "轻音乐精选" },
			{ server: "netease", type: "playlist", id: "9932621580", name: "古风精选" },
			{ server: "netease", type: "playlist", id: "5300341815", name: "坏女孩相关" },
			// QQ音乐
			{ server: "tencent", type: "playlist", id: "5488004315", name: "QQ音乐热歌" },
			{ server: "tencent", type: "playlist", id: "539700284", name: "QQ音乐新歌" },
			// 酷狗
			{ server: "kugou", type: "playlist", id: "5297226305", name: "酷狗热歌" },
			{ server: "kugou", type: "playlist", id: "5336692358", name: "酷狗新歌" },
		],
		// 认证 token（可选）
		auth: "",
		// 备用 API（主用不行时随机轮换）
		fallbackApis: [
			"https://meting.mikus.ink/api?server=:server&type=:type&id=:id",
			"https://meting.qinai.me/api?server=:server&type=:type&id=:id",
			"https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
			"https://meting.jinghuashang.cn/?server=:server&type=:type&id=:id",
			"https://met-api.paqck.com/?server=:server&type=:type&id=:id",
			"https://api.bbiu.cn/api/meting/?server=:server&type=:type&id=:id",
		],
	},

	// 本地音乐配置（当 mode 为 'local' 时使用）
	local: {
		playlist: [],
	},
};