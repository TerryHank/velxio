# 元件缩略图与 Cloudflare Pages 部署实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复元件选择器中因站点基础路径和错误渲染策略导致的空白缩略图，并把可调用现有后端的前端直接部署到 Cloudflare Pages。

**架构：** 使用一个纯函数统一把 `boards/`、`components/`、`wasm/` 公共资源解析到 Vite `BASE_URL` 下；元件选择器优先使用元数据中已有的内联 SVG，避免不存在的 Web Component 产生空卡片。Cloudflare Pages Function 接管同源 `/api/*`，服务端转发到现有 FastAPI，浏览器不再直接访问 HTTP 后端。

**技术栈：** React 19、TypeScript、Vite 7、Vitest 4、Cloudflare Pages Functions、Wrangler。

---

### 任务 1：统一公共资源基础路径

**文件：**
- 创建：`frontend/src/lib/publicAssetUrl.ts`
- 创建：`frontend/src/__tests__/public-asset-url.test.ts`
- 修改：`frontend/src/components/velxio-components/Esp32Element.ts`
- 修改：`frontend/src/components/velxio-components/PiPicoWElement.ts`
- 修改：`frontend/src/components/velxio-components/Stm32BluePillElement.ts`
- 修改：`frontend/src/components/velxio-components/MotorDriverElements.ts`
- 修改：`frontend/src/simulation/spice/wasm/NgSpiceInteractive.ts`
- 修改：`frontend/src/simulation/Esp32C3Simulator.ts`

- [ ] **步骤 1：编写失败的路径测试**

```ts
expect(publicAssetUrl('/boards/pi-pico-w.svg', '/velxio/')).toBe('/velxio/boards/pi-pico-w.svg');
expect(publicAssetUrl('boards/pi-pico-w.svg', '/')).toBe('/boards/pi-pico-w.svg');
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：`npm test -- src/__tests__/public-asset-url.test.ts`

- [ ] **步骤 3：实现最小路径解析函数并替换硬编码根路径**

```ts
export function publicAssetUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}
```

- [ ] **步骤 4：运行路径测试确认通过**

运行：`npm test -- src/__tests__/public-asset-url.test.ts`

### 任务 2：消除空白元件缩略图

**文件：**
- 创建：`frontend/src/components/componentThumbnail.ts`
- 创建：`frontend/src/__tests__/component-thumbnail.test.ts`
- 修改：`frontend/src/components/ComponentPickerModal.tsx`

- [ ] **步骤 1：编写失败测试，覆盖仪表 SVG 与无效缩略图**

```ts
expect(hasInlineSvgThumbnail({ thumbnail: '<svg></svg>' })).toBe(true);
expect(hasInlineSvgThumbnail({ thumbnail: '' })).toBe(false);
```

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：`npm test -- src/__tests__/component-thumbnail.test.ts`

- [ ] **步骤 3：实现 SVG 判定，并让全部有效元数据缩略图作为卡片预览**

所有 153 个静态元件和 9 个运行时元件都有 SVG 元数据，因此选择器不再为预览实例化可能未注册或依赖外部资源的 Web Component。

- [ ] **步骤 4：运行缩略图和元数据完整性测试**

运行：`npm test -- src/__tests__/component-thumbnail.test.ts src/__tests__/components-metadata-integrity.test.ts`

### 任务 3：添加 Cloudflare 同源 API 代理并部署

**文件：**
- 创建：`frontend/functions/api/[[path]].ts`
- 创建：`frontend/src/__tests__/cloudflare-api-proxy.test.ts`
- 删除：`frontend/public/_redirects`
- 创建：`frontend/wrangler.toml`

- [ ] **步骤 1：编写失败测试，验证上游 URL 保留路径与查询参数**

```ts
expect(buildUpstreamUrl('http://38.76.201.240:8002', request)).toBe(
  'http://38.76.201.240:8002/api/compile/status/abc?verbose=1',
);
```

- [ ] **步骤 2：运行测试并确认代理模块不存在**

运行：`npm test -- src/__tests__/cloudflare-api-proxy.test.ts`

- [ ] **步骤 3：实现 Pages Function**

函数保留请求方法、查询参数、请求体和 WebSocket Upgrade；上游默认指向现有 `8002` 服务，也允许通过 `BACKEND_ORIGIN` 覆盖。

- [ ] **步骤 4：运行单元测试、类型检查和生产构建**

运行：`npm test -- src/__tests__/public-asset-url.test.ts src/__tests__/component-thumbnail.test.ts src/__tests__/cloudflare-api-proxy.test.ts src/__tests__/components-metadata-integrity.test.ts`

运行：`npm run tsc`

运行：`npm run build:docker`

- [ ] **步骤 5：本地启动 Pages Functions 并做浏览器回归**

运行：`npx wrangler pages dev dist --port 8788`

验证：打开 `/editor`，元件库不存在空白缩略图；`/api/health` 返回健康状态；编译流程能完成。

- [ ] **步骤 6：直接上传 Cloudflare Pages**

运行：`npx wrangler pages deploy dist --project-name=velxio`

若 Wrangler 尚未授权，运行 `npx wrangler login`，由用户在 Cloudflare 登录页面完成授权后继续。

- [ ] **步骤 7：验证线上 Pages 地址**

检查首页、`/editor`、元件选择器、`/api/health` 和 Arduino Uno 编译路径，并记录仍存在的外部功能限制。
