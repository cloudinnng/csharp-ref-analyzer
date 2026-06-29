# C# 引用分析工具

本地 Web 工具：递归扫描文件夹内 `.cs` 文件，分析**该文件夹内类型之间**的引用关系，按调用层级展示，点击类可展开向下调用树。

## 环境

- [.NET 10 SDK](https://dotnet.microsoft.com/download)（或兼容的运行时）

## 启动

```powershell
cd csharp-ref-analyzer
dotnet run
```

或在 VS Code / Cursor 中：运行与调试 → 选择 **「C# 引用分析工具」** → 按 **F5**（会自动编译并打开浏览器）。

浏览器打开：

- 本机：http://127.0.0.1:8780
- 局域网：启动后控制台会打印 `http://<本机局域网IP>:8780`，同网段设备可用该地址访问

### 局域网其他设备无法访问？

服务已监听 `0.0.0.0:8780`，本机能用 `192.168.x.x:8780` 但手机/同事电脑打不开，**通常是 Windows 防火墙拦了入站**。

在**管理员 PowerShell** 中执行（只需一次）：

```powershell
cd csharp-ref-analyzer
.\scripts\open-firewall.ps1
```

仍不通时检查：

- 访问端与运行服务的电脑是否同一网段（如都是 `192.168.110.x`）
- 路由器是否开启了「AP 隔离 / 访客网络隔离」
- 公司网络是否禁止设备互访

在输入框填入**运行服务的机器上的绝对路径**（例如 `C:\Projects\MyApp\Src`），点击「分析」。

## 自测

```powershell
dotnet run -- --self-check samples
```

`samples/` 目录为集成测试夹具（不参与 Web 项目编译），各文件覆盖：

| 文件 | 覆盖场景 |
|------|----------|
| `AppRunner.cs` / `Human.cs` / `Animal.cs` | 引用链 AppRunner→Human→Animal、继承、局部变量 + instance 调用、`new` |
| `HumanEventBinder.cs` | 字段上的 instance 成员赋值（事件/委托，多 Sites） |
| `EdgeSites.cs` | 同一 from→to 多条引用行号 |
| `EdgeCalls.cs` | 静态调用 `Animal.Spawn()`、参数 instance 调用 |
| `EdgeDeclarations.cs` | 属性/返回类型/参数/event、多字段声明符 |
| `EdgeTypeShapes.cs` | `T?`、`T[]`；`List<T>` 不展开类型参数（负例） |
| `EdgeKinds.cs` | interface / struct / record / enum 注册与实现 |
| `EdgeFilter.cs` | BCL 类型不产生边、无自环 |
| `EdgeNestedNs.cs` | 嵌套命名空间 + 完全限定名 |
| `Service.cs` | 接口实现 + 跨类调用 |
| `PeerOne.cs` / `PeerTwo.cs` | 循环依赖检测 |

自检还验证 `SourceSnippetReader` 读取与路径穿越拒绝。

## 功能

- 递归扫描 `.cs`（自动跳过 `bin/`、`obj/`）
- 类型图标：类 / 接口 / 结构体 / Record / 枚举
- 引用种类：继承、实现、调用、使用
- 默认分层列表（第 0 层 = 文件夹内无其他类引用的顶层类型）
- 点击类卡片 → 右侧调用树（深度 5，最多 200 节点）；**点击调用树条目** → 弹窗展示类型定义或引用点源码
- 循环依赖检测与标记

## 限制

- 散落 `.cs` 无 `.csproj`：用 ad-hoc Roslyn Compilation，外部 NuGet 类型可能解析失败；只展示双方都在文件夹内的边。
- 路径必须是运行 `dotnet run` 的机器上的本地路径。
- 源码弹窗仅展示已解析的引用点；Unity 外部类型无 in-scope 边则无子节点代码；同 kind 多次引用会列出多个 site。
