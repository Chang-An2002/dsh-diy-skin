# DSH 界面配色可调范围（实测清单）

> 这份文件由 `analysis/theme-surface.mjs` 从**已安装的应用**里读出来生成，不是凭印象写的。
> 重新生成：`node analysis/theme-surface.mjs`

读取自：`<安装目录>/resources/app.asar`（12967 个条目，115.7 MB）
路径可用参数或 `DSH_ASAR` 覆盖；报告里的名字、数量、选择器都只取决于这个文件。

## 1. 机制：一个插件能怎么改颜色

官方在客户端暴露了唯一的主题扩展点：

```js
ctx.theme.overrideTokens(source, { '--dsw-alias-bg-base': { light: '#fff', dark: '#0d1424' } })
```

四条硬性规则：

1. **值必须是 `{ light, dark }` 成对**。传裸字符串会抛教学错误——单值在切换配色后会读不清。
2. **层叠加，后注册的按 token 覆盖**（`ui-theme` 的 `composeActive`：按注册序号排序，逐 token 取当前配色的值）。
3. **presenter 把 `active.tokens` 每一项写成 `body` 上的内联自定义属性**（`ui-layout` 的 `apply()`）。所以覆盖不必是 `--dsw-alias-*`——任何 `--dsw-*` 名字都行，这一点本插件的菜单材质层就用了。
4. **卸载即还原**：层随 `ctx.effect` 的生命周期移除，基础主题从未被修改。

推论：**能覆盖的 token 集合 = 这个应用里所有 `--dsw-*` 自定义属性**，下面就是它们的全集。

## 2. Token 三层结构

| 层 | 数量 | 作用 | 该不该改 |
|---|---|---|---|
| `--dsw-static-*` | 77 | 原始色板（neutral / bluish / deepseek 品牌梯级 / 语义色） | 能改，但影响面最大 |
| `--dsw-alias-*` | 107 | 语义层：bg-* / label-* / border-* / button-* / state-* … | **推荐改这一层** |
| `--dsw-specific-*` / `--dsw-menu-*` / `--dsw-elevation-*` 等 | 217 | 具体表面：平台专有底、菜单材质、阴影、圆角、字体、遮罩 | 按需改 |

官方自己的语义层就是「alias → static」：

```css
body{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00)}
body[data-ds-dark-theme]{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950)}
```

所以改 `--dsw-alias-*` 等于改了「这个界面元素该是什么颜色」，而改 `--dsw-static-*` 等于换了**整套色板**（品牌蓝、灰阶、成功/警告/错误全在内）——后者是"换肤"，前者是"调装修"。

两个值得知道的细节：

- **品牌色梯级在 `--dsw-static-deepseek-*`**（50/100/…/600，外加一个 `-700-delete`）。本插件当前用的是 500 `#4176e6` 与 400 `#7aaaff`。想整体换品牌色，改这一串比逐个改 alias 干净。
- **`--dsw-static-*-aXX` 是同一色的 alpha 变体**（`#22c55e14` 这种，`XX` 是十六进制不透明度）。悬停底色、半透明描边走的就是它们。

## 3. 区域 → token 地图

左边是界面上能认出来的区域，中间是它实际吃哪些 token（**消费方列是从代码里数出来的**，不是猜的），右边是这个区域"主要归谁管"。

| 界面区域 | 主要 token | 实测消费方（前 2） |
|---|---|---|
| 整体底色 / 主画布 | `alias-bg-base` `alias-bg-layer-1` `alias-bg-layer-2` `alias-bg-layer-3` | dsh-client-ui-schedule×7, dsh-client-ui-conversation×6 |
| 左侧栏 | `specific-sidebar-fill` `alias-border-l3` `alias-interactive-bg-hover` | dsh-client-ui-layout×6, dsh-client-ui-schedule×1 |
| 会话区 / 消息气泡 | `specific-bubble` `alias-label-primary` `alias-label-primary-dimmed` | dsh-client-ui-chat×1, dsh-client-ui-goal×1 |
| 输入框（composer） | `elevation-soft` `alias-bg-module-platform` `alias-border-l2` | dsh-client-ui-conversation×1 |
| 菜单 / 浮层 | `menu-surface-fill` `menu-backdrop-filter` `specific-menu` | dsh-client-ui-theme×2 |
| 模态 / 设置面板 | `alias-bg-layer-2` `alias-bg-mask-1` `elevation-prominent` | dsh-client-ui-trajectory×8, dsh-client-ui-sidebar-documentpreview×4 |
| 按钮 | `alias-button-primary-fill` `alias-button-primary-hover` `alias-button-ghost-active-fill` | dsh-client-ui-message-feedback×2, dsh-client-ui-settings-account×1 |
| 链接 / 强调文字 | `alias-link` `alias-brand-text` `alias-brand-primary` | dsh-client-ui-deliverables×2, dsh-client-ui-workflow-run×1 |
| 状态色（成功/警告/错误/进行中） | `alias-state-success-primary` `alias-state-warn-primary` `alias-state-error-primary` `alias-state-idle-primary` | dsh-client-ui-tool×3, dsh-client-ui-trajectory×3 |
| 代码块 / Markdown | `alias-markdown-code-block` `alias-markdown-code-block-banner` `alias-markdown-inline-code` `alias-markdown-tag` | dsh-client-ui-chat×3, dsh-client-ui-tool×3 |
| 边框 / 分隔线 | `alias-border-l1` `alias-border-l2` `alias-border-l3` `alias-border-l4` | dsh-client-ui-conversation×6, dsh-client-ui-tool×6 |
| 文字层级 | `alias-label-primary` `alias-label-secondary` `alias-label-tertiary` `alias-label-caption` | dsh-client-ui-trajectory×31, dsh-client-ui-schedule×22 |
| 滚动条 | `alias-scrollbar-bg-l1` `alias-scrollbar-hover-l1` | dsh-client-ui-conversation×2, dsh-client-ui-theme×1 |
| 阴影 / 高层级 | `elevation-stroke-color` `elevation-panel` `elevation-prominent` | dsh-client-ui-theme×1 |

