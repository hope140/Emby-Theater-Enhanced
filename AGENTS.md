# Emby Theater Enhanced 协作规范

开始前阅读本文件、`docs/ARCHITECTURE.md`、`docs/PROJECT_STATUS.md`、`docs/LESSONS_LEARNED.md`，检查 Git 状态、分支、最近提交（如果尚未初始化 Git，则如实记录），再读相关源码。

当前任务基线是 Carnival 3.0 + 用户提供的综合补丁。官方 3.0.21 仅作比对参考。Windows / Emby / 内嵌 libmpv 优先。普通媒体保留原生链路；STRM 增强只替换最终 source，必须保留 PlaybackManager、Item、MediaSource、PlaySession 与远控生命周期。Item.Path 是 sidecar identity，MediaSource.Path 是 source identity。后续 Resolver 失败必须返回原生播放。

第一轮范围为基础构建、安装器、源码审计、外置播放器入口禁用及容错诊断。Mount、CD2、自动映射、Electron 升级和 UI 重做属于后续范围。

原始归档与 vendor 内容只读；维护 `src/`，由 `tools/build.ps1` 生成 runtime。不要运行 Carnival 或综合补丁里的安装/恢复脚本。不要修改已有客户端、个人 mpv 配置或服务器数据。不要自动升级依赖。

每次结束执行相关验证并更新 PROJECT_STATUS、DEVELOPMENT_LOG；架构、决策、经验、构建或测试变化同步更新相应文档。区分静态、隔离 runtime、安装验收、真实 Emby 播放和真实远控证据。未通过不得记为完成。

提交、推送、PR、发布、部署、系统安装和外部发送必须有用户当前任务明确授权；任务书内的提交示例不构成授权。获授权后按可单独回滚的小范围提交。保留无关修改及用户数据。文档不得包含凭据或私人路径。

## 模型分级

开始任务时先判断 Task Risk、Task Uncertainty、Cross-module Scope 与 Playback/Session Impact，并建议 Tier 1、Tier 2 或 Tier 3。默认 Tier 1：GPT-5.6 Luna High（可用时 Luna Max），用于边界清楚的文档、Git、脚本、测试、配置和明确规格实现。文件数量不是升级依据；修改文件、函数、输入输出与验收已明确时，即使跨文件也优先 Tier 1。

Tier 2（GPT-5.6 Sol Medium/High）用于跨模块实现、PlaybackManager、Session/WebSocket、Native fallback、复杂异步和调用图不确定问题。涉及播放器与 Player 两层以上、Session/WebSocket、多个合理根因、两轮 Tier 1 未解决、静态逻辑与测试冲突时可以升级。先尝试缩小范围、补齐文档和拆分任务。

Tier 3（GPT-6 或当时最强可用模型）只用于 Sol High 已完整分析一轮仍无法定位的关键问题、重大架构决策或高风险许可/底层兼容问题；必须记录升级原因。任务应优先拆为分析、执行、验收，不能让不同模型自行发明架构或重写稳定播放链。重要任务在 `docs/DEVELOPMENT_LOG.md` 留下 Model Tier、Model、Reason、Escalated；所有模型均遵守本文件和项目知识库。

## 子代理委派

如果当前 Codex 环境提供 subagent、worker 或 delegation 能力，主线程应主动判断哪些任务可以交给满足要求的最低成本 worker，不应默认由当前高成本模型完成全部工作。

推荐的协作顺序是：

```text
高能力主线程：分析 → 拆任务 → 固化 contract → 定义验收标准
低成本 worker：执行明确任务
高能力主线程：检查 diff → 核对测试 → 验收 → 处理高风险部分
```

### 适合低成本 worker 的任务

在目标、输入输出、允许文件和验收标准均已明确时，优先使用 Luna 或 Luna Max：

