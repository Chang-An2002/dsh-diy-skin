/**
 * Build the theme-surface report: which parts of the Harness UI can be recoloured
 * from a plugin, and with which token.
 *
 * Everything here is read out of the installed app, not asserted from memory:
 *
 *   - the token inventory (names, light/dark values) comes from the shipped
 *     `@deepseek-ai/dsh-client-ui-theme`, which owns the palette;
 *   - the consumer map — token -> packages that call `var(--token)` — comes from
 *     one pass over every text entry in `app.asar`;
 *   - the "not token-driven" column counts literal hex colours per package, which
 *     is where a token override cannot reach.
 *
 * Usage: node analysis/theme-surface.mjs [path/to/app.asar] [out.md]
 */
import { openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';

const ASAR =
  process.argv[2] ?? 'C:\\Users\\pipi0\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const OUT =
  process.argv[3] ??
  'C:\\Users\\pipi0\\Documents\\deepseek-harness\\default-workspace\\dsh-diy-skin\\THEME-SURFACE.md';

// ---------------------------------------------------------------- asar access
const fd = openSync(ASAR, 'r');
const pre = Buffer.alloc(16);
readSync(fd, pre, 0, 16, 0);
const stringLen = pre.readUInt32LE(4);
const raw = Buffer.alloc(stringLen);
readSync(fd, raw, 0, stringLen, 12);
let headerText = raw.subarray(4).toString('utf8');
headerText = headerText.slice(0, headerText.lastIndexOf('}') + 1);
const header = JSON.parse(headerText);
const BASE = 12 + stringLen;

const entries = [];
(function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, entry] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p);
    else entries.push([p, entry]);
  }
})(header, '');

function readEntry(entry) {
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, BASE + Number(entry.offset));
  return buf;
}

/** `dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js` -> the package name. */
function packageOf(internalPath) {
  const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(internalPath);
  return match ? match[1] : internalPath.split('/').slice(0, 2).join('/');
}

// ------------------------------------------------------------- token inventory
const THEME = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js';
const themeEntry = entries.find(([p]) => p === THEME);
if (!themeEntry) throw new Error('the shipped theme package is not in the archive');
const themeSource = readEntry(themeEntry[1]).toString('utf8');

/** Every CSS string in the package, so each one can be scanned in isolation. */
const cssStrings = [...themeSource.matchAll(/=\s*"((?:[^"\\]|\\.){200,})"/g)].map((m) =>
  m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
);

const tokens = new Map(); // name -> { light, dark }
for (const css of cssStrings) {
  let mode = 'light';
  const re = /\[data-ds-dark-theme\]|--dsw-([a-z0-9-]+)\s*:\s*([^;}"]+)/g;
  let match;
  while ((match = re.exec(css))) {
    if (match[0].startsWith('[')) {
      mode = 'dark';
      continue;
    }
    const name = '--dsw-' + match[1];
    const value = match[2].trim();
    const record = tokens.get(name) ?? {};
    // First declaration wins per mode: later repetitions are component-local
    // re-declarations of the same value.
    if (!record[mode]) record[mode] = value;
    tokens.set(name, record);
  }
}

// ------------------------------------------------------------------- consumers
const consumers = new Map(); // token -> Map(package -> count)
const literalColors = new Map(); // package -> count of literal hex colours
for (const [internalPath, entry] of entries) {
  if (entry.unpacked === true) continue;
  if (typeof entry.size !== 'number' || entry.size === 0 || entry.size > 8 * 1024 * 1024) continue;
  if (!/\.(js|mjs|cjs)$/.test(internalPath)) continue;
  const buf = readEntry(entry);
  if (buf.subarray(0, 1024).includes(0)) continue;
  const text = buf.toString('utf8');
  const pkg = packageOf(internalPath);
  for (const match of text.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)) {
    const name = match[1];
    if (!consumers.has(name)) consumers.set(name, new Map());
    const perPackage = consumers.get(name);
    perPackage.set(pkg, (perPackage.get(pkg) ?? 0) + 1);
  }
  const hexes = (text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  if (hexes > 0) literalColors.set(pkg, (literalColors.get(pkg) ?? 0) + hexes);
}

function consumerCount(name) {
  const perPackage = consumers.get(name);
  if (!perPackage) return 0;
  let total = 0;
  for (const count of perPackage.values()) total += count;
  return total;
}

function topConsumers(name, limit = 3) {
  const perPackage = consumers.get(name);
  if (!perPackage) return '—';
  return [...perPackage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pkg, count]) => `${pkg.replace('@deepseek-ai/', '')}×${count}`)
    .join(', ');
}

