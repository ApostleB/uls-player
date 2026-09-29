// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		/**
		 * Electron 셸에서만 존재한다. 브라우저로 열면 undefined이므로,
		 * 쓰는 쪽은 반드시 존재를 먼저 확인해야 한다.
		 */
		ulsDesktop?: {
			pickFolder(): Promise<string | null>;
		};
	}
}

export {};
