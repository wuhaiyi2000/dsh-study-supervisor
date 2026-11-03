# 学习监督台 · dsh-study-supervisor

一个运行在 DeepSeek Harness 桌面端（Web GUI）的客户端插件：在界面底部常驻一条**学习监督栏**，把「专注计时 + 今日任务打卡 + 学习统计」放在你眼前。

- 位置：Shell 的整行底部槽位 `shell.bottom`（三栏下方，横跨整个窗口），可一键收起。
- 数据：全部存在浏览器 `localStorage`（键 `dsh-study-supervisor:state:v1`），不联网、不读系统权限、不上报。
- 语言：跟随 Harness 界面语言（中文 / English 两套词典）。

## 功能

**收起态（46px 高一行）**

| 元素 | 说明 |
|---|---|
| 状态灯 + 计时 | 未开始 / 专注中 / 已暂停 / 休息中；大号等宽倒计时 |
| 今日进度 | `今日专注 25 分 / 2 小时` + 进度条，达成目标变绿 |
| 当前任务 | 点击可取消选择；下方任务清单里点某行即可设为当前任务 |
| 连续天数 | 有专注记录的天数连续统计 |
| 操作 | `开始专注` / `暂停` / `继续` / `结束休息`、`放弃本轮`、`分心 +1`（专注中记录走神次数）、收起 |

**展开态（三栏）**

1. **任务清单**：输入回车添加任务；勾选框完成；行悬停出现删除；`未完成 / 总数`。
2. **今日**：今日专注时长、番茄（专注段）数、今日完成任务数；近 7 天专注柱状图（今天高亮）。
3. **设置**：专注时长（15–90 分钟）、休息时长（0–20 分钟）、每日目标（0–5 小时）、专注结束是否自动开始休息。

**计时行为**

- 倒计时按时间戳计算，切标签页、息屏、重开页面都不会「少走秒」；到点自动结算。
- 专注结束：写入一条专注记录（含开始/结束时间、分钟数、关联任务、分心次数），响两下提示音，并按设置自动进入休息。
- 休息结束：提示「开始下一轮」。
- 「放弃本轮」不计入统计，仅丢弃当前计时。

## 安装（任意机器）

```powershell
git clone https://github.com/wuhaiyi2000/dsh-study-supervisor.git
cd dsh-study-supervisor
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> 前提：这台机器上已经跑过一次 DSH 桌面端（会生成 `%USERPROFILE%\.dsh\profiles\desktop`）。
> 非桌面 profile（`web` / `tui`）可以直接 `dsh plugin --profile <名字> add github:wuhaiyi2000/dsh-study-supervisor`；桌面 profile 由应用自己管理，用上面的脚本或应用里的插件管理页。

要求：DSH 0.2.x（客户端模块 `dsh.client` 协议），无需构建步骤，`client.js` 就是可直接加载的浏览器模块。

## 安装状态（本机已装好）

插件包：`D:\DSH\study-supervisor`（通过 Windows 目录联接接入桌面 profile）

对 `C:\Users\why001216\.dsh\profiles\desktop` 做了三处改动：

1. `node_modules\dsh-study-supervisor` → 指向 `D:\DSH\study-supervisor` 的目录联接（junction）；
2. `package.json` 的 `dependencies` 增加 `"dsh-study-supervisor": "link:D:\\DSH\\study-supervisor"`；
3. `package.json` 的 `dsh.profile.bundles` 追加 `"dsh-study-supervisor"`。

原 `package.json` 备份在 `D:\DSH\.verify\profile-package.json.orig`。

> 因为是 `link:` 目录联接，改动 `client.js` 后**不用重新安装**：Harness 的 HMR 会热替换浏览器端模块；改动 `index.js` 会热重载 Host 端插件。只有重启应用才需要重新走一遍安装流程（配置已持久化，重启自动生效）。

## 换一台电脑

1. 用上面的「安装」步骤装好（`git clone` 或直接把整个目录拷过去，再跑 `install.ps1`）；
2. 打开面板「设置 → 跨机同步」，把老机器的记录带过来（见下一节）。

`install.ps1` 只做三件事，且可重复执行：建立目录联接、往 profile `package.json` 写 `link:` 依赖、把 bundle 加进 `dsh.profile.bundles`；改之前会把清单备份到 `%TEMP%`。装完 DSH 会自动热加载（没反应就重启一次）。

## 跨机同步

面板「设置 → 跨机同步」提供四个动作：

| 动作 | 做什么 |
|---|---|
| 导出文件 | 下载 `study-supervisor-YYYY-MM-DD.json`，含任务、专注记录、设置 |
| 导入文件 | 选一个导出的 JSON，**按条合并**进本机 |
| 复制同步码 | 把同样的内容压成一行 `SSV1:...`（UTF-8 base64），可直接发微信/邮件 |
| 粘贴同步码 | 打开输入框并尽量自动读取剪贴板；粘进去点「合并导入」 |

合并规则（不会互相覆盖）：

- 专注记录按 `id` 去重累加——两台机器各记各的，合起来不会重复；
- 任务按 `id` 合并，任一侧标记过完成就算完成；
- 本机设置、正在进行的计时、面板展开状态**不参与导入**，本机优先。

直接贴未编码的导出 JSON 也认。同步码很长（几十 KB 量级），聊天工具里发文件更稳。

## 卸载

```powershell
cd <插件目录>
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

