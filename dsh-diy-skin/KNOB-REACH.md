# 每个旋钮实际改到哪里（实测）

> 由 `analysis/embed-consumers.mjs` 从**已安装的应用**里扫出来，不是凭印象写的。
> 重新生成：`node analysis/embed-consumers.mjs`；只校验：`--check`。

这份文件是面板里那 22 个旋钮的**依据**：旋钮的名字和「在哪看」都是照着它定的。
面板自己只显示「在哪看」那一行——工具提示不该塞着推导过程，但推导过程不该丢掉。

| 旋钮 | token | 在哪看 | 改动处数 | 涉及包数 | 采样到的选择器 | 出现在（按引用数） |
|---|---|---|---|---|---|---|
| 整体底色 | `--dsw-alias-bg-base` | 整个窗口的底：主画布、应用边框 | 83 | 17 | `.frame` `.inspectButton` `.bannerWrap` `.image` | schedule · conversation · layout |
| 面板与浮层 | `--dsw-alias-bg-layer-2` | 弹窗、设置面板的底（比菜单更「重」的浮层） | 47 | 10 | `.dialog` `.panel` `.action` `.addressChanged` | trajectory · sidebar-documentpreview · theme |
| 次要控件底 | `--dsw-alias-bg-module-platform` | 标签、设置页的卡片和按钮、快捷键徽章、分段控件；模型/权限选择器那个按钮本身也是它（弹开的那一列不是） | 53 | 15 | `.selector` `._tag_brmue_4[data-tone=neutral]` `.addCard,.setupCard` `.button` | shortcuts · trajectory · settings-plugin-inventory |
| 弹出层材质 | `--dsw-menu-surface-fill` | 菜单和下拉弹出来的那一层：模型、权限、工作区选择器展开后的列表，右键菜单，以及它们上面那层模糊 | 10 | 4 | `body` `.material` | theme · lib/welcome · primitives |
| 左侧边栏 | `--dsw-specific-sidebar-fill` | 左边整列，含 Windows 顶部那条标题栏。颜色衬在图片下面（图片不被冲淡），侧栏与主界面之间另有一条分隔线 | 24 | 6 | `[data-platform=darwin] .sidebarCol` `.fade` `.notice` `.root` | layout · theme · schedule |
| 会话气泡 | `--dsw-specific-bubble` | 你自己发出去的那条消息 | 10 | 4 | `.bubble` | theme · chat · goal |
| 主要文字 | `--dsw-alias-label-primary` | 正文和标题 | 651 | 42 | `.title` `.root` `.row` `.card` | trajectory · web-frontend · schedule |
| 次级文字 | `--dsw-alias-label-secondary` | 说明文字、状态行、图标按钮 | 463 | 39 | `.expand:hover` `.status` `.description` `.iconButton` | trajectory · plugin-manager · chat |
| 弱化文字 | `--dsw-alias-label-tertiary` | 更淡的辅助文字、空状态提示 | 619 | 40 | `.empty` `.expand` `.status` `.desc` | schedule · chat · trajectory |
| 强调色 | `--dsw-alias-brand-primary` | 勾选框、单选、开关；以及本插件的滑杆和图片选中框 | 40 | 11 | `body` `.checkbox input` `.actions .back:hover:not(:disabled)` `.cardCheckbox input:checked+.indicator` | theme · trajectory · settings-account |
| 主要按钮 | `--dsw-alias-button-primary-fill` | 实心主按钮：本插件的「添加图片」、确认类弹窗的按钮 | 14 | 7 | `.primary` `.acknowledgement input` `.chipActive,.chipActive:hover:not(:disabled)` `.primaryButton` | message-feedback · primitives · settings-account |
| 链接与操作 | `--dsw-alias-link` | 链接、文件引用、@ 提及、空状态里的行动入口 | 22 | 6 | `.fetchUrl` `.fileMention` `.sourceLink` `.emptyAction` | primitives · web-frontend · deliverables |
| 悬停底色 | `--dsw-alias-interactive-bg-hover` | 鼠标经过时的高亮底：列表行、图标按钮、关闭按钮 | 312 | 37 | `.close:hover` `.action:hover` `.iconButton:hover` `.iconButton:hover:not(:disabled)` | schedule · trajectory · conversation |
| 边框与分隔线 | `--dsw-alias-border-l2` | 卡片描边、列表行分隔线、输入框边 | 169 | 31 | `.row` `.footer` `.root` `.separator` | trajectory · schedule · theme |
| 代码块底 | `--dsw-alias-markdown-code-block` | 代码块、命令输出和终端面 | 44 | 10 | `.block` `.body` `.copyButton` `.header` | theme · web-frontend · chat |
| 成功 | `--dsw-alias-state-success-primary` | 跑完的步骤、成功的状态点、已保存提示 | 45 | 10 | `.icon.success` `.add` `.dot[data-state=done]` `.step[data-state=done]` | primitives · web-frontend · tool |
| 警告 | `--dsw-alias-state-warn-primary` | 需要确认、额度不足、进行中的提醒 | 30 | 9 | `.dot[data-state=warning]` `.step[data-state=warning]` `.warning:active` `.warning:hover` | primitives · web-frontend · plugin-manager |
| 错误 | `--dsw-alias-state-error-primary` | 报错、失败、删除类按钮 | 214 | 31 | `.error` `.errorSummary` `.failure` `.danger` | trajectory · plugin-manager · cordis |
| 按钮底色 | `--dsd-chip-fill` | 左下角两个按钮（余额、背景） | — | — | 本插件自绘 | — |
| 按钮描边 | `--dsd-chip-stroke` | 同上，那两个按钮的边 | — | — | 本插件自绘 | — |
| 按钮文字 | `--dsd-chip-ink` | 同上，那两个按钮上的字 | — | — | 本插件自绘 | — |
| 余额数字 | `--dsd-chip-ink-strong` | 余额按钮上那个金额 | — | — | 本插件自绘 | — |

官方可调 token 共 120 个（alias 107 · specific 11 · menu 2）；51 个包直接写死了颜色，任何 token 都改不到。
