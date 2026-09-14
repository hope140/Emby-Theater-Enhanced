# Clean-room reproducibility

日期：2026-09-15（UTC+8）

基线：`origin/main` / `main@56b2227324811b525cd73caed61e3399cd2875e5`

本轮分支：`audit/cleanroom-readiness-hardening`

代码提交：`6c5cc9e05b7dbec6a01a2cf81cd19209deb0b319`

## 结论

两个独立 clean worktree 都从上述提交开始，只加入 manifest 指定的两个原始 vendor archive。两边分别执行 `npm ci`、`prepare`、`npm test`、`build`、runtime provenance 和 package verify，结果全部通过。两个 runtime 的 2116 个载荷文件逐路径 SHA256 完全一致。

本轮没有复制开发工作区的 `src/electronapp/www/`、`src/electronapp/preload.js`、`dist/` 或 `node_modules/`。两个 archive 属于任务允许的 vendor inputs，哈希分别为：

| 输入 | SHA256 |
|---|---|
| Carnival 3.0 Windows archive | `9d53fe71b42a530e9941f97ad712bd6724dbb0e7aa0e7de73a4bf9614b28b001` |
| 综合补丁 archive | `2316cd37733b4abf5475dcb9f36d050e2e83c52807ea3b40b9b97d8a80263b43` |

## 环境记录

| 项目 | 实际值 |
|---|---|
| Host Node | `v24.18.1` |
| 执行 ps1 的 Windows PowerShell | `5.1.26100.9444` |
| 调用 shell | PowerShell `7.6.5` |
| Bundled Electron 文件版本 | `18.3.15` |
| Electron 内嵌 Node | `16.13.2`（runtime diagnostics） |

两个验证 worktree 以 `cleanroom-1`、`cleanroom-2` 标识，均为 detached worktree；当前开发分支 worktree 与用户的 `main` worktree 分离。

## 原始 fresh-worktree 失败

在修复前的 `origin/main@56b2227` fresh worktree 中，先按标准顺序执行 `npm ci --ignore-scripts`，再执行 `npm test`，结果为 62 PASS / 1 FAIL（63 tests）。失败测试为：

`tests/external-player-process-chain.test.cjs`

该测试在模块加载时执行：

```js
fs.readFileSync(path.join(__dirname, '../src/electronapp/preload.js'), 'utf8')
```

fresh worktree 没有该文件，因此在测试体开始前以 `ENOENT` 失败。首次完全没有 `node_modules` 时还会多出一个 `cd2-service` 依赖缺失差异；完成锁文件驱动的 `npm ci` 后只剩这个 preload failure。

根因链如下：

1. 当前开发机有一个 620-byte 的 `src/electronapp/preload.js`，但它被 `.gitignore` 忽略，Git 中没有 tracked copy。
2. vendor Carnival 中只有 214-byte 的 `vendor/carnival/electronapp/preload.js`，其中没有 Enhanced diagnostics bridge。
3. 原 `tools/prepare.ps1` 只解包 vendor，没有生成 `src/electronapp/preload.js`。
4. 原 `tools/build.ps1` 会先复制 vendor preload；如果 ignored source 存在，再由 `src/electronapp` overlay 覆盖它。fresh checkout 没有 overlay 时，runtime 仍能得到 vendor preload，但测试读取的 source path 不存在，且 runtime 不具备 diagnostics bridge。
5. `.gitignore` 的该规则原本属于未公开的本地 Electron/Web snapshot 边界，但没有声明这个 required prepared artifact 的生成来源。

## source-of-truth 分类

