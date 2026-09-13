# AI / Codex 模型使用策略

## 默认规则

默认使用 Tier 1：GPT-5.6 Luna High；环境提供 Luna Max 时可优先用于已明确设计后的编码。目标是承担 70% 以上日常任务。选择等级主要看不确定性、跨模块程度、失败成本、架构影响和是否触碰播放生命周期，不以代码行数或文件数量决定。

| 任务 | 默认模型 |
|---|---|
| README、知识库、Git/Tag、日志、`.gitignore`、简单测试、构建/安装脚本 | Luna |
| 明确设计后的功能编码、Mount Resolver 最小实现、CD2 基础 API/Mapping | Luna Max |
| Mount 复杂回归、CD2 Range/Header/异步兼容、PlaybackManager、Session/WebSocket | Sol |
| libmpv 生命周期、Electron/PPAPI bridge | Sol High |
| Electron 大版本升级、跨多层难复现播放故障 | Sol → GPT-6 |

## 升级与降级

Luna → Sol：涉及 PlaybackManager 与 player 两层以上、Session/WebSocket、Native fallback、多个合理根因、连续两轮 Tier 1 无解、需理解较大调用图，或测试结果与静态逻辑冲突时可考虑。先澄清规格、读取已有文档或拆成分析/执行/验收任务。

Sol → GPT-6：仅在 Sol High 已完整分析至少一轮，且问题仍未定位、修改风险极高或需要重大架构决策时使用；开发日志必须写明原因。Tier 3 目标占比不超过 5%。

如果修改文件、函数、输入输出、测试与验收标准都已明确，即使涉及多个文件，也应降回 Tier 1。文件多不代表难，未知多才代表难。当前模型高于建议等级时可以完成当前任务，但后续同类任务应采用更低成本模型。

## Orchestrator / Worker 原则

Sol High 默认优先承担 orchestrator、architect 和 reviewer 角色，不默认作为 implementation worker。设计已批准、接口和输入输出明确、修改范围清楚、验收标准完整时，应优先把可隔离的执行工作委派给可靠完成任务所需的最低成本模型。

| 角色 | 适合承担的工作 |
|---|---|
| Luna | 文档、测试、Git、日志、静态检查、构建验证、信息整理和敏感信息扫描 |
| Luna Max | 已完成设计的普通实现、独立 helper、resolver 子模块、mapping/config、fake fixture 和明确 review comment 的局部修复 |
| Sol | 复杂跨模块分析或实现，以及需要理解较大调用图的兼容性问题 |
| Sol High | 高风险架构、Playback/Session/libmpv 生命周期、异步 race、IPC/credential 边界和最终核心 review |

主线程应先分析问题、拆分任务、固化 contract 并定义验收，再由 worker 执行，最后由主线程检查真实 diff、核对测试、检查不变量并决定接受、返工或升级。Worker 任务至少必须说明目标、允许和禁止修改的文件、输入输出、不变量、验收标准、测试和汇报内容；worker 不得自行扩大范围、改变架构 contract、重写稳定播放链或 merge PR。

低成本 worker 可以为高风险问题收集证据、补测试或验证明确假设，但不得自行决定整体架构、PlaybackManager/Session/PlaySessionId/MediaSource 身份链、libmpv 生命周期、generation/cancellation、renderer-main IPC 安全边界、CD2/provider credential、DirectUrl header 与 expires URL 处理，或复杂 fallback。主线程应向 worker 提供最小必要上下文，并在并行时用互不冲突的 worktree/branch 隔离实现；只读研究可以不创建 worktree。

如果 worker 发现设计与真实行为冲突、contract 不成立、测试与静态结论冲突、出现跨层生命周期风险，或连续两轮低成本修复仍未定位，应停止扩大实现并返回证据。升级报告至少包含 `Observed`、`Expected`、`Evidence`、`Files involved`、`Tests`、`Why current contract may be insufficient` 和 `Recommended escalation`。Worker 的 `done` 不构成通过，静态或局部测试也不替代真实播放、Session、远控或安装验收。

这套委派规则从当前在途 PR 完成后的新任务开始作为默认工作方式；在途 PR 继续由当前主线程按既定范围完成，不因规则新增而中途拆分或重构。

## 边界与留痕

模型策略不能改变架构治理：所有模型都遵守 `AGENTS.md`、`ARCHITECTURE.md`、`DECISIONS.md` 和 `PROJECT_STATUS.md`。不得让低成本模型擅自重构核心播放链，也不得让高成本模型扩大已授权范围。

重要任务在 `docs/DEVELOPMENT_LOG.md` 记录：

```text
Model Tier: 1
Model: GPT-5.6 Luna Max
Reason: task contract and acceptance criteria were already explicit
Escalated: no
```

未来 STRM Mount Resolver：主线程先确定规格；Luna Max 实现 Detection、最小 Resolver、Native fallback 与测试；Luna 维护文档和测试；只在播放链、Session 或 DirectStream 出现复杂问题时由 Sol 介入。GPT-6 默认不使用。