脚本删除目录联接、从 profile 清单里移除依赖与 bundle（清单同样先备份到 `%TEMP%`），插件目录与学习数据都保留。手动方式见下方「开发与验证」末尾的备份还原。

## 开发与验证

```
study-supervisor/
  package.json        # dsh.bundle.patch + dsh.client（platform: web, immediately）
  cordis.patch.yml    # 插入 study-supervisor 这一行
  index.js            # Host 半部（本插件不需要 Host 能力，仅提供 Loader 行）
  client.js           # 浏览器半部：模块工厂 + React 组件 + 主题化样式 + 词典 + 同步编解码
  locale/en.json      # 插件管理/设置里显示的名称与说明
  locale/zh.json
  icon.svg            # 插件图标
  install.ps1         # 装到当前机器（可重复执行）
  uninstall.ps1       # 从当前机器移除
  test/smoke.mjs      # 无浏览器冒烟测试
```

```powershell
cd D:\DSH\study-supervisor
node --check client.js
node test/smoke.mjs
```

冒烟测试用最小 React 替身执行真实模块契约：校验 `window.__ModuleLoader__.load` 的 id、`inject`、`apply` 注册的槽位、词典双语完整性，渲染「空闲 / 进行中」两帧断言倒计时与统计，并直测同步编解码与合并语义（UTF-8 往返、乱码拒绝、按 id 去重、完成态保留、设置不被覆盖）。

样式只使用 Harness 主题令牌（`--dsw-alias-*`、`--dsw-radius-*`），没有引入任何 Harness 客户端包，因此不会随宿主内部实现升级而失效。

## 验证记录

- `node --check client.js` / `index.js`：通过。
- `node test/smoke.mjs`：模块契约、双语词典、渲染两帧、同步码往返与合并语义全部通过。
- Host 侧：插件行已被正在运行的 Host 组合并激活（`index.js` 的 `apply` 在 pid 38916 上执行）。
- 前端图：`GET http://127.0.0.1:51414/plugins/events` 的图里已出现
  `{"id":"dsh-study-supervisor","url":"plugins/??dsh-study-supervisor/client.js&rev=...","inject":["@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-locale"],"immediately":true}`
- 资源：该 URL 返回 200，内容与 `client.js` 一致；加入同步功能后 revision 变为 `ebbf23c96a38`，服务端内容已含 `SSV1:` 编解码。
- 未验证：页面里的最终像素与交互（本会话没有浏览器控制，无法截图），需要你在界面上看一眼确认。

## 已知限制

- 只有计时与打卡，不做前台窗口/应用监控（不读取系统权限）。
- 数据存在当前浏览器的 localStorage：换浏览器或清站点数据会丢。
- 跨机是**手动**：靠导出/导入文件或同步码；没有后台自动同步（DSH 目前不提供插件可用的账号级云存储）。
- 浏览器端最终视觉效果需在页面里看一眼确认（本会话无法截图或控制浏览器）。
