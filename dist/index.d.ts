export type Paths = [
	string,
	any
][];
export type WatcherArgsValue = string | Element | DocumentFragment | undefined;
export type WatcherArgs = Record<string, WatcherArgsValue>;
export type ErrorFn = (name: string, ctx?: Record<string, any>) => Error;
export type RequirementType = "allowed" | "must" | "denied" | "exclusive";
export type Requirement = RequirementType | {
	key: Exclude<RequirementType, "exclusive">;
	value?: Exclude<RequirementType, "exclusive">;
} | {
	key?: Exclude<RequirementType, "exclusive">;
	value: Exclude<RequirementType, "exclusive">;
};
export type Rx<B extends boolean> = (...args: any[]) => B extends true ? unknown : void;
export type ReqField<R, K extends "key" | "value", Return> = R extends "must" | {
	[P in K]: "must";
} ? Return : R extends "denied" | {
	[P in K]: "denied";
} ? undefined : R extends "allowed" | {
	[P in K]: "allowed";
} | (K extends keyof R ? never : R) ? Return | undefined : never;
export type ReqFields<R extends Requirement, B extends boolean> = R extends "exclusive" ? {
	key: string;
	value: undefined;
	rx: undefined;
} | {
	key: undefined;
	value: string;
	rx: Rx<B>;
} : {
	key: ReqField<R, "key", string>;
	value: ReqField<R, "value", string>;
	rx: ReqField<R, "value", Rx<B>>;
};
export type AttributeContext<R extends Requirement = Requirement, RxReturn extends boolean = boolean> = {
	el: HTMLOrSVG;
	mods: Modifiers;
	rawKey: string;
	evt?: Event;
	error: ErrorFn;
	loadedPluginNames: {
		actions: Readonly<Set<string>>;
		attributes: Readonly<Set<string>>;
	};
} & ReqFields<R, RxReturn>;
export type AttributePlugin<R extends Requirement = Requirement, RxReturn extends boolean = boolean> = {
	name: string;
	apply: (ctx: AttributeContext<R, RxReturn>) => void | (() => void);
	requirement?: R;
	returnsValue?: RxReturn;
	argNames?: string[];
};
export type HTMLOrSVG = HTMLElement | SVGElement | MathMLElement;
export type Modifiers = Map<string, Set<string>>; // mod name -> tags
/** The event the plugin dispatches on the stream's element when the page falls behind. */
export declare const BEHIND_EVENT = "newest-frame-behind";
/** The detail of a newest-frame-behind event. */
export type NewestFrameBehind = {
	/** The id of the stream's element. */
	id: string;
	/** The frames (element patches) that arrived in the span. */
	frames: number;
	/** How many of them were skipped, because a newer frame of their view came with them. */
	skipped: number;
	/** The milliseconds the counts cover, 2700 to 3000. */
	span: number;
	/** True with __reopen: the plugin then sets $_slow and opens the stream again. */
	reopen: boolean;
};
/**
 * newestFramePlugin makes the attribute data-newest-frame. The page then
 * applies only the newest frame of each view of its stream (the element
 * #stream, or the id after a colon). It holds the stream's patch events and
 * sends them on once a chunk is parsed, or at the next animation frame when
 * it sent a batch less than a frame ago, and no sooner after a batch than
 * half the time that batch took to apply; a patch that a newer one in the
 * batch replaces wholly is never applied. A page that keeps up applies every
 * frame. When more than half of the last 3 s of frames were skipped, at
 * least 10, it dispatches newest-frame-behind on the stream's element. With
 * __reopen it then also sets $_slow and opens the stream again from a copy
 * of its element, once.
 */
declare function newestFramePlugin(getPath: (path: string) => unknown, mergePaths: (paths: Paths) => void): AttributePlugin<{
	key: "allowed";
	value: "denied";
}>;
/**
 * wholeTarget names what a patch replaces wholly, or returns '' when it may
 * do more: a patch in mode outer or replace of the ids of its top-level
 * elements (with no selector, or with the selector of that one id), or in
 * mode inner of an id selector. One with a script or a view transition is
 * never dropped. Two patches with the same name are frames of one view.
 */
export declare const wholeTarget: (args: WatcherArgs) => string;

export {
	newestFramePlugin as default,
};

export {};