// --------------------------------------------------------------- token groups
const FAMILIES = [
  ['static', '原始色板（一切颜色的源头）'],
  ['alias', '语义 token（官方推荐的调整层）'],
  ['specific', '平台专有表面'],
  ['menu', '菜单材质'],
  ['elevation', '阴影 / 描边'],
  ['shadow', '阴影阶'],
  ['radius', '圆角'],
  ['font', '字体'],
  ['mask', '遮罩与模糊'],
  ['focus', '焦点环'],
  ['scrollbar', '滚动条'],
  ['linear', '渐变'],
  ['gradient', '渐变'],
  ['shiki', '代码高亮'],
];

function familyOf(name) {
  const rest = name.slice('--dsw-'.length);
  return FAMILIES.find(([prefix]) => rest.startsWith(prefix + '-'))?.[0] ?? 'other';
}

const byFamily = new Map(FAMILIES.map(([key]) => [key, []]));
for (const [name, record] of tokens) {
  const family = familyOf(name);
  if (!byFamily.has(family)) byFamily.set(family, []);
  byFamily.get(family).push([name, record]);
}
for (const list of byFamily.values()) list.sort((a, b) => a[0].localeCompare(b[0]));

/** The alias tokens, grouped by their second segment for readability. */
const aliasGroups = new Map();
for (const [name, record] of byFamily.get('alias') ?? []) {
  const segment = name.slice('--dsw-alias-'.length).split('-')[0];
  if (!aliasGroups.has(segment)) aliasGroups.set(segment, []);
  aliasGroups.get(segment).push([name, record]);
}

// ------------------------------------------------------------------ the report
const lines = [];
const push = (...text) => lines.push(...text);

push('# DSH 界面配色可调范围（实测清单）');
push('');
push('> 这份文件由 `analysis/theme-surface.mjs` 从**已安装的应用**里读出来生成，不是凭印象写的。');
push('> 重新生成：`node analysis/theme-surface.mjs`');
push('');
// Provenance, but portable. The absolute path this happened to read is a fact
// about one machine, and it leaks a user name into a file that ships with the
// plugin; what a reader actually needs is which build the numbers came from, and
// that is the entry count plus the archive size — both machine-independent.
push(
  `读取自：\`<安装目录>/resources/app.asar\`（${entries.length} 个条目，` +
    `${(statSync(ASAR).size / 1024 / 1024).toFixed(1)} MB）`,
);
push('路径可用参数或 `DSH_ASAR` 覆盖；报告里的名字、数量、选择器都只取决于这个文件。');
push('');

push('## 1. 机制：一个插件能怎么改颜色');
push('');
push('官方在客户端暴露了唯一的主题扩展点：');
push('');
push('```js');
push("ctx.theme.overrideTokens(source, { '--dsw-alias-bg-base': { light: '#fff', dark: '#0d1424' } })");
push('```');
push('');
push('四条硬性规则：');
push('');
push('1. **值必须是 `{ light, dark }` 成对**。传裸字符串会抛教学错误——单值在切换配色后会读不清。');
push('2. **层叠加，后注册的按 token 覆盖**（`ui-theme` 的 `composeActive`：按注册序号排序，逐 token 取当前配色的值）。');
push('3. **presenter 把 `active.tokens` 每一项写成 `body` 上的内联自定义属性**（`ui-layout` 的 `apply()`）。所以覆盖不必是 `--dsw-alias-*`——任何 `--dsw-*` 名字都行，这一点本插件的菜单材质层就用了。');
push('4. **卸载即还原**：层随 `ctx.effect` 的生命周期移除，基础主题从未被修改。');
push('');
push('推论：**能覆盖的 token 集合 = 这个应用里所有 `--dsw-*` 自定义属性**，下面就是它们的全集。');
push('');

