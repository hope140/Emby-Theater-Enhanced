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
