# dsh-diy-skin

[![npm](https://img.shields.io/npm/v/dsh-diy-skin?color=2f6fed)](https://www.npmjs.com/package/dsh-diy-skin) [![license](https://img.shields.io/npm/l/dsh-diy-skin)](dsh-diy-skin/LICENSE)

一个给 DSH 用的 DeepSeek 品牌皮肤插件：把背景图片垫在整个界面下面、22 个配色旋钮、可以把自己的调色板存成命名方案、去白底、角落余额。零依赖，界面部分就是一个自包含的 bundle。

## 安装

前提：**DeepSeek Harness 桌面端应用**（Web 端没有测试过，见下）。

1. 侧栏打开「插件」面板 → **添加插件** → 输入包名 `dsh-diy-skin` → 确认
2. **重启应用**
3. 左下角出现「背景」入口，点它开始编辑

也可以手动改 profile 的 `package.json`：加一行 `"dsh-diy-skin": "^1.30.3"`，然后在 profile 目录跑 `pnpm install`。

## 实测范围

下面这些是**真的跑过**的，不是"理论上应该可以"：

- 平台：**Windows + 桌面端应用**，以及本机已安装的那个 DSH 版本
- 功能：界面挂载、背景图片（拖动 / 滚轮 / 四角拉伸）、去白底（容差与收边）、22 个配色旋钮与自定义方案的存取、余额芯片、右键图片小窗、动图（GIF）、存储读数与上限测量

**Web 端（浏览器里的 DSH）从未运行验证过**，表现未知；代码里有一部分是桌面端专属的（例如 Windows 标题栏那条修正），在 Web 端不生效。

## 从这里去哪

- **[dsh-diy-skin/README.md](dsh-diy-skin/README.md)** —— 插件自己的文档：它做了什么、怎么装、怎么用、有哪些限制
- **[dsh-diy-skin/DESIGN.md](dsh-diy-skin/DESIGN.md)** —— 设计记录：每个决定的理由、量出来的数字、踩过的坑
- **[dsh-diy-skin/KNOB-REACH.md](dsh-diy-skin/KNOB-REACH.md)** —— 每个旋钮对应界面上哪一处（实测）
- **[dsh-diy-skin/THEME-SURFACE.md](dsh-diy-skin/THEME-SURFACE.md)** —— 应用自身的可调 token 与消费方全景

## 仓库结构

| 目录 | 是什么 |
|---|---|
| `dsh-diy-skin/` | 插件本体（发布到 npm 的就是这个目录） |
| `analysis/` | 校验脚本：发布检查、主题守卫、冻结色审计、从已安装应用里实测 token |
| `preview/` | 插件加载检查、探针、logo 提取 |

## 每次改动后跑这几条

```sh
node analysis/fix-css-backticks.mjs --check   # 只检查；去掉 --check 才会真的修
node dsh-diy-skin/test/client.test.mjs       # 74 条测试
node analysis/plugin-guards.mjs               # 结构守卫
node analysis/blue-audit.mjs                  # 没有游离的蓝色
node analysis/palette-defaults.mjs            # 旋钮默认值 vs 已安装应用
node analysis/embed-consumers.mjs --check     # 文档里的数字还与代码一致
node analysis/pubcheck.mjs                    # 发布就绪清单
```

## 许可

MIT。