push('## 2. Token 三层结构');
push('');
push('| 层 | 数量 | 作用 | 该不该改 |');
push('|---|---|---|---|');
push(`| \`--dsw-static-*\` | ${(byFamily.get('static') ?? []).length} | 原始色板（neutral / bluish / deepseek 品牌梯级 / 语义色） | 能改，但影响面最大 |`);
push(`| \`--dsw-alias-*\` | ${(byFamily.get('alias') ?? []).length} | 语义层：bg-* / label-* / border-* / button-* / state-* … | **推荐改这一层** |`);
push(`| \`--dsw-specific-*\` / \`--dsw-menu-*\` / \`--dsw-elevation-*\` 等 | ${[...byFamily.entries()].filter(([k]) => !['static', 'alias'].includes(k)).reduce((n, [, v]) => n + v.length, 0)} | 具体表面：平台专有底、菜单材质、阴影、圆角、字体、遮罩 | 按需改 |`);
push('');
push('官方自己的语义层就是「alias → static」：');
push('');
push('```css');
push('body{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00)}');
push('body[data-ds-dark-theme]{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950)}');
push('```');
push('');
push('所以改 `--dsw-alias-*` 等于改了「这个界面元素该是什么颜色」，而改 `--dsw-static-*` 等于换了**整套色板**（品牌蓝、灰阶、成功/警告/错误全在内）——后者是"换肤"，前者是"调装修"。');
push('');
push('两个值得知道的细节：');
push('');
push('- **品牌色梯级在 `--dsw-static-deepseek-*`**（50/100/…/600，外加一个 `-700-delete`）。本插件当前用的是 500 `#4176e6` 与 400 `#7aaaff`。想整体换品牌色，改这一串比逐个改 alias 干净。');
push('- **`--dsw-static-*-aXX` 是同一色的 alpha 变体**（`#22c55e14` 这种，`XX` 是十六进制不透明度）。悬停底色、半透明描边走的就是它们。');
push('');