## 4. Alias 分组（可直接调的那一层）

每组都是 `--dsw-alias-<组>-*`。数量多的组就是"改动波及面大"的组。

| 组 | 数量 | 例子 |
|---|---|---|
| `bg` | 15 | `bg-base` `bg-document-preview` `bg-document-selection` |
| `button` | 15 | `button-contrast-fill` `button-elevated-fill` `button-floating-fill` |
| `label` | 13 | `label-caption` `label-deep-diving` `label-deep-diving-shimmer` |
| `state` | 12 | `state-business-primary` `state-business-tertiary` `state-error-primary` |
| `markdown` | 8 | `markdown-citation` `markdown-code-block` `markdown-code-block-banner` |
| `border` | 7 | `border-inverted` `border-inverted2` `border-l1` |
| `file` | 6 | `file-diff-added-bg` `file-diff-added-gutter` `file-diff-added-marker` |
| `interactive` | 5 | `interactive-bg-active` `interactive-bg-hover` `interactive-bg-hover-accent` |
| `brand` | 4 | `brand-primary` `brand-primary-invert` `brand-primary-new-colorprimary-new-color` |
| `onboarding` | 4 | `onboarding-accent` `onboarding-card-fill` `onboarding-checkbox-border` |
| `scrollbar` | 4 | `scrollbar-bg-l1` `scrollbar-bg-l2` `scrollbar-hover-l1` |
| `code` | 2 | `code-diff-added` `code-diff-deleted` |
| `menu` | 2 | `menu-group-header-fill` `menu-icon` |
| `settings` | 2 | `settings-card-fill` `settings-card-stroke` |
| `toast` | 2 | `toast-bg` `toast-label` |
| `tooltip` | 2 | `tooltip-bg` `tooltip-key-bg` |
| `turn` | 2 | `turn-trigger-bg` `turn-trigger-bg-hover` |
| `link` | 1 | `link` |
| `switch` | 1 | `switch-thumb` |

## 5. 已经由本插件接管的

- `BRAND_TOKENS`：品牌源 + 文字 + 表面 + 边框等（数量见启动日志 `brand palette applied (N tokens)`）。
- `MATERIAL_TOKENS`：`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter`、`--dsw-specific-menu`、`--dsw-alias-menu-group-header-fill` —— 把弹出层从半透明毛玻璃改成不透明。
- `USER_COLOR_LAYER`：用户在「背景与配色」面板里自己调的颜色。第三层，叠在上面两层之上，所以用户的选择永远赢过自带皮肤；面板里的「恢复默认」清空的正是这一层。
- 这三层是**独立的 `overrideTokens` source**，可以分别删；插件卸载时三层都会被收回。

### 面板里可以直接调的旋钮

每个旋钮**就是一个 token**（不是一组），所以「调它会影响哪里」有唯一答案 —— 用下面第 3 节那张区域表去查。

共 22 个旋钮，预设：「DeepSeek 品牌蓝」 「护眼绿」。

| 旋钮 | token | 浅色默认 | 深色默认 |
|---|---|---|---|
| 整体底色 | `alias-bg-base` | `#ffffff` | `#0d1424` |
| 面板与浮层 | `alias-bg-layer-2` | `#f4f8fe` | `#16203a` |
| 次要控件底 | `alias-bg-module-platform` | `#f4f7fd` | `#1c2846` |
| 弹出层材质 | `menu-surface-fill` | `#fcfdff` | `#1a2540` |
| 左侧边栏 | `specific-sidebar-fill` | `#f9fafb` | `#1b1b1c` |
| 会话气泡 | `specific-bubble` | `#edf3fe` | `#2c2c2e` |
| 主要文字 | `alias-label-primary` | `#101a33` | `#eef2fb` |
| 次级文字 | `alias-label-secondary` | `#46536e` | `#a9b6d0` |
| 弱化文字 | `alias-label-tertiary` | `#66738e` | `#7f8da8` |
| 强调色 | `alias-brand-primary` | `#4176e6` | `#5686fe` |
| 主要按钮 | `alias-button-primary-fill` | `#4176e6` | `#7aaaff` |
| 链接与操作 | `alias-link` | `#2f62d6` | `#7aaaff` |
| 悬停底色 | `alias-interactive-bg-hover` | `#1d4ed80f` | `#ffffff1a` |
| 边框与分隔线 | `alias-border-l2` | `#1d4ed824` | `#ffffff20` |
| 代码块底 | `alias-markdown-code-block` | `#f4f7fd` | `#0f1729` |
| 成功 | `alias-state-success-primary` | `#22c55e` | `#22c55e` |
| 警告 | `alias-state-warn-primary` | `#f59e0b` | `#f59e0b` |
| 错误 | `alias-state-error-primary` | `#ec1313` | `#f25a5a` |
| 按钮底色 | `--dsd-chip-fill` | `#f4f7fd` | `#1c2846` |
| 按钮描边 | `--dsd-chip-stroke` | `#1d4ed824` | `#ffffff20` |
| 按钮文字 | `--dsd-chip-ink` | `#46536e` | `#a9b6d0` |
| 余额数字 | `--dsd-chip-ink-strong` | `#101a33` | `#eef2fb` |

