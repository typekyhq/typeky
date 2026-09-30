import { Hono } from 'hono'

/**
 * 站点 Worker —— 面向买家可见的公开站点。
 *
 * 硬约束（见 CONTRIBUTING.md §3 架构红线）：
 *   - 只能使用 LiquidJS 渲染，禁止引入任何前端框架（React / Vue / Svelte…）
 *   - 禁止 import @typeky/editor（编辑器仅存在于后台 SPA）
 *   - HTML 的唯一产出点是 @typeky/core 中的零依赖 blockToHtml()
 */
export interface Env {
  APP_ENV: string
  // 资源绑定（DB / MEDIA / CACHE / ASSETS）在创建后由 `pnpm types` 生成类型
}

const app = new Hono<{ Bindings: Env }>()

app.get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV }))

// TODO(M1) 挂载 Liquid 渲染管线（@typeky/theme-kit）与站点路由
app.get('/', (c) => c.text('Typeky · CE MVP 骨架就绪\n'))

export default app