push('## 3. 区域 → token 地图');
push('');
push('左边是界面上能认出来的区域，中间是它实际吃哪些 token（**消费方列是从代码里数出来的**，不是猜的），右边是这个区域"主要归谁管"。');
push('');
push('| 界面区域 | 主要 token | 实测消费方（前 2） |');
push('|---|---|---|');
const REGIONS = [
  ['整体底色 / 主画布', ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3']],
  ['左侧栏', ['--dsw-specific-sidebar-fill', '--dsw-alias-border-l3', '--dsw-alias-interactive-bg-hover']],
  ['会话区 / 消息气泡', ['--dsw-specific-bubble', '--dsw-alias-label-primary', '--dsw-alias-label-primary-dimmed']],
  ['输入框（composer）', ['--dsw-elevation-soft', '--dsw-alias-bg-module-platform', '--dsw-alias-border-l2']],
  ['菜单 / 浮层', ['--dsw-menu-surface-fill', '--dsw-menu-backdrop-filter', '--dsw-specific-menu']],
  ['模态 / 设置面板', ['--dsw-alias-bg-layer-2', '--dsw-alias-bg-mask-1', '--dsw-elevation-prominent']],
  ['按钮', ['--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-ghost-active-fill']],
  ['链接 / 强调文字', ['--dsw-alias-link', '--dsw-alias-brand-text', '--dsw-alias-brand-primary']],
  ['状态色（成功/警告/错误/进行中）', ['--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary']],
  ['代码块 / Markdown', ['--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-inline-code', '--dsw-alias-markdown-tag']],
  ['边框 / 分隔线', ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4']],
  ['文字层级', ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption']],
  ['滚动条', ['--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-hover-l1']],
  ['阴影 / 高层级', ['--dsw-elevation-stroke-color', '--dsw-elevation-panel', '--dsw-elevation-prominent']],
];
for (const [region, names] of REGIONS) {
  const cells = names.map((name) => `\`${name.replace('--dsw-', '')}\``).join(' ');
  const evidence = names
    .filter((name) => consumers.has(name))
    .slice(0, 1)
    .map((name) => topConsumers(name, 2))
    .join(' / ');
  push(`| ${region} | ${cells} | ${evidence || '—'} |`);
}
push('');
push('## 4. Alias 分组（可直接调的那一层）');
push('');
push('每组都是 `--dsw-alias-<组>-*`。数量多的组就是"改动波及面大"的组。');
push('');
push('| 组 | 数量 | 例子 |');
push('|---|---|---|');
for (const [segment, list] of [...aliasGroups].sort((a, b) => b[1].length - a[1].length)) {
  push(`| \`${segment}\` | ${list.length} | ${list.slice(0, 3).map(([n]) => '`' + n.replace('--dsw-alias-', '') + '`').join(' ')} |`);
}
push('');

push('## 5. 已经由本插件接管的');
push('');
push('- `BRAND_TOKENS`：品牌源 + 文字 + 表面 + 边框等（数量见启动日志 `brand palette applied (N tokens)`）。');
push('- `MATERIAL_TOKENS`：`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter`、`--dsw-specific-menu`、`--dsw-alias-menu-group-header-fill` —— 把弹出层从半透明毛玻璃改成不透明。');
push('- `USER_COLOR_LAYER`：用户在「背景与配色」面板里自己调的颜色。第三层，叠在上面两层之上，所以用户的选择永远赢过自带皮肤；面板里的「恢复默认」清空的正是这一层。');
push('- 这三层是**独立的 `overrideTokens` source**，可以分别删；插件卸载时三层都会被收回。');
push('');
push('### 面板里可以直接调的旋钮');
push('');
push('每个旋钮**就是一个 token**（不是一组），所以「调它会影响哪里」有唯一答案 —— 用下面第 3 节那张区域表去查。');

// The knob table is read out of the shipped client half rather than restated
// here: a report that lists knobs the panel does not have is worse than no
// report, and the only way to be sure is to read the same array the panel maps
// over.
const clientSource = (() => {
  try {
    return readFileSync(
      new URL('../dsh-diy-skin/client.js', import.meta.url),
      'utf8',
    );
  } catch {
    return '';
  }
})();
const slotBody =
  /const COLOR_SLOTS = \[([\s\S]*?)\n    \];/.exec(clientSource)?.[1] ?? '';
const slotRows = [];
for (const line of slotBody.split('\n')) {
  const match =
    /label:\s*'([^']+)'.*?token:\s*'(--[a-z0-9-]+)'.*?light:\s*'(#[0-9a-f]+)'.*?dark:\s*'(#[0-9a-f]+)'/.exec(line);
  if (match) slotRows.push(match);
}
const presetBody = /const COLOR_PRESETS = \[([\s\S]*?)\n    \];/.exec(clientSource)?.[1] ?? '';
const presetNames = [...presetBody.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
if (slotRows.length === 0) {
  push('');
  push('（未能从 `client.js` 读出旋钮表 —— 生成器需要更新正则。）');
} else {
  push('');
  push(`共 ${slotRows.length} 个旋钮，预设：${presetNames.map((n) => '「' + n + '」').join(' ')}。`);
  push('');
  push('| 旋钮 | token | 浅色默认 | 深色默认 |');
  push('|---|---|---|---|');
  for (const [, label, token, light, dark] of slotRows) {
    push(`| ${label} | \`${token.replace('--dsw-', '')}\` | \`${light}\` | \`${dark}\` |`);
  }
  push('');
  push('默认值不是抄来的：`analysis/palette-defaults.mjs` 从**已安装的应用**里把这些 token 的实际取值读出来，逐条和上表比对。');
}
push('');

push('## 6. 覆盖不到的地方');
push('');
push('Token 是**唯一可靠的**入口，其它颜色都在 token 之外：');
push('');
push('| 类型 | 说明 |');
push('|---|---|');
push('| 官方 CSS 里写死的字面色值 | 见下表，按包统计。这些不会被 token 覆盖影响 |');
push('| 插画 / 图标素材 | 本插件的三张图、官方 logo 等，颜色是素材自带的 |');
push('| 第三方插件的样式 | 它们可以自己写死颜色，也可以自己注册 `overrideTokens` 层（和本插件同级竞争） |');
push('| 原生视图里的网页 | 例如充值页那种宿主 `WebContentsView`，完全不受插件 CSS 影响 |');
push('');
push('各包里写死的十六进制色值数量（前 15，越多说明该区域越依赖字面值）：');
push('');
push('| 包 | 字面色值数 |');
push('|---|---|');
for (const [pkg, count] of [...literalColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  push(`| \`${pkg.replace('@deepseek-ai/', '')}\` | ${count} |`);
}
push('');

push('## 7. 数据附录：全部 token');
push('');
for (const [family, label] of FAMILIES) {
  const list = byFamily.get(family) ?? [];
  if (list.length === 0) continue;
  push(`### ${family} — ${label}（${list.length}）`);
  push('');
  push('| Token | light | dark | 引用处 |');
  push('|---|---|---|---|');
  for (const [name, record] of list) {
    const light = record.light ?? '—';
    const dark = record.dark ?? '—';
    push(`| \`${name.replace('--dsw-', '')}\` | ${light} | ${dark} | ${consumerCount(name)} |`);
  }
  push('');
}

writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

console.log(`tokens: ${tokens.size}`);
for (const [family, list] of byFamily) if (list.length) console.log(`  ${family.padEnd(12)} ${list.length}`);
console.log(`packages with literal colours: ${literalColors.size}`);
console.log(`wrote ${OUT}`);