默认值不是抄来的：`analysis/palette-defaults.mjs` 从**已安装的应用**里把这些 token 的实际取值读出来，逐条和上表比对。

## 6. 覆盖不到的地方

Token 是**唯一可靠的**入口，其它颜色都在 token 之外：

| 类型 | 说明 |
|---|---|
| 官方 CSS 里写死的字面色值 | 见下表，按包统计。这些不会被 token 覆盖影响 |
| 插画 / 图标素材 | 本插件的三张图、官方 logo 等，颜色是素材自带的 |
| 第三方插件的样式 | 它们可以自己写死颜色，也可以自己注册 `overrideTokens` 层（和本插件同级竞争） |
| 原生视图里的网页 | 例如充值页那种宿主 `WebContentsView`，完全不受插件 CSS 影响 |

各包里写死的十六进制色值数量（前 15，越多说明该区域越依赖字面值）：

| 包 | 字面色值数 |
|---|---|
| `dsh-client-ui-sidebar-documentpreview` | 1095 |
| `dsh-web-frontend` | 299 |
| `dsh-client-ui-theme` | 269 |
| `dsh-client-ui-primitives` | 198 |
| `debug` | 152 |
| `@mixmark-io/domino` | 138 |
| `@xterm/addon-serialize` | 45 |
| `dsh-client-ui-sidebar-terminal` | 38 |
| `@modelcontextprotocol/client` | 24 |
| `diff` | 21 |
| `dsh-client-ui-chat` | 18 |
| `dsh-client-ui-attachment` | 17 |
| `zod` | 17 |
| `@earendil-works/pi-ai` | 14 |
| `dsh-client-ui-workspace` | 12 |

## 7. 数据附录：全部 token

### static — 原始色板（一切颜色的源头）（77）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `static-amber-100` | #fef5e7 | #fef5e7 | 1 |
| `static-amber-400` | #f7ad31 | #f7ad31 | 2 |
| `static-amber-500` | #f59e0b | #f59e0b | 2 |
| `static-amber-600` | #dd8629 | #dd8629 | 2 |
| `static-amber-900` | #27241f | #27241f | 1 |
| `static-blue-100` | #dbeafe | #dbeafe | 0 |
| `static-blue-300` | #93c5fd | #93c5fd | 1 |
| `static-blue-400` | #60a5fa | #60a5fa | 2 |
| `static-blue-450` | #4d93f8 | #4d93f8 | 1 |
| `static-blue-50` | #eff6ff | #eff6ff | 0 |
| `static-blue-500` | #3b82f6 | #3b82f6 | 6 |
| `static-blue-50p` | #eaf3ff | #eaf3ff | 0 |
| `static-blue-600` | #2563eb | #2563eb | 2 |
| `static-blue-75` | #e5f0ff | #e5f0ff | 0 |
| `static-blue-800` | #1e40af | #1e40af | 0 |
| `static-blue-900` | #0e3074 | #0e3074 | 1 |
| `static-blue-950` | #172554 | #172554 | 2 |
| `static-deepseek-100` | #e4edfd | #e4edfd | 2 |
| `static-deepseek-200` | #d3e2ff | #d3e2ff | 1 |
| `static-deepseek-300` | #b7c8fe | #b7c8fe | 0 |
| `static-deepseek-400` | #7aaaff | #7aaaff | 5 |
| `static-deepseek-450` | #5686fe | #5686fe | 2 |
| `static-deepseek-50` | #edf3fe | #edf3fe | 1 |
| `static-deepseek-500` | #4176e6 | #4176e6 | 6 |
| `static-deepseek-600` | #4868b2 | #4868b2 | 0 |
| `static-deepseek-700-delete` | #2f4c8f | #2f4c8f | 0 |
| `static-deepseek-800` | #34415b | #34415b | 1 |
| `static-deepseek-900` | #283142 | #283142 | 0 |
| `static-green-100` | #e6faed | #e6faed | 1 |
| `static-green-400` | #4ed17e | #4ed17e | 2 |
| `static-green-500` | #22c55e | #22c55e | 2 |
| `static-green-500-a08` | #22c55e14 | #22c55e14 | 1 |
| `static-green-500-a12` | #22c55e1f | #22c55e1f | 1 |
| `static-green-900` | #233c2c | #233c2c | 1 |
| `static-neutral-00` | #fff | #fff | 11 |
| `static-neutral-100` | #f5f5f5 | #f5f5f5 | 4 |
| `static-neutral-1000` | #000 | #000 | 1 |
| `static-neutral-150` | #ededed | #ededed | 0 |
| `static-neutral-200` | #e5e5e5 | #e5e5e5 | 3 |
| `static-neutral-250` | #dcdcdc | #dcdcdc | 0 |
| `static-neutral-300` | #d4d4d4 | #d4d4d4 | 3 |
| `static-neutral-400` | #a2a4a6 | #a2a4a6 | 2 |
| `static-neutral-50` | #fafafa | #fafafa | 5 |
| `static-neutral-500` | #7f8287 | #7f8287 | 0 |
| `static-neutral-550` | #65676b | #65676b | 1 |
| `static-neutral-600` | #545557 | #545557 | 3 |
| `static-neutral-700` | #3c3c3d | #3c3c3d | 2 |
| `static-neutral-800` | #292929 | #292929 | 5 |
| `static-neutral-850` | #212123 | #212123 | 5 |
| `static-neutral-900` | #0f0f0f | #0f0f0f | 0 |
| `static-neutral-bluish-00` | #fff | #fff | 15 |
| `static-neutral-bluish-100` | #ebeef2 | #ebeef2 | 7 |
| `static-neutral-bluish-1000` | #0f1115 | #0f1115 | 6 |
| `static-neutral-bluish-150` | #e9ecf2 | #e9ecf2 | 2 |
| `static-neutral-bluish-200` | #e1e5ee | #e1e5ee | 1 |
| `static-neutral-bluish-300` | #cfd3d6 | #cfd3d6 | 2 |
| `static-neutral-bluish-400` | #adb2b8 | #adb2b8 | 7 |
| `static-neutral-bluish-50` | #f9fafb | #f9fafb | 10 |
| `static-neutral-bluish-500` | #979da6 | #979da6 | 1 |
| `static-neutral-bluish-60` | #f5f6f7 | #f9fafb | 5 |
| `static-neutral-bluish-600` | #81858c | #81858c | 3 |
| `static-neutral-bluish-700` | #61666b | #61666b | 5 |
| `static-neutral-bluish-75` | #f1f3f5 | #f1f3f5 | 5 |
| `static-neutral-bluish-750` | #43454a | #43454a | 9 |
| `static-neutral-bluish-800` | #353638 | #353638 | 12 |
| `static-neutral-bluish-850` | #2c2c2e | #2c2c2e | 10 |
| `static-neutral-bluish-875` | #232324 | #232324 | 1 |
| `static-neutral-bluish-900` | #1b1b1c | #1b1b1c | 4 |
| `static-neutral-bluish-950` | #151517 | #151517 | 3 |
| `static-red-100` | #fee2e2 | #fee2e2 | 0 |
| `static-red-400` | #f25a5a | #f25a5a | 3 |
| `static-red-400-a12` | #f25a5a1f | #f25a5a1f | 1 |
| `static-red-50` | #fef2f2 | #fef2f2 | 0 |
| `static-red-500` | #ef4444 | #ef4444 | 0 |
| `static-red-600` | #ec1313 | #ec1313 | 1 |
| `static-red-600-a08` | #ec131314 | #ec131314 | 1 |
| `static-red-900` | #570c0c | #570c0c | 0 |

