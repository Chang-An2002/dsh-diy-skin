# dsh-diy-skin

一个给 DSH 用的 DeepSeek 品牌皮肤插件：把背景图片垫在整个界面下面、22 个配色旋钮、可以把自己的调色板存成命名方案、去白底、角落余额。零依赖，浏览器半边就是一个自包含的 bundle。

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
| `preview/` | 宿主半导入检查、探针、logo 提取 |

## 每次改动后跑这几条

```sh
node analysis/fix-css-backticks.mjs --check   # （先跑这个，它会在需要时修）
node dsh-diy-skin/test/client.test.mjs       # 74 条测试
node analysis/plugin-guards.mjs               # 结构守卫
node analysis/blue-audit.mjs                  # 没有游离的蓝色
node analysis/palette-defaults.mjs            # 旋钮默认值 vs 已安装应用
node analysis/embed-consumers.mjs --check     # 文档里的数字还与代码一致
node analysis/pubcheck.mjs                    # 发布就绪清单
```

## 许可

MIT。
