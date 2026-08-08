import type { SakuraConfig, SnowConfig } from "../types/effectsConfig";

// 特效配置 - 集中管理所有动画特效

export const sakuraConfig: SakuraConfig = {
	// 是否启用樱花特效
	enable: false,

	// 樱花数量
	sakuraNum: 21,

	// 樱花越界限制次数，-1为无限循环
	limitTimes: -1,

	// 樱花尺寸
	size: {
		// 樱花最小尺寸倍数
		min: 0.5,
		// 樱花最大尺寸倍数
		max: 1.1,
	},

	// 樱花不透明度
	opacity: {
		// 樱花最小不透明度
		min: 0.3,
		// 樱花最大不透明度
		max: 0.9,
	},

	// 樱花移动速度
	speed: {
		// 水平移动
		horizontal: {
			// 水平移动速度最小值
			min: -1.7,
			// 水平移动速度最大值
			max: -1.2,
		},
		// 垂直移动
		vertical: {
			// 垂直移动速度最小值
			min: 1.5,
			// 垂直移动速度最大值
			max: 2.2,
		},
		// 旋转速度
		rotation: 0.03,
		// 消失速度，不应大于最小不透明度
		fadeSpeed: 0.03,
	},

	// 层级，确保樱花在合适的层级显示
	zIndex: 100,
};

export const snowConfig: SnowConfig = {
	// 是否启用下雪特效
	enable: false,

	// 雪花数量
	snowNum: 60,

	// 雪花越界限制次数，-1为无限循环
	limitTimes: -1,

	// 雪花尺寸
	size: {
		// 雪花最小尺寸倍数
		min: 0.3,
		// 雪花最大尺寸倍数
		max: 1.0,
	},

	// 雪花不透明度
	opacity: {
		// 雪花最小不透明度
		min: 0.4,
		// 雪花最大不透明度
		max: 0.9,
	},

	// 雪花移动速度
	speed: {
		// 水平飘动
		horizontal: {
			// 水平飘动速度最小值
			min: -0.5,
			// 水平飘动速度最大值
			max: 0.5,
		},
		// 垂直下落
		vertical: {
			// 垂直下落速度最小值
			min: 1.0,
			// 垂直下落速度最大值
			max: 2.5,
		},
		// 左右摇摆幅度
		sway: 0.5,
		// 消失速度
		fadeSpeed: 0.02,
	},

	// 层级，确保雪花在合适的层级显示
	zIndex: 99,
};