| 路径/对象 | 类别 | 事实与 contract |
|---|---|---|
| `vendor/carnival/electronapp/preload.js` | C — vendor-derived source | 只读 Carnival baseline，prepare 后由 archive hash 和 vendor manifest 校验 |
| `src/electronapp/preload.js` | D — prepared workspace artifact | 由 `tools/prepare-preload.cjs` 用 vendor preload 加 tracked diagnostics/sticky block 生成；继续 ignored，禁止手工复制 |
| runtime `electronapp/preload.js` | E — runtime-only assembled artifact | build 从 prepared artifact 复制，并由 provenance 同时校验 base/generator/prepared/runtime hash |
| `src/electronapp/www/**` | C — vendor-derived source | fresh source 可缺失；build 从 vendor 得到，`app.js` 和 PlaybackManager 是显式 build overlay |
| `src/electronapp/package.json` | C — vendor-derived source | fresh source 可缺失；build 从 vendor 得到并写入受控 package metadata overlay |
| `src/electronapp/scripts/windowsync.js`、`mpvplayer/strings/en-US.json`、`zh-CN.json` | C — vendor-derived source | manifest 中有对应 vendor 文件，当前没有测试/构建依赖的无来源本地变体 |
| `vendor/carnival/`、`vendor/patch/` | C — prepared vendor inputs | 由两个已锁定 archive prepare 得到，目录只读 |
| `node_modules/`、`dist/`、`.work/`、`docs/evidence/live-acceptance.json` | E — runtime/test-only artifact | 由 npm、build 或 acceptance 生成，不作为 source 输入 |

`src/electronapp/preload.js` 是本轮唯一确认的 BLOCKING portability bug。它既不是可安全 skip 的测试 fixture，也不是应该从某台开发机拷贝的 source；修复为 tracked generator 加 prepare contract。没有把整个 ignored Web snapshot 纳入 Git。

## ignored dependency audit

| 分类 | 项目 | 判断 |
|---|---|---|
| BLOCKING（已修） | `src/electronapp/preload.js` | test 直接读取；runtime 需要 Enhanced diagnostics；此前没有生成来源 |
| SAFE | `src/electronapp/www/**`、`src/electronapp/package.json`、windowsync、两份语言 JSON | vendor fallback/build overlay 有明确来源；provenance 对 app/package overlay 有回归 |
| INTENTIONAL | vendor 解包目录、root archive、`node_modules/`、`dist/`、`.work/`、acceptance 输出 | 原始输入或生成产物，已在文档/脚本 contract 中隔离 |
| UNKNOWN | `vendor/official-reference/` 等历史参考目录 | 当前不被 standard prepare/build/test 路径引用，本轮不改变其归属 |

扫描 `tests/`、`src/electronapp/`、`tools/prepare.ps1`、`tools/build.ps1`、vendor manifest 和 runtime provenance 后，没有发现第二个“测试/构建依赖 ignored 本地文件但没有 tracked 来源”的 BLOCKING 案例。

## 标准 clean-room contract

在 worktree 根目录准备两个允许的 archive 后，命令顺序为：

```powershell
npm ci --ignore-scripts
powershell -NoProfile -ExecutionPolicy Bypass -File tools/prepare.ps1
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1 -OutputName EmbyTheaterEnhanced-cleanroom
node tools/runtime-provenance.cjs validate . dist/EmbyTheaterEnhanced-cleanroom <sourceCommit>
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1 -RuntimeName EmbyTheaterEnhanced-cleanroom -VerifyOnly
```

`prepare.ps1` 和 `build.ps1` 都调用同一个 `prepare-preload.cjs`。生成器是幂等的；vendor base、prepared artifact 和 runtime provenance 不匹配时 fail closed。测试仍然要求该 contract 已完成，不会在缺失 required preload 时 skip。

## 两次独立验证

| worktree | prepare | npm test | build | provenance | package verify |
|---|---|---|---|---|---|
| cleanroom-1 | PASS，1009 vendor files，prepared preload generated | PASS，77/77 | PASS，2116 files | PASS，scope 54，prepared artifact valid | PASS，2116 payload files |
| cleanroom-2 | PASS，1009 vendor files，prepared preload generated | PASS，77/77 | PASS，2116 files | PASS，scope 54，prepared artifact valid | PASS，2116 payload files |

两边的 build manifest 载荷逐路径 SHA256 比较为 identical。provenance 额外记录 `src/electronapp/preload.js` 的 vendor base hash、generator hash、prepared hash 和 runtime hash；其中 prepared/runtime hash 均为 `8e704d3459454084c898ba8dc3821e121a431b1e0e92ee2f06c20b260fa76530`。

## 验证边界

本轮验证的是 clean-room prepare/build/test/provenance/package payload contract，不声称全部 native binary 可以从公开源码位级重建，也没有编译或运行安装器。vendor archive、Electron runtime、native libmpv 和用户 acceptance profile 仍是允许但外部提供的输入。