### alias — 语义 token（官方推荐的调整层）（107）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `alias-bg-base` | — | var(--dsw-static-neutral-bluish-00) | 35 |
| `alias-bg-document-preview` | — | var(--dsw-static-neutral-bluish-100) | 2 |
| `alias-bg-document-selection` | — | color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent) | 1 |
| `alias-bg-layer-1` | — | var(--dsw-static-neutral-bluish-00) | 46 |
| `alias-bg-layer-2` | — | var(--dsw-static-neutral-bluish-00) | 22 |
| `alias-bg-layer-3` | — | var(--dsw-static-neutral-bluish-00) | 11 |
| `alias-bg-mask-1` | — | #0000003d | 1 |
| `alias-bg-mask-2` | — | #0000001f | 0 |
| `alias-bg-mask-3` | — | #0000007a | 0 |
| `alias-bg-mask-drop` | — | #ffffffb3 | 1 |
| `alias-bg-mask-photo` | — | #000000e0 | 0 |
| `alias-bg-module-platform` | — | var(--dsw-static-neutral-bluish-60) | 25 |
| `alias-bg-multi-select` | — | var(--dsw-static-neutral-bluish-60) | 0 |
| `alias-bg-overlay` | — | var(--dsw-static-neutral-bluish-150) | 1 |
| `alias-bg-skeleton` | — | #0000000a | 7 |
| `alias-border-inverted` | — | #0000 | 2 |
| `alias-border-inverted2` | — | #0000 | 0 |
| `alias-border-l1` | — | #0000000a | 50 |
| `alias-border-l2` | — | #0000001a | 73 |
| `alias-border-l2-darkmode-thin` | — | #0000001a | 9 |
| `alias-border-l3` | — | #0000001f | 51 |
| `alias-border-l4` | — | #00000029 | 39 |
| `alias-brand-primary` | — | var(--dsw-static-neutral-bluish-1000) | 7 |
| `alias-brand-primary-invert` | — | var(--dsw-static-neutral-bluish-1000) | 0 |
| `alias-brand-primary-new-colorprimary-new-color` | — | #4176e6 | 11 |
| `alias-brand-text` | — | var(--dsw-static-neutral-bluish-1000) | 0 |
| `alias-button-contrast-fill` | — | var(--dsw-static-neutral-bluish-700) | 3 |
| `alias-button-elevated-fill` | — | var(--dsw-static-neutral-bluish-00) | 2 |
| `alias-button-floating-fill` | — | var(--dsw-static-neutral-bluish-00) | 3 |
| `alias-button-floating-hover` | — | var(--dsw-static-neutral-bluish-75) | 3 |
| `alias-button-ghost-active-border` | — | var(--dsw-static-neutral-bluish-500) | 2 |
| `alias-button-ghost-active-fill` | — | var(--dsw-static-neutral-bluish-100) | 3 |
| `alias-button-ghost-active-hover` | — | var(--dsw-static-neutral-bluish-150) | 0 |
| `alias-button-info-fill` | — | var(--dsw-static-deepseek-500) | 3 |
| `alias-button-info-hover` | — | var(--dsw-static-deepseek-400) | 1 |
| `alias-button-primary-dimmed` | — | var(--dsw-static-neutral-bluish-100) | 0 |
| `alias-button-primary-fill` | — | var(--dsw-alias-brand-primary) | 4 |
| `alias-button-primary-hover` | — | var(--dsw-static-neutral-bluish-750) | 2 |
| `alias-button-tool-bar-fill` | — | #54555780 | 0 |
| `alias-button-tool-bar-fill-invisible` | — | #1f1f1f5c | 0 |
| `alias-button-tool-bar-hover` | — | #54555799 | 0 |
| `alias-code-diff-added` | — | var(--dsw-static-green-500-a08) | 0 |
| `alias-code-diff-deleted` | — | var(--dsw-static-red-600-a08) | 0 |
| `alias-file-diff-added-bg` | — | #e6f4e7 | 1 |
| `alias-file-diff-added-gutter` | — | #edf7ed | 1 |
| `alias-file-diff-added-marker` | — | #01a241 | 1 |
| `alias-file-diff-deleted-bg` | — | #fce6e2 | 1 |
| `alias-file-diff-deleted-gutter` | — | #fdece9 | 1 |
| `alias-file-diff-deleted-marker` | — | #ba2723 | 1 |
| `alias-interactive-bg-active` | — | #2631481a | 3 |
| `alias-interactive-bg-hover` | — | #2631480f | 133 |
| `alias-interactive-bg-hover-accent` | — | #26314824 | 0 |
| `alias-interactive-bg-hover-danger` | — | #ec13130d | 9 |
| `alias-interactive-bg-hover-solid` | — | var(--dsw-static-neutral-bluish-75) | 10 |
| `alias-label-caption` | — | var(--dsw-static-neutral-bluish-400) | 85 |
| `alias-label-deep-diving` | — | color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950)) | 1 |
| `alias-label-deep-diving-shimmer` | — | color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950)) | 1 |
| `alias-label-dimmed` | — | var(--dsw-static-neutral-bluish-200) | 8 |
| `alias-label-document-preview` | — | var(--dsw-static-neutral-bluish-700) | 1 |
| `alias-label-primary` | — | var(--dsw-static-neutral-bluish-1000) | 276 |
| `alias-label-primary-bluish` | — | var(--dsw-static-blue-900) | 1 |
| `alias-label-primary-dimmed` | — | var(--dsw-static-neutral-bluish-950) | 4 |
| `alias-label-primary-foreground` | — | var(--dsw-static-neutral-bluish-00) | 5 |
| `alias-label-primary-inverted` | — | var(--dsw-static-neutral-bluish-00) | 18 |
| `alias-label-secondary` | — | var(--dsw-static-neutral-bluish-700) | 202 |
| `alias-label-shimmer` | — | color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent) | 0 |
| `alias-label-tertiary` | — | var(--dsw-static-neutral-bluish-600) | 284 |
| `alias-link` | — | var(--dsw-static-deepseek-500) | 4 |
| `alias-markdown-citation` | — | var(--dsw-static-neutral-bluish-100) | 1 |
| `alias-markdown-code-block` | — | var(--dsw-static-neutral-bluish-50) | 13 |
| `alias-markdown-code-block-banner` | — | var(--dsw-static-neutral-bluish-50) | 1 |
| `alias-markdown-code-segment-selected` | — | var(--dsw-static-neutral-bluish-00) | 0 |
| `alias-markdown-code-segment-unselected` | — | var(--dsw-static-neutral-bluish-75) | 0 |
| `alias-markdown-inline-code` | — | var(--dsw-static-neutral-50) | 0 |
| `alias-markdown-placeholder` | — | var(--dsw-static-neutral-bluish-60) | 0 |
| `alias-markdown-tag` | — | var(--dsw-static-neutral-bluish-75) | 0 |
| `alias-menu-group-header-fill` | — | #f8f9faf0 | 0 |
| `alias-menu-icon` | — | var(--dsw-static-neutral-bluish-800) | 5 |
| `alias-onboarding-accent` | #3964fe | — | 2 |
| `alias-onboarding-card-fill` | color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent) | color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 80%, transparent) | 1 |
| `alias-onboarding-checkbox-border` | color-mix(in srgb, var(--dsw-static-neutral-bluish-1000) 20%, transparent) | var(--dsw-alias-border-l2) | 1 |
| `alias-onboarding-secondary-fill` | var(--dsw-static-neutral-bluish-00) | #48494c | 2 |
| `alias-scrollbar-bg-l1` | — | var(--dsw-static-neutral-200) | 3 |
| `alias-scrollbar-bg-l2` | — | var(--dsw-static-neutral-200) | 30 |
| `alias-scrollbar-hover-l1` | — | var(--dsw-static-neutral-300) | 1 |
| `alias-scrollbar-hover-l2` | — | var(--dsw-static-neutral-300) | 30 |
| `alias-settings-card-fill` | var(--dsw-alias-bg-layer-2) | — | 5 |
| `alias-settings-card-stroke` | var(--dsw-alias-border-l4) | — | 5 |
| `alias-state-business-primary` | — | var(--dsw-static-deepseek-500) | 149 |
| `alias-state-business-tertiary` | — | var(--dsw-static-deepseek-100) | 5 |
| `alias-state-error-primary` | — | var(--dsw-static-red-600) | 106 |
| `alias-state-error-secondary` | — | var(--dsw-static-red-400) | 5 |
| `alias-state-idle-primary` | — | var(--dsw-static-neutral-300) | 0 |
| `alias-state-success-primary` | — | var(--dsw-static-green-500) | 14 |
| `alias-state-success-secondary` | — | var(--dsw-static-green-400) | 4 |
| `alias-state-success-tertiary` | — | var(--dsw-static-green-100) | 2 |
| `alias-state-warn-label` | — | var(--dsw-static-amber-600) | 14 |
| `alias-state-warn-primary` | — | var(--dsw-static-amber-500) | 8 |
| `alias-state-warn-secondary` | — | var(--dsw-static-amber-400) | 4 |
| `alias-state-warn-tertiary` | — | var(--dsw-static-amber-100) | 12 |
| `alias-switch-thumb` | — | var(--dsw-static-neutral-bluish-00) | 0 |
| `alias-toast-bg` | — | var(--dsw-static-neutral-bluish-800) | 0 |
| `alias-toast-label` | — | var(--dsw-static-neutral-bluish-00) | 0 |
| `alias-tooltip-bg` | — | var(--dsw-static-neutral-bluish-850) | 2 |
| `alias-tooltip-key-bg` | — | color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%) | 0 |
| `alias-turn-trigger-bg` | — | var(--dsw-alias-markdown-code-block) | 1 |
| `alias-turn-trigger-bg-hover` | — | var(--dsw-alias-interactive-bg-hover) | 1 |

