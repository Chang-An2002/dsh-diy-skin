# dsh-diy-skin

给 DeepSeek Harness Web GUI 做的「装修」插件：DeepSeek 品牌配色 + 不透明的弹出层 + 可自定义的背景图片 + 自定义界面颜色 + 角落常驻余额显示。

安装后**不会改动 app.asar 里任何官方源码**，卸载即完全还原。

## 它做了什么

1. **背景图片** —— 内置三张，也能自己加（最多 16 张，含一张整图壁纸）。拖动移动、滚轮缩放、拖四角拉伸；每张图单独调透明度和模糊，**右键图片就地调**。
2. **去白底** —— 从四边向内去掉白色背景，**主体内部的白色会保留**。两个旋钮：容差、收边 / 扩边。参数存在图片上，取消勾选就回到原图。
3. **动图（GIF）** —— 原样保存，动画保留；动图不能去白底，那个开关是禁用的并在鼠标悬停时说明原因。
4. **界面配色自定义** —— **22 个旋钮**，每个对应界面上一处，浅色 / 深色分开编辑，自带 7 套预设；**也能把自己调好的整套存成命名方案**，排在预设后面，点一下应用。
5. **角落余额** —— 常驻显示，单击刷新，双击跳转充值页。
6. **存储读数** —— 面板底部显示图片占了多少、还剩多少。上限只能靠测量（点一下按钮），因为浏览器不公开它。

每一项**为什么**这么做、试错过什么、哪些数字是量出来的——都在 **[DESIGN.md](DESIGN.md)**。
## 安装（bundle 方式，当前采用）

本插件已注册为 profile 的**一个真实 bundle**，因此会出现在 Plugin Manager 的「Installed」列表里并带开关。落地为三处改动：

**1. profile 的 `package.json`** —— 加一条依赖，并把包名加进 bundles 列表：

```json
{
  "dependencies": {
    "dsh-diy-skin": "link:<本仓库的绝对路径>/dsh-diy-skin"
  },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-diy-skin"
  ] } }
}
```

**2. 在 profile 目录跑一次 `pnpm install`** —— 解析 `link:` 依赖。

**3. profile 的 `cordis.patch.yml`** —— 移除早先手写的那条 `insert`；插件行现在由 **bundle 自己的 patch**（`package.json` 的 `dsh.bundle.patch`）提供，用的是**裸包名**：

```yaml
- insert:
    - id: deepseek-decor
      name: 'dsh-diy-skin'
```

这三步等价于官方 `install_bundle` 所做的事，可用 `preview/register-bundle.py` 复现（默认干跑，加 `--apply` 才写）。

### 为什么用 `link:` 而不是 `file:`

实测两者差别：

| 写法 | 能装上 | 工作目录改代码是否立即生效 |
|---|---|---|
| `file:<绝对路径>` | ✅ | ❌ 是**复制**，每次改都要重装 |
| `link:<绝对路径>` | ✅ | ✅ 生成 junction，**实时生效** |

因为后续还要反复调样式，选 `link:`——工作目录始终是唯一来源，改完只需刷新页面（若改了宿主半侧或 profile 配置才需要重启）。

另外，`file:` 与 `link:` 都必须用**绝对路径**：相对路径里 `..` 的层数依赖 pnpm 的解析规则，我实测推错过两次，绝对路径没有歧义。

### 早期的写法与它的坑

最初我用「profile 补丁里插一条绝对路径行」的方式安装，踩了一个很隐蔽的坑，值得留着：

DSH 加载器会把 `insert` 里**绝对路径**形式的 `name` 转成 `file://` URL 直接 import（`anchorInsertedPluginNames`，`dsh-app-boot/lib/index.js`），而 **ESM 不允许导入目录**：

```
Error: Directory import '...\dsh-diy-skin' is not supported resolving ES modules
Did you mean to import ".../dsh-diy-skin/index.js"?
```

包里的 `exports["."]` 只在**按包名解析**时生效，对 `file://` 目录 URL 不起作用。写目录的后果是：宿主半侧从未挂载 → 没有 fiber → 不触发 `internal/plugin` 事件 → `client-modules` 的 `dsh.client` 扫描收不到这个包 → 客户端 bundle 从未进入 `__DSH_BOOT__` 的 `entries` → **界面零变化，且控制台没有任何报错**。整条链路静默断在第一环。

