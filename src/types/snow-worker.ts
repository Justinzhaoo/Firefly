import type { SnowConfig } from "./effectsConfig";

/**
 * 下雪特效 Worker 通信消息类型
 *
 * 主线程 → Worker 的消息(通过 worker.postMessage 发送)
 */
export type SnowWorkerInboundMessage =
	| {
			type: "init";
			config: SnowConfig;
			/** 通过 transfer 转移给 Worker 的 OffscreenCanvas */
			canvas: OffscreenCanvas;
			width: number;
			height: number;
	  }
	| { type: "start" }
	| { type: "stop" }
	| { type: "resize"; width: number; height: number }
	| { type: "visibilitychange"; hidden: boolean };

/**
 * Worker → 主线程 的消息(通过 self.postMessage 发送)
 */
export type SnowWorkerOutboundMessage =
	| {
			type: "ready";
	  }
	| {
			type: "error";
			message: string;
			stack?: string;
	  }
	| {
			type: "messageError";
			message: string;
	  };

/**
 * 主线程侧的 snowManager 接口契约
 *
 * Worker 模式与主线程回退模式都需实现该接口,
 * 确保 setting-utils.ts 和 DisplaySettingsIntegrated.svelte 无需感知底层实现。
 */
export interface SnowManagerLike {
	config: SnowConfig;
	isRunning: boolean;
	init: () => Promise<void>;
	stop: () => void;
	getIsRunning: () => boolean;
}