- 补充单元测试、测试 case、fake server、fake gRPC、fake HTTP、fixture 和测试数据。
- 执行测试、构建、静态检查、`git diff --check`、重复构建验证，整理测试证据和普通测试失败日志。
- 同步 README、PROJECT_STATUS、DEVELOPMENT_LOG、CHANGELOG 等文档。
- 敏感信息扫描、日志脱敏检查、dependency inventory 和安装包 payload 核对。
- 实现已有明确 contract 的纯函数、helper、mapping、config parser 或独立 resolver 子模块。
- 按明确的 review comment 修复局部问题，或搜索代码引用、调用关系和影响范围。

Luna 适合文档、测试、Git、日志、静态检查、构建验证和信息整理。Luna Max 适合已经完成设计、contract 清楚的普通实现、独立 helper、resolver 子模块、mapping/config、fake fixture 和明确 review comment 的代码修复。文件数量不构成自动升级理由。

### 必须保留给高能力主线程的任务

以下工作不得交给低成本 worker 自行决策：整体架构和跨层接口设计、PlaybackManager 生命周期、Session/PlaySessionId/MediaSource 身份链、libmpv 生命周期、async race/generation/stale response/cancellation、renderer 与 main 的 IPC 安全边界、CD2 或 provider 鉴权与 credential 边界、DirectUrl header 隔离与 URL reacquire、复杂 fallback、多个合理根因的难复现播放故障，以及 merge 前的最终核心正确性审核。

低成本 worker 可以为这些问题收集证据、补测试或验证一个明确假设，但不得改变架构 contract。

### Worker contract

每个 worker 任务至少写明：目标、允许修改的文件、禁止修改的文件、输入、输出、必须保持的不变量、验收标准、必须运行的测试，以及最终汇报内容。

Worker 不得自行扩大范围、增加未经批准的功能、改变批准的架构、重写稳定播放链或 merge PR。发现 contract 不成立、测试结果与设计冲突、必须改变架构或出现新的跨层风险时，应停止扩大实现，保存证据并返回主线程。

### 最小上下文

只向 worker 提供完成任务所需的最小上下文，例如相关测试文件、resolver contract、对应设计章节、当前 diff 和验收 case。无需让 worker 重新读取与任务无关的历史、完整调研、旧 PR 或全部日志。主线程应保留架构决策权，并在委派前明确哪些资料是事实、哪些是假设。

### 并行、worktree 与 branch

当 worker 之间不修改同一核心区域、且没有相互依赖的未决架构时，可以并行执行测试、文档和 packaging/dependency audit。不得让多个 worker 同时修改 PlaybackManager、libmpv 生命周期、同一个未定设计或其他高冲突核心文件。

实现型 worker 在环境支持时使用独立 worktree 和独立 branch；只读研究可以不创建 worktree。主线程负责检查 branch、commit 和 diff，worker 不得自行 merge。当前已有的 PR 或候选实现不因新增委派规则被中途拆分或重构。

### 主线程验收

Worker 报告 `done` 不代表通过。主线程必须查看真实 diff，确认没有越界，核对测试结果，检查关键不变量，确认没有引入新的依赖或未批准行为，并判断是否需要更高模型复核。验收时仍要区分静态检查、隔离 runtime、安装验收、真实 Emby 播放和真实远控证据；worker 的局部测试不能替代更高层验收。

### 停止与升级

Worker 遇到以下任一情况应返回主线程，而不是继续扩大修改：设计与真实行为冲突、需要改变批准的 contract、测试与静态结论冲突、出现跨层生命周期风险，或连续两轮低成本修复仍未定位。汇报至少使用以下结构：

```text
Observed:
Expected:
Evidence:
Files involved:
Tests:
Why current contract may be insufficient:
Recommended escalation:
```

是否升级到 Sol 或更高等级由主线程根据证据决定。

### 上下文成本

不要默认使用一个超长 Sol High 会话完成研究、架构、实现、测试、文档、构建和收尾。优先采用“主线程研究与架构 → 固化设计 → 拆分 worker → worker 执行 → 主线程 review”的流程，把高能力模型保留给真正的高风险问题。
