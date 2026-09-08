import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';

// 프로젝트 루트. `**/data/**`처럼 앞에 `**/`를 붙인 glob은 경로 어디에
// `data`라는 이름의 디렉터리가 있든 다 매치한다 — 그래서 이전 버전은
// src/lib/server/media/*(probe.ts·convert.ts·waveform.ts 등)와
// src/routes/api/media/[id]/[format]/+server.ts까지 11개 소스 파일을
// 함께 무시해, dev 서버가 그 파일들을 고쳐도 HMR도 재시작도 일으키지
// 않았다(실측 확인). 아래처럼 루트에 고정한 절대경로로 바꾸면 같은
// 이름이 src/ 밑에 있어도 매치하지 않는다.
const ROOT = process.cwd();

export default defineConfig({
	server: {
		watch: {
			// 소스가 아닌, 앱 자신이 세션 내내 반복해서 써 내려가는 런타임
			// 산출물이다 — Vite의 dev 워처가 이들을 감시할 이유가 없다.
			//
			// 재현 결과(2026-09-08): data/·media/·.superpowers/에 touch·신규
			// 파일 추가·(atomic.ts와 동일한) tmp-write+rename까지 실제로
			// 걸어 봤지만 이 셋은 재시작도 리로드도 유발하지 않았다 — 즉 여기
			// 배제는 실증된 원인 제거가 아니라 예방 차원이다(media/는 11GB라
			// 감시 자체가 리소스 낭비이기도 하다). test-results/는 Vite가
			// 기본으로 이미 무시하므로(vite/dist/node/chunks/node.js) 여기
			// 다시 적을 필요가 없어 뺐다.
			//
			// 실제로 재현에 성공한 원인은 이 디렉터리들이 아니라
			// .svelte-kit/generated/** 쪽이었다: vitest(vite.config.ts를 그대로
			// extends하므로 sveltekit() 플러그인이 매번 다시 붙는다)를 이 dev
			// 서버와 동시에 돌리면 그 vitest용 Vite 인스턴스가 같은
			// .svelte-kit/generated를 재생성하고, 그 변경을 dev 서버가
			// "(client) page reload .svelte-kit/generated/client/..."로 감지해
			// 브라우저를 실제로 새로고침시킨다 — 플레이어가 사라지고 위치가
			// 0:00으로 돌아가는 증상과 정확히 일치함을 확인했다. 다만 이 경로는
			// 여기서 막지 않는다: @sveltejs/kit의 vite 플러그인이 이미
			// `${outDir}/!(generated)`만 ignored로 등록해 .svelte-kit/generated는
			// 의도적으로 계속 감시 대상에 남겨둔다 — 라우트가 실제로 추가·삭제될
			// 때 dev 클라이언트에 리로드를 전달하는 경로이기 때문이다. 여기서
			// 같은 경로를 추가로 무시하면 그 정상 동작까지 함께 죽는다. 근본
			// 해결은 dev 서버와 동시에 vitest/두 번째 dev·build를 같은
			// .svelte-kit 위에서 돌리지 않는 것— vite.config.ts 밖의 문제다.
			ignored: [
				path.join(ROOT, 'data/**'),
				path.join(ROOT, 'media/**'),
				path.join(ROOT, '.superpowers/**')
			]
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