### specific — 平台专有表面（11）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `specific-bubble` | — | var(--dsw-static-deepseek-50) | 3 |
| `specific-bubble-highlight` | — | var(--dsw-static-deepseek-200) | 0 |
| `specific-input-major` | — | var(--dsw-static-neutral-bluish-00) | 8 |
| `specific-login-input` | — | var(--dsw-static-neutral-bluish-50) | 0 |
| `specific-menu` | — | var(--dsw-menu-surface-fill) | 16 |
| `specific-selector` | — | var(--dsw-static-neutral-bluish-60) | 2 |
| `specific-sidebar-fill` | — | var(--dsw-static-neutral-bluish-50) | 11 |
| `specific-sidebar-nav-item-active` | — | var(--dsw-static-neutral-bluish-100) | 1 |
| `specific-sidebar-nav-item-active-accent` | — | var(--dsw-static-deepseek-100) | 1 |
| `specific-sidebar-nav-item-hover` | — | var(--dsw-static-neutral-bluish-75) | 1 |
| `specific-tip` | — | var(--dsw-static-neutral-bluish-60) | 0 |

### menu — 菜单材质（2）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `menu-backdrop-filter` | blur(40px) saturate(150%) | — | 12 |
| `menu-surface-fill` | — | #f8f9fa94 | 2 |

