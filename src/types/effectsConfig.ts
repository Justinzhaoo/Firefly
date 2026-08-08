export type SakuraConfig = {
	enable: boolean; // 是否启用樱花特效
	sakuraNum: number; // 樱花数量，默认21
	limitTimes: number; // 樱花越界限制次数，-1为无限循环
	size: {
		min: number; // 樱花最小尺寸倍数
		max: number; // 樱花最大尺寸倍数
	};
	opacity: {
		min: number; // 樱花最小不透明度
		max: number; // 樱花最大不透明度
	};
	speed: {
		horizontal: {
			min: number; // 水平移动速度最小值
			max: number; // 水平移动速度最大值
		};
		vertical: {
			min: number; // 垂直移动速度最小值
			max: number; // 垂直移动速度最大值
		};
		rotation: number; // 旋转速度
		fadeSpeed: number; // 消失速度，不应大于最小不透明度
	};
	zIndex: number; // 层级，确保樱花在合适的层级显示
};

export type SnowConfig = {
	enable: boolean; // 是否启下雪特效
	snowNum: number; // 雪花数量，默认60
	limitTimes: number; // 雪花越界限制次数，-1为无限循环
	size: {
		min: number; // 雪花最小尺寸倍数
		max: number; // 雪花最大尺寸倍数
	};
	opacity: {
		min: number; // 雪花最小不透明度
		max: number; // 雪花最大不透明度
	};
	speed: {
		horizontal: {
			min: number; // 水平飘动速度最小值
			max: number; // 水平飘动速度最大值
		};
		vertical: {
			min: number; // 垂直下落速度最小值
			max: number; // 垂直下落速度最大值
		};
		sway: number; // 左右摇摆幅度
		fadeSpeed: number; // 消失速度
	};
	zIndex: number; // 层级，确保雪花在合适的层级显示
};
