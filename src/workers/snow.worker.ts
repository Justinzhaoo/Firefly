/// <reference lib="webworker" />
/**
 * 下雪特效 Worker
 *
 * 在 Dedicated Worker 线程内运行雪花绘制循环,通过 OffscreenCanvas 绘制,
 * 完全脱离主线程,避免页面切换(Swup)时主线程阻塞导致雪花掉帧。
 *
 * 通信协议见 src/types/snow-worker.ts
 */
import type { SnowConfig } from "@/types/effectsConfig";
import type { SnowWorkerInboundMessage } from "@/types/snow-worker";

// ---------------------------------------------------------------------------
// 模块状态
// ---------------------------------------------------------------------------
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let snowList: SnowList | null = null;
let animationId: number | null = null;
let img: ImageBitmap | null = null;
let config: SnowConfig | null = null;
let windowWidth = 0;
let windowHeight = 0;
let isRunning = false;
let isHidden = false; // 页面可见性,隐藏时暂停动画

// ---------------------------------------------------------------------------
// 工具:getRandom
// ---------------------------------------------------------------------------
function getRandom(
	option: "x" | "y" | "s" | "r" | "a",
	cfg: SnowConfig,
): number;
function getRandom(
	option: "fnx" | "fny",
	cfg: SnowConfig,
): (x: number, y: number) => number;
function getRandom(option: "fnr", cfg: SnowConfig): (r: number) => number;
function getRandom(option: "fna", cfg: SnowConfig): (a: number) => number;
function getRandom(option: string, cfg: SnowConfig): unknown {
	switch (option) {
		case "x":
			return Math.random() * windowWidth;
		case "y":
			return Math.random() * windowHeight;
		case "s":
			return cfg.size.min + Math.random() * (cfg.size.max - cfg.size.min);
		case "r":
			return Math.random() * 6;
		case "a":
			return (
				cfg.opacity.min + Math.random() * (cfg.opacity.max - cfg.opacity.min)
			);
		case "fnx": {
			// 水平飘动 + 左右摇摆
			const random =
				cfg.speed.horizontal.min +
				Math.random() * (cfg.speed.horizontal.max - cfg.speed.horizontal.min);
			return (x: number, _y: number) => x + random + Math.sin(x * 0.01) * cfg.speed.sway;
		}
		case "fny": {
			const random =
				cfg.speed.vertical.min +
				Math.random() * (cfg.speed.vertical.max - cfg.speed.vertical.min);
			return (_x: number, y: number) => y + random;
		}
		case "fnr":
			return (r: number) => r + 0;
		case "fna":
			return (alpha: number) => alpha - cfg.speed.fadeSpeed * 0.01;
		default:
			return undefined;
	}
}

// ---------------------------------------------------------------------------
// Snowflakes
// ---------------------------------------------------------------------------
interface SnowFns {
	x: (x: number, y: number) => number;
	y: (x: number, y: number) => number;
	r: (r: number) => number;
	a: (a: number) => number;
}

class Snowflake {
	x: number;
	y: number;
	s: number;
	r: number;
	a: number;
	fn: SnowFns;
	idx: number;
	img: ImageBitmap;
	limitArray: number[];
	config: SnowConfig;

	constructor(
		x: number,
		y: number,
		s: number,
		r: number,
		a: number,
		fn: SnowFns,
		idx: number,
		image: ImageBitmap,
		limitArray: number[],
		cfg: SnowConfig,
	) {
		this.x = x;
		this.y = y;
		this.s = s;
		this.r = r;
		this.a = a;
		this.fn = fn;
		this.idx = idx;
		this.img = image;
		this.limitArray = limitArray;
		this.config = cfg;
	}

	draw(cxt: OffscreenCanvasRenderingContext2D) {
		cxt.save();
		cxt.translate(this.x, this.y);
		cxt.rotate(this.r);
		cxt.globalAlpha = this.a;
		cxt.drawImage(this.img, 0, 0, 40 * this.s, 40 * this.s);
		cxt.restore();
	}

	update() {
		this.x = this.fn.x(this.x, this.y);
		this.y = this.fn.y(this.x, this.y);
		this.r = this.fn.r(this.r);
		this.a = this.fn.a(this.a);
		// 越界则重新调整位置
		if (
			this.x > windowWidth ||
			this.x < 0 ||
			this.y > windowHeight ||
			this.y < 0 ||
			this.a <= 0
		) {
			if (this.limitArray[this.idx] === -1) {
				this.resetPosition();
			} else if (this.limitArray[this.idx] > 0) {
				this.resetPosition();
				this.limitArray[this.idx]--;
			}
		}
	}

	resetPosition() {
		if (Math.random() > 0.4) {
			this.x = getRandom("x", this.config);
			this.y = 0;
			this.s = getRandom("s", this.config);
			this.r = getRandom("r", this.config);
			this.a = getRandom("a", this.config);
		} else {
			this.x = windowWidth;
			this.y = getRandom("y", this.config);
			this.s = getRandom("s", this.config);
			this.r = getRandom("r", this.config);
			this.a = getRandom("a", this.config);
		}
	}
}