### elevation — 阴影 / 描边（5）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `elevation-panel` | — | var(--dsw-elevation-stroke), 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005 | 9 |
| `elevation-prominent` | — | var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d | 16 |
| `elevation-soft` | — | var(--dsw-elevation-stroke), 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008 | 1 |
| `elevation-stroke` | — | 0 0 0 .5px var(--dsw-elevation-stroke-color) | 5 |
| `elevation-stroke-color` | var(--dsw-alias-border-l4) | var(--dsw-alias-border-l3) | 1 |

### shadow — 阴影阶（4）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `shadow-lv1` | 0 2px 4px 0 #0000000d | — | 0 |
| `shadow-lv1-blur` | 0 4px 12px 0 #00000005 | — | 0 |
| `shadow-lv2` | 0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a | — | 1 |
| `shadow-lv3` | 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014 | — | 0 |

### radius — 圆角（6）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `radius-lg` | 16px | — | 47 |
| `radius-md` | 12px | — | 66 |
| `radius-panel` | 28px | — | 4 |
| `radius-sm` | 8px | — | 85 |
| `radius-xl` | 20px | — | 26 |
| `radius-xs` | 4px | — | 19 |

### font — 字体（181）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `font-base-16` | — | 16px/24px var(--dsw-font-family) | 0 |
| `font-base-16-font-family` | — | var(--dsw-font-family) | 0 |
| `font-base-16-font-size` | — | 16px | 0 |
| `font-base-16-font-style` | — | normal | 0 |
| `font-base-16-font-weight` | — | 400 | 0 |
| `font-base-16-line-height` | — | 24px | 0 |
| `font-base-strong-16` | — | 500 16px/24px var(--dsw-font-family) | 0 |
| `font-base-strong-16-font-family` | — | var(--dsw-font-family) | 0 |
| `font-base-strong-16-font-size` | — | 16px | 0 |
| `font-base-strong-16-font-style` | — | normal | 0 |
| `font-base-strong-16-font-weight` | — | 500 | 0 |
| `font-base-strong-16-line-height` | — | 24px | 0 |
| `font-family` | -apple-system, BlinkMacSystemFont, | — | 70 |
| `font-l-20` | — | 500 20px/28px var(--dsw-font-family) | 1 |
| `font-l-20-font-family` | — | var(--dsw-font-family) | 0 |
| `font-l-20-font-size` | — | 20px | 0 |
| `font-l-20-font-style` | — | normal | 0 |
| `font-l-20-font-weight` | — | 500 | 0 |
| `font-l-20-line-height` | — | 28px | 0 |
| `font-m-18` | — | 500 16px/28px var(--dsw-font-family) | 0 |
| `font-m-18-font-family` | — | var(--dsw-font-family) | 0 |
| `font-m-18-font-size` | — | 16px | 0 |
| `font-m-18-font-style` | — | normal | 0 |
| `font-m-18-font-weight` | — | 500 | 0 |
| `font-m-18-line-height` | — | 28px | 0 |
| `font-markdown-base` | — | var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-base-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-base-font-size` | — | var(--dsh-content-font-size,14px) | 0 |
| `font-markdown-base-font-style` | — | normal | 0 |
| `font-markdown-base-font-weight` | — | 400 | 0 |
| `font-markdown-base-italic` | — | italic var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-base-italic-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-base-italic-font-size` | — | var(--dsh-content-font-size,14px) | 0 |
| `font-markdown-base-italic-font-style` | — | italic | 0 |
| `font-markdown-base-italic-font-weight` | — | 400 | 0 |
| `font-markdown-base-italic-line-height` | — | calc(24px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-base-line-height` | — | calc(24px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-base-strong` | — | 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-base-strong-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-base-strong-font-size` | — | var(--dsh-content-font-size,14px) | 0 |
| `font-markdown-base-strong-font-style` | — | normal | 0 |
| `font-markdown-base-strong-font-weight` | — | 600 | 0 |
| `font-markdown-base-strong-italic` | — | italic 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-base-strong-italic-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-base-strong-italic-font-size` | — | var(--dsh-content-font-size,14px) | 0 |
| `font-markdown-base-strong-italic-font-style` | — | italic | 0 |
| `font-markdown-base-strong-italic-font-weight` | — | 600 | 0 |
| `font-markdown-base-strong-italic-line-height` | — | calc(24px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-base-strong-line-height` | — | calc(24px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-code` | — | 12px/19px var(--ds-font-family-code) | 0 |
| `font-markdown-code-block` | — | 11px/19px var(--ds-font-family-code) | 2 |
| `font-markdown-code-block-font-family` | — | var(--ds-font-family-code) | 0 |
| `font-markdown-code-block-font-size` | — | 11px | 0 |
| `font-markdown-code-block-font-style` | — | normal | 0 |
| `font-markdown-code-block-font-weight` | — | 400 | 0 |
| `font-markdown-code-block-line-height` | — | 19px | 0 |
| `font-markdown-code-block-small` | — | 11px/16px var(--ds-font-family-code) | 10 |
| `font-markdown-code-block-small-font-family` | — | var(--ds-font-family-code) | 0 |
| `font-markdown-code-block-small-font-size` | — | 11px | 0 |
| `font-markdown-code-block-small-font-style` | — | normal | 0 |
| `font-markdown-code-block-small-font-weight` | — | 400 | 0 |
| `font-markdown-code-block-small-line-height` | — | 16px | 0 |
| `font-markdown-code-font-family` | — | var(--ds-font-family-code) | 0 |
| `font-markdown-code-font-size` | — | 12px | 0 |
| `font-markdown-code-font-style` | — | normal | 0 |
| `font-markdown-code-font-weight` | — | 400 | 0 |
| `font-markdown-code-line-height` | — | 19px | 0 |
| `font-markdown-h1` | — | 700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-h1-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-h1-font-size` | — | calc(21px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h1-font-style` | — | normal | 0 |
| `font-markdown-h1-font-weight` | — | 700 | 0 |
| `font-markdown-h1-line-height` | — | calc(30px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h2` | — | 700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-h2-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-h2-font-size` | — | calc(19px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h2-font-style` | — | normal | 0 |
| `font-markdown-h2-font-weight` | — | 700 | 0 |
| `font-markdown-h2-line-height` | — | calc(28px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h3` | — | 700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-h3-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-h3-font-size` | — | calc(18px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h3-font-style` | — | normal | 0 |
| `font-markdown-h3-font-weight` | — | 700 | 0 |
| `font-markdown-h3-line-height` | — | calc(26px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-h4` | — | 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family) | 0 |
| `font-markdown-h4-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-h4-font-size` | — | var(--dsh-content-font-size,14px) | 0 |
| `font-markdown-h4-font-style` | — | normal | 0 |
| `font-markdown-h4-font-weight` | — | 600 | 0 |
| `font-markdown-h4-line-height` | — | calc(24px + var(--dsh-content-font-delta)) | 0 |
| `font-markdown-small` | — | 12px/20px var(--dsw-font-family) | 0 |
| `font-markdown-small-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-small-font-size` | — | 12px | 0 |
| `font-markdown-small-font-style` | — | normal | 0 |
| `font-markdown-small-font-weight` | — | 400 | 0 |
| `font-markdown-small-italic` | — | italic 12px/20px var(--dsw-font-family) | 0 |
| `font-markdown-small-italic-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-small-italic-font-size` | — | 12px | 0 |
| `font-markdown-small-italic-font-style` | — | italic | 0 |
| `font-markdown-small-italic-font-weight` | — | 400 | 0 |
| `font-markdown-small-italic-line-height` | — | 20px | 0 |
| `font-markdown-small-line-height` | — | 20px | 0 |
| `font-markdown-small-strong` | — | 600 12px/20px var(--dsw-font-family) | 0 |
| `font-markdown-small-strong-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-small-strong-font-size` | — | 12px | 0 |
| `font-markdown-small-strong-font-style` | — | normal | 0 |
| `font-markdown-small-strong-font-weight` | — | 600 | 0 |
| `font-markdown-small-strong-italic` | — | italic 600 12px/20px var(--dsw-font-family) | 0 |
| `font-markdown-small-strong-italic-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-small-strong-italic-font-size` | — | 12px | 0 |
| `font-markdown-small-strong-italic-font-style` | — | italic | 0 |
| `font-markdown-small-strong-italic-font-weight` | — | 600 | 0 |
| `font-markdown-small-strong-italic-line-height` | — | 20px | 0 |
| `font-markdown-small-strong-line-height` | — | 20px | 0 |
| `font-markdown-table` | — | var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family) | 0 |
| `font-markdown-table-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-table-font-size` | — | var(--dsh-content-font-size-secondary,13px) | 0 |
| `font-markdown-table-font-style` | — | normal | 0 |
| `font-markdown-table-font-weight` | — | 400 | 0 |
| `font-markdown-table-head` | — | 500 var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family) | 0 |
| `font-markdown-table-head-font-family` | — | var(--dsw-font-family) | 0 |
| `font-markdown-table-head-font-size` | — | var(--dsh-content-font-size-secondary,13px) | 0 |
| `font-markdown-table-head-font-style` | — | normal | 0 |
| `font-markdown-table-head-font-weight` | — | 500 | 0 |
| `font-markdown-table-head-line-height` | — | calc(22px + var(--dsh-content-font-delta-secondary,0px)) | 0 |
| `font-markdown-table-line-height` | — | calc(22px + var(--dsh-content-font-delta-secondary,0px)) | 0 |
| `font-s-14` | — | 14px/22px var(--dsw-font-family) | 1 |
| `font-s-14-font-family` | — | var(--dsw-font-family) | 0 |
| `font-s-14-font-size` | — | 14px | 0 |
| `font-s-14-font-style` | — | normal | 0 |
| `font-s-14-font-weight` | — | 400 | 0 |
| `font-s-14-line-height` | — | 22px | 0 |
| `font-s-strong-14` | — | 500 14px/22px var(--dsw-font-family) | 0 |
| `font-s-strong-14-font-family` | — | var(--dsw-font-family) | 0 |
| `font-s-strong-14-font-size` | — | 14px | 0 |
| `font-s-strong-14-font-style` | — | normal | 0 |
| `font-s-strong-14-font-weight` | — | 500 | 0 |
| `font-s-strong-14-line-height` | — | 22px | 0 |
| `font-xl-24` | — | 600 24px/32px var(--dsw-font-family) | 0 |
| `font-xl-24-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xl-24-font-size` | — | 24px | 0 |
| `font-xl-24-font-style` | — | normal | 0 |
| `font-xl-24-font-weight` | — | 600 | 0 |
| `font-xl-24-line-height` | — | 32px | 0 |
| `font-xs-13` | — | 13px/20px var(--dsw-font-family) | 23 |
| `font-xs-13-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xs-13-font-size` | — | 13px | 0 |
| `font-xs-13-font-style` | — | normal | 0 |
| `font-xs-13-font-weight` | — | 400 | 0 |
| `font-xs-13-line-height` | — | 20px | 0 |
| `font-xs-strong-13` | — | 500 13px/20px var(--dsw-font-family) | 4 |
| `font-xs-strong-13-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xs-strong-13-font-size` | — | 13px | 0 |
| `font-xs-strong-13-font-style` | — | normal | 0 |
| `font-xs-strong-13-font-weight` | — | 500 | 0 |
| `font-xs-strong-13-line-height` | — | 20px | 0 |
| `font-xxs-12` | — | 12px/18px var(--dsw-font-family) | 15 |
| `font-xxs-12-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xxs-12-font-size` | — | 12px | 0 |
| `font-xxs-12-font-style` | — | normal | 0 |
| `font-xxs-12-font-weight` | — | 400 | 0 |
| `font-xxs-12-line-height` | — | 18px | 0 |
| `font-xxs-strong-12` | — | 500 12px/18px var(--dsw-font-family) | 0 |
| `font-xxs-strong-12-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xxs-strong-12-font-size` | — | 12px | 0 |
| `font-xxs-strong-12-font-style` | — | normal | 0 |
| `font-xxs-strong-12-font-weight` | — | 500 | 0 |
| `font-xxs-strong-12-line-height` | — | 18px | 0 |
| `font-xxxs-11` | — | 11px/14px var(--dsw-font-family) | 5 |
| `font-xxxs-11-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xxxs-11-font-size` | — | 11px | 0 |
| `font-xxxs-11-font-style` | — | normal | 0 |
| `font-xxxs-11-font-weight` | — | 400 | 0 |
| `font-xxxs-11-line-height` | — | 14px | 0 |
| `font-xxxs-strong-11` | — | 500 11px/14px var(--dsw-font-family) | 0 |
| `font-xxxs-strong-11-font-family` | — | var(--dsw-font-family) | 0 |
| `font-xxxs-strong-11-font-size` | — | 11px | 0 |
| `font-xxxs-strong-11-font-style` | — | normal | 0 |
| `font-xxxs-strong-11-font-weight` | — | 500 | 0 |
| `font-xxxs-strong-11-line-height` | — | 14px | 0 |

### mask — 遮罩与模糊（1）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `mask-blur` | none | — | 2 |

### focus — 焦点环（2）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `focus-ring-color` | transparent | — | 83 |
| `focus-ring-width` | 2px | — | 32 |

### linear — 渐变（2）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `linear-gradient-think` | linear-gradient(180deg, #fff 20.19%, #fff0 100%) | linear-gradient(180deg, #151517 20.19%, #15151700 100%) | 0 |
| `linear-think-select` | linear-gradient(180deg, #f5f6f7 20.19%, #f5f6f700 100%) | linear-gradient(180deg, #232325 20.19%, #23232500 100%) | 0 |

### gradient — 渐变（3）

| Token | light | dark | 引用处 |
|---|---|---|---|
| `gradient-onboarding-blue-stops` | #3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe | — | 1 |
| `gradient-onboarding-cyan-stops` | #0293b4 21.154%, #2dc8eb 50.954%, #aff0ff 85.326%, #0293b4 | — | 1 |
| `gradient-onboarding-violet-stops` | #2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6 | — | 1 |

