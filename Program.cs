using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using CsharpRefAnalyzer.Analysis;
using CsharpRefAnalyzer.Config;
using CsharpRefAnalyzer.Models;

namespace CsharpRefAnalyzer;

public static class Program
{
    private const int Port = 8780;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static async Task Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        if (args.Length >= 2 && args[0] == "--self-check")
        {
            int exitCode = RunSelfCheck(args[1]);
            Environment.Exit(exitCode);
            return;
        }

        WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
        builder.Services.AddSingleton<PathHistoryStore>();
        WebApplication app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = ctx =>
            {
                // ponytail: 避免各 origin 缓存旧版 app.js（曾用 Cookie 存路径历史）
                string name = ctx.File.Name;
                if (name is "app.js" or "index.html")
                {
                    IHeaderDictionary headers = ctx.Context.Response.Headers;
                    headers.CacheControl = "no-cache, no-store, must-revalidate";
                    headers.Pragma = "no-cache";
                    headers.Expires = "0";
                }
            }
        });

        #region API

        app.MapPost("/api/analyze", (AnalyzeRequest request, PathHistoryStore pathHistory) =>
        {
            Console.WriteLine($"[API] POST /api/analyze folderPath={request.FolderPath}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            try
            {
                AnalysisResultDto result = AnalyzeFolder(request.FolderPath);
                pathHistory.AddPath(request.FolderPath);
                return Results.Json(result, JsonOptions);
            }
            catch (DirectoryNotFoundException ex)
            {
                Console.WriteLine($"[API] 目录不存在: {ex.Message}");
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[API] 分析失败: {ex}");
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        app.MapPost("/api/snippet", (SnippetRequest request) =>
        {
            Console.WriteLine($"[API] POST /api/snippet file={request.FilePath} line={request.Line}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            if (string.IsNullOrWhiteSpace(request.FilePath))
            {
                return Results.BadRequest(new { error = "filePath 不能为空" });
            }

            if (request.Line < 1)
            {
                return Results.BadRequest(new { error = "line 必须 >= 1" });
            }

            try
            {
                SnippetResultDto snippet = SourceSnippetReader.ReadSnippet(
                    request.FolderPath,
                    request.FilePath,
                    request.Line,
                    request.ContextLines,
                    request.HighlightLines);
                return Results.Json(snippet, JsonOptions);
            }
            catch (DirectoryNotFoundException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (FileNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[API] 读取片段失败: {ex}");
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        app.MapPost("/api/class-source", (ClassSourceRequest request) =>
        {
            Console.WriteLine(
                $"[API] POST /api/class-source file={request.FilePath} line={request.Line} type={request.TypeName}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            if (string.IsNullOrWhiteSpace(request.FilePath))
            {
                return Results.BadRequest(new { error = "filePath 不能为空" });
            }

            if (request.Line < 1)
            {
                return Results.BadRequest(new { error = "line 必须 >= 1" });
            }

            try
            {
                ClassSourceResultDto source = SourceClassReader.ReadClassSource(
                    request.FolderPath,
                    request.FilePath,
                    request.Line,
                    request.TypeName);
                return Results.Json(source, JsonOptions);
            }
            catch (DirectoryNotFoundException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (FileNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[API] 读取类型源码失败: {ex}");
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        app.MapPost("/api/class-outline", (ClassOutlineRequest request) =>
        {
            Console.WriteLine(
                $"[API] POST /api/class-outline file={request.FilePath} line={request.Line} type={request.TypeName}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            if (string.IsNullOrWhiteSpace(request.FilePath))
            {
                return Results.BadRequest(new { error = "filePath 不能为空" });
            }

            if (request.Line < 1)
            {
                return Results.BadRequest(new { error = "line 必须 >= 1" });
            }

            try
            {
                ClassOutlineResultDto outline = ClassOutlineReader.ReadClassOutline(
                    request.FolderPath,
                    request.FilePath,
                    request.Line,
                    request.TypeName);
                return Results.Json(outline, JsonOptions);
            }
            catch (DirectoryNotFoundException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (FileNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[API] 读取类型大纲失败: {ex}");
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        app.MapGet("/api/path-history", (PathHistoryStore pathHistory) =>
        {
            Console.WriteLine("[API] GET /api/path-history");
            IReadOnlyList<string> paths = pathHistory.GetPaths();
            return Results.Json(new PathHistoryDto { Paths = paths.ToList() }, JsonOptions);
        });

        app.MapPost("/api/path-history", (PathHistoryRequest request, PathHistoryStore pathHistory) =>
        {
            Console.WriteLine($"[API] POST /api/path-history folderPath={request.FolderPath}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            IReadOnlyList<string> paths = pathHistory.AddPath(request.FolderPath);
            return Results.Json(new PathHistoryDto { Paths = paths.ToList() }, JsonOptions);
        });

        app.MapDelete("/api/path-history", ([FromBody] PathHistoryRequest request, PathHistoryStore pathHistory) =>
        {
            Console.WriteLine($"[API] DELETE /api/path-history folderPath={request.FolderPath}");

            if (string.IsNullOrWhiteSpace(request.FolderPath))
            {
                return Results.BadRequest(new { error = "folderPath 不能为空" });
            }

            IReadOnlyList<string> paths = pathHistory.RemovePath(request.FolderPath);
            return Results.Json(new PathHistoryDto { Paths = paths.ToList() }, JsonOptions);
        });

        #endregion

        PrintStartupUrls(Port);
        await app.RunAsync($"http://0.0.0.0:{Port}");
    }

    /// <summary>启动后打印本机与局域网访问地址</summary>
    private static void PrintStartupUrls(int port)
    {
        Console.WriteLine($"[Host] C# 引用分析工具已启动 (监听 0.0.0.0:{port})");
        Console.WriteLine($"[Host] 本机: http://127.0.0.1:{port}");

        IEnumerable<string> lanIps = NetworkInterface.GetAllNetworkInterfaces()
            .Where(ni => ni.OperationalStatus == OperationalStatus.Up
                         && ni.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .SelectMany(ni => ni.GetIPProperties().UnicastAddresses)
            .Where(ua => ua.Address.AddressFamily == AddressFamily.InterNetwork
                         && !IPAddress.IsLoopback(ua.Address))
            .Select(ua => ua.Address.ToString())
            .Distinct()
            .OrderBy(ip => ip);

        foreach (string ip in lanIps)
        {
            Console.WriteLine($"[Host] 局域网: http://{ip}:{port}");
        }

        if (OperatingSystem.IsWindows())
        {
            Console.WriteLine(
                "[Host] 若局域网其他设备无法访问，请以管理员运行: scripts/open-firewall.ps1");
        }
    }

    #region 分析编排

    /// <summary>执行完整分析流程</summary>
    public static AnalysisResultDto AnalyzeFolder(string folderPath)
    {
        ReferenceGraphBuilder.GraphResult graph = ReferenceGraphBuilder.Build(folderPath);
        (List<LayerDto> layers, List<List<string>> cycles) =
            HierarchyComposer.ComposeLayers(graph.Classes, graph.References);

        return new AnalysisResultDto
        {
            RootPath = graph.RootPath,
            FilesScanned = graph.FilesScanned,
            Classes = graph.Classes.Values.OrderBy(c => c.Id, StringComparer.Ordinal).ToList(),
            References = graph.References,
            Layers = layers,
            Cycles = cycles,
            Errors = graph.Errors
        };
    }

    #endregion

    #region 自测

    /// <summary>ponytail: samples 目录集成自检，覆盖引用图 / 分层 / 环 / Sites / Snippet 边沿情况</summary>
    private static int RunSelfCheck(string samplesPath)
    {
        string fullPath = Path.GetFullPath(samplesPath);
        Console.WriteLine($"[SelfCheck] 分析样例目录: {fullPath}");

        AnalysisResultDto result = AnalyzeFolder(fullPath);
        bool ok = true;

        ok &= Assert(result.FilesScanned >= 15, $"扫描文件 >= 15 (实际 {result.FilesScanned})");
        ok &= Assert(result.Classes.Count >= 20, $"类型数量 >= 20 (实际 {result.Classes.Count})");
        ok &= Assert(result.References.Count >= 15, $"引用边 >= 15 (实际 {result.References.Count})");
        ok &= Assert(result.Layers.Count >= 3, $"A→B→C 链至少 3 层 (实际 {result.Layers.Count})");
        ok &= Assert(result.Cycles.Count >= 1, $"环 >= 1 (实际 {result.Cycles.Count})");

        ok &= RunChainTests(result);
        ok &= RunCycleTests(result);
        ok &= RunKindRegistrationTests(result);
        ok &= RunReferenceKindTests(result);
        ok &= RunSitesTests(result);
        ok &= RunCallPatternTests(result);
        ok &= RunDeclarationTests(result);
        ok &= RunTypeShapeTests(result);
        ok &= RunFilterTests(result);
        ok &= RunNestedNamespaceTests(result);
        ok &= RunThisReceiverTests(result);
        ok &= RunSnippetTests(fullPath);
        ok &= RunClassSourceTests(fullPath);
        ok &= RunClassOutlineTests(fullPath);
        ok &= PathHistoryStore.RunSelfCheck();

        Console.WriteLine(ok ? "[SelfCheck] 通过" : "[SelfCheck] 失败");
        return ok ? 0 : 1;
    }

    /// <summary>AppRunner→Human→Animal 引用链与调用树</summary>
    private static bool RunChainTests(AnalysisResultDto result)
    {
        bool ok = true;
        ClassNodeDto? appRunner = FindClass(result, "AppRunner");
        ok &= Assert(appRunner is not null, "找到 AppRunner");

        if (appRunner is not null)
        {
            HierarchyComposer.TreeNode tree = HierarchyComposer.BuildCallTree(appRunner.Id, result.References);
            List<string> treeIds = FlattenTree(tree).Distinct().ToList();
            ok &= Assert(treeIds.Any(id => id.Contains("Human")), "AppRunner 调用树应包含 Human");
            ok &= Assert(
                treeIds.Any(id => id.Contains("Animal")) ||
                result.References.Any(r => r.FromId.Contains("Human") && r.ToId.Contains("Animal")),
                "引用链应包含 Human -> Animal");
        }

        ok &= Assert(HasEdge(result, "Human", "Animal", ReferenceKind.Extends),
            "Human 继承 Animal (Extends)");
        ok &= Assert(CountSitesBetween(result, "AppRunner", "Human") >= 2,
            $"AppRunner->Human 至少 2 处引用 (实际 {CountSitesBetween(result, "AppRunner", "Human")})");

        ClassNodeDto? human = FindClass(result, "Human");
        if (human is not null)
        {
            int incomingToHuman = result.References.Count(r => r.ToId == human.Id);
            ok &= Assert(incomingToHuman >= 2,
                $"Human 至少 2 个直接引用方 (实际 {incomingToHuman})");
        }

        return ok;
    }

    /// <summary>循环依赖检测</summary>
    private static bool RunCycleTests(AnalysisResultDto result)
    {
        HashSet<string> cycleNames = result.Cycles
            .SelectMany(c => c)
            .Select(id => id.Split('.').Last())
            .ToHashSet(StringComparer.Ordinal);

        bool ok = Assert(cycleNames.Contains("PeerOne") && cycleNames.Contains("PeerTwo"),
            "环应包含 PeerOne 与 PeerTwo");

        ClassNodeDto? peerOne = FindClass(result, "PeerOne");
        if (peerOne is not null)
        {
            ok &= Assert(peerOne.InCycle, "PeerOne 应标记 InCycle");
        }

        return ok;
    }

    /// <summary>interface / struct / record / enum 注册</summary>
    private static bool RunKindRegistrationTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(FindClass(result, "IWorker")?.Kind == TypeKind.Interface, "IWorker 为 Interface");
        ok &= Assert(FindClass(result, "PointBox")?.Kind == TypeKind.Struct, "PointBox 为 Struct");
        ok &= Assert(FindClass(result, "PayloadRecord")?.Kind == TypeKind.Record, "PayloadRecord 为 Record");
        ok &= Assert(FindClass(result, "WorkMode")?.Kind == TypeKind.Enum, "WorkMode 为 Enum");
        ok &= Assert(FindClass(result, "KindConsumer")?.Kind == TypeKind.Class, "KindConsumer 为 Class");
        return ok;
    }

    /// <summary>Extends / Uses / Calls 边种类</summary>
    private static bool RunReferenceKindTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(HasEdge(result, "TaskRunnerImpl", "ITaskRunner", ReferenceKind.Extends),
            "TaskRunnerImpl 实现 ITaskRunner (BaseList→Extends)");
        ok &= Assert(HasEdge(result, "KindConsumer", "IWorker", ReferenceKind.Extends),
            "KindConsumer 实现 IWorker");
        ok &= Assert(HasEdge(result, "StaticCaller", "Animal", ReferenceKind.Calls),
            "StaticCaller 静态调用 Animal");
        ok &= Assert(HasEdge(result, "KindConsumer", "AppRunner", ReferenceKind.Calls),
            "KindConsumer 内 new AppRunner (Calls)");
        return ok;
    }

    /// <summary>Sites 多行号收集（instance 成员赋值等）</summary>
    private static bool RunSitesTests(AnalysisResultDto result)
    {
        bool ok = true;
        int binderToHuman = CountSitesBetween(result, "HumanEventBinder", "Human");
        ok &= Assert(binderToHuman >= 4, $"HumanEventBinder->Human 至少 4 处 instance 成员引用 (实际 {binderToHuman})");

        int multiSite = CountSitesBetween(result, "MultiSite", "Human");
        ok &= Assert(multiSite >= 3, $"MultiSite->Human 至少 3 处引用 (实际 {multiSite})");

        ReferenceEdgeDto? anyWithMultiSites = result.References
            .FirstOrDefault(r => r.Sites.Count >= 2);
        ok &= Assert(anyWithMultiSites is not null, "至少一条边 Sites.Count >= 2");
        if (anyWithMultiSites is not null)
        {
            ok &= Assert(anyWithMultiSites.Count >= anyWithMultiSites.Sites.Count,
                $"Count >= Sites.Count ({anyWithMultiSites.Count} >= {anyWithMultiSites.Sites.Count})");
        }

        return ok;
    }

    /// <summary>静态调用、参数 instance 调用、局部变量调用</summary>
    private static bool RunCallPatternTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(CountSitesBetween(result, "ParamCaller", "Human") >= 2,
            $"ParamCaller->Human 参数调用+成员赋值 (实际 {CountSitesBetween(result, "ParamCaller", "Human")})");
        ok &= Assert(HasEdge(result, "ParamCaller", "Human", ReferenceKind.Calls),
            "ParamCaller 调用 target.DoWork()");
        ok &= Assert(CountSitesBetween(result, "Declarations", "AppRunner") >= 2,
            $"Declarations->AppRunner 参数+调用 (实际 {CountSitesBetween(result, "Declarations", "AppRunner")})");
        ok &= Assert(HasSiteWithMember(result, "ParamArgPass", "Human", "preset"),
            "ParamArgPass 将 preset 作为实参传递 (Uses)");
        ok &= Assert(CountSitesBetween(result, "ParamArgPass", "Human") >= 2,
            $"ParamArgPass->Human 参数声明+实参传递 (实际 {CountSitesBetween(result, "ParamArgPass", "Human")})");
        return ok;
    }

    /// <summary>属性/返回类型/参数/event/多字段声明</summary>
    private static bool RunDeclarationTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(HasEdge(result, "Declarations", "Human", ReferenceKind.Uses),
            "Declarations 属性类型 Human");
        ok &= Assert(HasEdge(result, "Declarations", "Animal", ReferenceKind.Uses),
            "Declarations 返回类型 Animal");
        ok &= Assert(CountSitesBetween(result, "Declarations", "Human") >= 2,
            $"Declarations->Human 属性+双字段 (实际 {CountSitesBetween(result, "Declarations", "Human")})");
        return ok;
    }

    /// <summary>nullable / 数组 / 泛型容器</summary>
    private static bool RunTypeShapeTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(HasEdge(result, "TypeShapes", "Animal", ReferenceKind.Uses),
            "TypeShapes nullable Animal? 字段");
        ok &= Assert(HasEdge(result, "TypeShapes", "AppRunner", ReferenceKind.Uses),
            "TypeShapes AppRunner[] 数组元素类型");
        ok &= Assert(CountSitesBetween(result, "TypeShapes", "Animal") >= 2,
            $"TypeShapes->Animal 字段+调用 (实际 {CountSitesBetween(result, "TypeShapes", "Animal")})");
        ok &= Assert(CountSitesBetween(result, "TypeShapes", "AppRunner") >= 2,
            $"TypeShapes->AppRunner 数组+foreach 调用 (实际 {CountSitesBetween(result, "TypeShapes", "AppRunner")})");
        // ponytail: 语法级仅解析 GenericName 标识符 List，不展开 Human 类型参数
        ok &= Assert(!HasEdge(result, "TypeShapes", "Human"),
            "List<Human> 不应产生 TypeShapes->Human 边（已知限制）");
        return ok;
    }

    /// <summary>外部类型过滤、自环过滤</summary>
    private static bool RunFilterTests(AnalysisResultDto result)
    {
        bool ok = true;
        ClassNodeDto? filterCases = FindClass(result, "FilterCases");
        if (filterCases is not null)
        {
            ok &= Assert(
                !result.References.Any(r =>
                    r.FromId == filterCases.Id &&
                    (r.ToId.Contains("String", StringComparison.Ordinal) ||
                     r.ToId.Contains("System", StringComparison.Ordinal))),
                "FilterCases 不因 string 字段产生外部类型边");
            ok &= Assert(
                !result.References.Any(r => r.FromId == filterCases.Id && r.ToId == filterCases.Id),
                "FilterCases 不产生自环");
        }

        return ok;
    }

    /// <summary>嵌套命名空间 + 完全限定名引用</summary>
    private static bool RunNestedNamespaceTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(FindClass(result, "NestedUser") is not null, "找到 NestedUser (SampleApp.Sub)");
        ok &= Assert(CountSitesBetween(result, "NestedUser", "AppRunner") >= 2,
            $"NestedUser->AppRunner 字段+局部+调用 (实际 {CountSitesBetween(result, "NestedUser", "AppRunner")})");
        return ok;
    }

    /// <summary>this._field 形式的 instance 调用与成员访问</summary>
    private static bool RunThisReceiverTests(AnalysisResultDto result)
    {
        bool ok = true;
        ok &= Assert(HasEdge(result, "ThisReceiverUser", "Human", ReferenceKind.Calls),
            "ThisReceiverUser this._target.DoWork() (Calls)");
        ok &= Assert(CountSitesBetween(result, "ThisReceiverUser", "Human") >= 4,
            $"ThisReceiverUser->Human 字段+this 调用+成员赋值 (实际 {CountSitesBetween(result, "ThisReceiverUser", "Human")})");
        return ok;
    }

    /// <summary>SourceSnippetReader 正常读取与路径穿越拒绝</summary>
    private static bool RunSnippetTests(string samplesRoot)
    {
        bool ok = true;

        try
        {
            SnippetResultDto snippet = SourceSnippetReader.ReadSnippet(
                samplesRoot, "AppRunner.cs", 8, contextLines: 2);
            string joined = string.Join('\n', snippet.Lines.Select(l => l.Text));
            ok &= Assert(joined.Contains("Human"), "AppRunner.cs 第 8 行上下文应包含 Human");
            ok &= Assert(snippet.Lines.Any(l => l.Highlight && l.Number == 8),
                "高亮行应为第 8 行");

            SnippetResultDto multi = SourceSnippetReader.ReadSnippet(
                samplesRoot, "HumanEventBinder.cs", 10, contextLines: 2, highlightLines: [10, 11, 12, 13]);
            ok &= Assert(multi.Lines.Count(l => l.Highlight) == 4,
                $"HumanEventBinder 4 行合并高亮 (实际 {multi.Lines.Count(l => l.Highlight)})");
            ok &= Assert(multi.Lines.Any(l => l.Number == 10 && l.Highlight), "第 10 行高亮");
            ok &= Assert(multi.Lines.Any(l => l.Number == 13 && l.Highlight), "第 13 行高亮");
        }
        catch (Exception ex)
        {
            ok &= Assert(false, $"SourceSnippetReader 正常读取失败: {ex.Message}");
        }

        try
        {
            SourceSnippetReader.ReadSnippet(samplesRoot, "..\\..\\Program.cs", 1);
            ok &= Assert(false, "路径穿越应被拒绝");
        }
        catch (UnauthorizedAccessException)
        {
            ok &= Assert(true, "路径穿越被拒绝");
        }
        catch (Exception ex)
        {
            ok &= Assert(false, $"路径穿越应抛 UnauthorizedAccessException，实际: {ex.GetType().Name}");
        }

        return ok;
    }

    /// <summary>SourceClassReader 读取类型完整定义</summary>
    private static bool RunClassSourceTests(string samplesRoot)
    {
        bool ok = true;

        try
        {
            ClassSourceResultDto appRunner = SourceClassReader.ReadClassSource(
                samplesRoot, "AppRunner.cs", 4, "AppRunner");
            string joined = string.Join('\n', appRunner.Lines.Select(l => l.Text));
            ok &= Assert(appRunner.TypeName == "AppRunner", "AppRunner 类型名");
            ok &= Assert(appRunner.StartLine == 4, $"AppRunner 起始行=4 (实际 {appRunner.StartLine})");
            ok &= Assert(appRunner.Lines.Count >= 11, $"AppRunner 整文件至少 11 行 (实际 {appRunner.Lines.Count})");
            ok &= Assert(appRunner.Lines[0].Number == 1, "AppRunner 从第 1 行开始");
            ok &= Assert(joined.Contains("void Run"), "AppRunner 源码含 Run 方法");
            ok &= Assert(appRunner.Lines.Any(l => l.Number < appRunner.StartLine && !l.Highlight),
                "AppRunner 上方应有非高亮上下文（namespace 等）");
            ok &= Assert(
                appRunner.Lines
                    .Where(l => l.Number >= appRunner.StartLine && l.Number <= appRunner.EndLine)
                    .All(l => l.Highlight),
                "AppRunner 类型定义行全部高亮");

            ClassSourceResultDto human = SourceClassReader.ReadClassSource(
                samplesRoot, "Human.cs", 4, "Human");
            ok &= Assert(human.Lines.Any(l => l.Text.Contains("DoWork")), "Human 源码含 DoWork");
        }
        catch (Exception ex)
        {
            ok &= Assert(false, $"SourceClassReader 失败: {ex.Message}");
        }

        return ok;
    }

    /// <summary>ClassOutlineReader 成员提取与输入/输出分类</summary>
    private static bool RunClassOutlineTests(string samplesRoot)
    {
        bool ok = true;

        try
        {
            ClassOutlineResultDto outline = ClassOutlineReader.ReadClassOutline(
                samplesRoot, "OutlineCases.cs", 4, "OutlineCases");

            ok &= Assert(outline.TypeName == "OutlineCases", "OutlineCases 类型名");
            ok &= Assert(outline.Kind == TypeKind.Class, "OutlineCases 为 Class");
            ok &= Assert(outline.Members.Count >= 8,
                $"OutlineCases 至少 8 个成员 (实际 {outline.Members.Count})");

            MemberDto? hidden = outline.Members.FirstOrDefault(m => m.Name == "_hidden");
            ok &= Assert(hidden is not null && hidden.Access == AccessLevel.Private,
                "_hidden 为 private 字段");
            ok &= Assert(hidden?.Io == IoDirection.None, "_hidden 不参与 IO 分类");

            MemberDto? readOnlyProp = outline.Members.FirstOrDefault(m => m.Name == "ReadOnlyProp");
            ok &= Assert(readOnlyProp?.Io == IoDirection.Output, "ReadOnlyProp 为输出");

            MemberDto? writableProp = outline.Members.FirstOrDefault(m => m.Name == "WritableProp");
            ok &= Assert(writableProp?.Io == IoDirection.Input, "WritableProp 为输入");

            ok &= Assert(outline.Inputs.Any(i => i.Name == "seed" && i.Kind == MemberKind.Constructor && i.Source == "构造参数"),
                "构造参数 seed 为输入");
            ok &= Assert(outline.Inputs.Any(i => i.Name == "count" && i.Kind == MemberKind.Constructor && i.Source == "构造参数"),
                "构造参数 count 为输入");
            ok &= Assert(outline.Inputs.Any(i => i.Name == "WritableProp" && i.Kind == MemberKind.Property && i.Source == "set"),
                "WritableProp 为输入端口");
            ok &= Assert(outline.Inputs.Any(i => i.Name == "WritableField" && i.Kind == MemberKind.Field && i.Source == "可写字段"),
                "WritableField 为输入端口");

            ok &= Assert(outline.Outputs.Any(o => o.Name == "ReadOnlyProp" && o.Kind == MemberKind.Property && o.Source == "get"),
                "ReadOnlyProp 为输出端口");
            ok &= Assert(outline.Outputs.Any(o => o.Name == "ReadOnlyField" && o.Kind == MemberKind.Field && o.Source == "readonly"),
                "ReadOnlyField 为输出端口");
            ok &= Assert(outline.Outputs.Any(o => o.Name == "Compute" && o.Kind == MemberKind.Method && o.Source == "返回值"),
                "Compute 返回值为输出端口");
            ok &= Assert(outline.Outputs.Any(o => o.Name == "OnChanged" && o.Kind == MemberKind.Event && o.Source == "event"),
                "OnChanged event 为输出端口");

            ok &= Assert(!outline.Inputs.Any(i => i.Name == "_hidden"), "私有字段不在输入清单");
            ok &= Assert(!outline.Outputs.Any(o => o.Name == "_hidden"), "私有字段不在输出清单");
        }
        catch (Exception ex)
        {
            ok &= Assert(false, $"ClassOutlineReader 失败: {ex.Message}");
        }

        return ok;
    }

    private static ClassNodeDto? FindClass(AnalysisResultDto result, string simpleName) =>
        result.Classes.FirstOrDefault(c => c.Name == simpleName);

    private static bool HasEdge(
        AnalysisResultDto result,
        string fromName,
        string toName,
        ReferenceKind? kind = null)
    {
        return result.References.Any(r =>
            r.FromId.Contains(fromName, StringComparison.Ordinal) &&
            r.ToId.Contains(toName, StringComparison.Ordinal) &&
            (kind is null || r.Kind == kind));
    }

    private static int CountSitesBetween(AnalysisResultDto result, string fromName, string toName) =>
        result.References
            .Where(r =>
                r.FromId.Contains(fromName, StringComparison.Ordinal) &&
                r.ToId.Contains(toName, StringComparison.Ordinal))
            .Sum(r => r.Sites.Count);

    private static bool HasSiteWithMember(
        AnalysisResultDto result,
        string fromName,
        string toName,
        string memberName) =>
        result.References
            .Where(r =>
                r.FromId.Contains(fromName, StringComparison.Ordinal) &&
                r.ToId.Contains(toName, StringComparison.Ordinal))
            .SelectMany(r => r.Sites)
            .Any(s => string.Equals(s.MemberName, memberName, StringComparison.Ordinal));

    private static bool Assert(bool condition, string message)
    {
        if (!condition)
        {
            Console.WriteLine($"[SelfCheck] FAIL: {message}");
        }
        else
        {
            Console.WriteLine($"[SelfCheck] OK: {message}");
        }

        return condition;
    }

    private static IEnumerable<string> FlattenTree(HierarchyComposer.TreeNode node)
    {
        yield return node.ClassId;
        foreach (HierarchyComposer.TreeNode child in node.Children)
        {
            foreach (string id in FlattenTree(child))
            {
                yield return id;
            }
        }
    }

    #endregion
}