// ---------------------------------------------------------------------------
// SnowList 雪花列表
// ---------------------------------------------------------------------------
class SnowList {
	list: Snowflake[] = [];

	push(snow: Snowflake) {
		this.list.push(snow);
	}

	update() {
		for (let i = 0, len = this.list.length; i < len; i++) {
			this.list[i].update();
		}
	}

	draw(cxt: OffscreenCanvasRenderingContext2D) {
		for (let i = 0, len = this.list.length; i < len; i++) {
			this.list[i].draw(cxt);
		}
	}
}

// ---------------------------------------------------------------------------
// 核心逻辑
// ---------------------------------------------------------------------------
async function loadImage(): Promise<ImageBitmap> {
	const response = await fetch("/assets/images/effects/snow.png");
	if (!response.ok) {
		throw new Error(
			`Failed to load snow image: ${response.status} ${response.statusText}`,
		);
	}
	const blob = await response.blob();
	return createImageBitmap(blob);
}

function createSnowList(cfg: SnowConfig, image: ImageBitmap): SnowList {
	const context = ctx;
	if (!context) {
		throw new Error("Canvas 2D context not initialized");
	}
	const list = new SnowList();
	const limitArray = new Array(cfg.snowNum).fill(cfg.limitTimes);

	for (let i = 0; i < cfg.snowNum; i++) {
		const snow = new Snowflake(
			getRandom("x", cfg),
			getRandom("y", cfg),
			getRandom("s", cfg),
			getRandom("r", cfg),
			getRandom("a", cfg),
			{
				x: getRandom("fnx", cfg),
				y: getRandom("fny", cfg),
				r: getRandom("fnr", cfg),
				a: getRandom("fna", cfg),
			},
			i,
			image,
			limitArray,
			cfg,
		);
		snow.draw(context);
		list.push(snow);
	}
	return list;
}

function startAnimation() {
	if (!ctx || !canvas || !snowList) return;

	const animate = () => {
		if (!ctx || !canvas || !snowList) return;
		try {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			snowList.update();
			snowList.draw(ctx);
			animationId = requestAnimationFrame(animate);
		} catch (err) {
			reportError("animate loop", err);
			cancelAnimation();
		}
	};

	animationId = requestAnimationFrame(animate);
}

function cancelAnimation() {
	if (animationId !== null) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
}

function clearCanvas() {
	if (ctx && canvas) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}
}

function cleanup() {
	cancelAnimation();
	clearCanvas();
	if (img) {
		try {
			img.close();
		} catch {
			// ignore
		}
		img = null;
	}
	snowList = null;
	ctx = null;
	canvas = null;
	config = null;
	isRunning = false;
}

function reportError(scope: string, err: unknown) {
	const message =
		err instanceof Error
			? `${scope}: ${err.message}`
			: `${scope}: ${String(err)}`;
	const stack = err instanceof Error ? err.stack : undefined;
	self.postMessage({ type: "error", message, stack });
}

async function handleMessage(msg: SnowWorkerInboundMessage) {
	switch (msg.type) {
		case "init": {
			try {
				config = msg.config;
				canvas = msg.canvas;
				windowWidth = msg.width;
				windowHeight = msg.height;
				canvas.width = windowWidth;
				canvas.height = windowHeight;
				ctx = canvas.getContext("2d");

				img = await loadImage();
				snowList = createSnowList(config, img);
				isRunning = true;
				if (!isHidden) {
					startAnimation();
				}
				self.postMessage({ type: "ready" });
			} catch (err) {
				reportError("init", err);
				cleanup();
			}
			break;
		}
		case "start": {
			try {
				if (!isRunning || isHidden) return;
				startAnimation();
			} catch (err) {
				reportError("start", err);
			}
			break;
		}
		case "stop": {
			try {
				cleanup();
			} catch (err) {
				reportError("stop", err);
			}
			break;
		}
		case "resize": {
			try {
				windowWidth = msg.width;
				windowHeight = msg.height;
				if (canvas) {
					canvas.width = windowWidth;
					canvas.height = windowHeight;
				}
			} catch (err) {
				reportError("resize", err);
			}
			break;
		}
		case "visibilitychange": {
			try {
				isHidden = msg.hidden;
				if (isHidden) {
					cancelAnimation();
				} else if (isRunning && animationId === null) {
					startAnimation();
				}
			} catch (err) {
				reportError("visibilitychange", err);
			}
			break;
		}
		default: {
			// 未知消息类型,忽略
		}
	}
}

self.onmessage = (e: MessageEvent<SnowWorkerInboundMessage>) => {
	try {
		void handleMessage(e.data);
	} catch (err) {
		reportError("onmessage", err);
	}
};

self.onerror = (
	message: Event | string,
	_source?: string,
	_lineno?: number,
	_colno?: number,
	error?: Error,
) => {
	self.postMessage({
		type: "error",
		message: String(message),
		stack: error?.stack,
	});
	return true;
};

self.onmessageerror = (e: MessageEvent) => {
	self.postMessage({
		type: "messageError",
		message: `message deserialization error: ${String(e)}`,
	});
};