改成指向 `index.js` 后能工作，但那只是补丁行方案；bundle 方式用裸包名，走的是标准解析路径，不存在这个问题。

本包**刻意零依赖、且不导出 `Config`**：`Config` 需要 `@deepseek-ai/schemastery`，而它没有随安装目录发布；声明成依赖会让包管理器去 registry 拉一个未必匹配当前构建的版本，而 profile 依赖一旦解析失败，整个 profile 就启动不了。可调项因此写在本文档里，而不是走 `Config`。

## 开关

**插件 → 已安装 → 本插件卡片右侧的开关**（卡片和它的详情页各有一个）。它改的是 `dsh.profile.bundles`：**关掉只是把包名从列表里移除，`dependencies` 里的 `link:` 依赖保留着**，所以再点一下就开回来，不需要重装。

（详情页里还有**行级**开关，那个走 `pluginManager.setPluginEnabled`，往 `cordis.patch.yml` 写 `disabled` 覆盖。只关心整个插件开/关的话用卡片上那个。）

改 `client.js` 源码**必须重启应用**才生效：profile 的 HMR 是开着的，但 base 组合包把它配成 `root: []`——按官方文档，`[]` "仅保留显式注册的配置监听"，也就是**源码模块不在监听范围内**。想让源码改完自动热重载，可以在 profile 补丁里覆盖这一条：

```yaml
- id: hmr
  config:
    root: ["."]
```

## 卸载

在 Plugin Manager 里卸载，或手工做三件事：从 profile 的 `package.json` 移除该依赖与 bundles 条目、在该目录跑一次 `pnpm install`、删掉可能残留的 `disabled` 覆盖。调色板层、材质层、样式表、插槽注册都是随插件生命周期释放的 effect，界面随即回到原始配色。

`localStorage` 里的背景图（key `dsd:background:v2`）**不会**被卸载清掉——这是刻意的，误关插件不该弄丢你自己的图。要彻底清干净就在浏览器控制台里 `localStorage.removeItem('dsd:background:v2')`。

## 已知限制

只列你会遇到的事；每一条的来龙去脉在 [DESIGN.md](DESIGN.md)。

- **图片在应用底下**（`z-index:-1`），所以它只出现在应用自己留空的地方。卡片和输入框保留各自的不透明底色 —— 想让它们也透出来，把「面板与浮层」那个旋钮设成带透明度的值。
- **自己加的图会被压到长边 1600px 的 webp**，超大图细节有损；**动图（GIF）例外**，原样保存，所以可能明显更大。
- **动图不能去白底**：那个开关对 GIF 是禁用的（去白底跑在 canvas 上，只有一帧）。
- **没有输入框能精确设定大小和坐标**：拖动、滚轮、四角拉伸，就这些。
- **深色模式下，浅色底图去白底后可能留一点边**：半透明像素和深色背景混色导致的，不是算法能完全消除的。
- **只在 Windows + 已安装的这个 DSH 版本上验证过**：其他平台的标题栏修正不生效（是空操作），也未验证那边有没有同样的问题。
- **图片存在浏览器级 localStorage 里**：同一台机器的桌面应用内持久，换浏览器就没了；卸载插件不会删掉你的图。
- **编辑期间侧栏按钮点不到**（整块界面被隔离罩挡住），退出用面板的 ✕ 或 Esc。
- **弹出层材质被改成不透明**，官方菜单不再是毛玻璃；不喜欢就删掉 `MATERIAL_TOKENS` 那一层。
- **表情包图片自带文字气泡**，当背景会带上那行字；压低透明度或删掉那个条目。

## 更多

- **[DESIGN.md](DESIGN.md)** —— 设计记录：每个决定的理由、量出来的数字、踩过的坑

- **[KNOB-REACH.md](KNOB-REACH.md)** —— 每个旋钮对应界面上哪一处（实测）

- **[THEME-SURFACE.md](THEME-SURFACE.md)** —— 应用自身的可调 token 与消费方全景

