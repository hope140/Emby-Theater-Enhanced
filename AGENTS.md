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
