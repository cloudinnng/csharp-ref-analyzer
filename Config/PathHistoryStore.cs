using System.Text.Json;

namespace CsharpRefAnalyzer.Config;

/// <summary>最近分析文件夹路径 — 服务端 JSON 持久化，跨浏览器/用户共享</summary>
public sealed class PathHistoryStore
{
    public const int MaxCount = 10;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly object _lock = new();
    private readonly string _filePath;

    /// <summary>默认存储于应用目录 data/path-history.json</summary>
    public PathHistoryStore()
        : this(Path.Combine(AppContext.BaseDirectory, "data", "path-history.json"))
    {
    }

    /// <summary>ponytail: 自检时可注入临时文件路径</summary>
    internal PathHistoryStore(string filePath)
    {
        _filePath = filePath;
    }

    #region 公开 API

    /// <summary>读取已保存路径列表（最近使用的在最前）</summary>
    public IReadOnlyList<string> GetPaths()
    {
        lock (_lock)
        {
            return LoadPathsLocked();
        }
    }

    /// <summary>新增或置顶一条路径并持久化</summary>
    public IReadOnlyList<string> AddPath(string folderPath)
    {
        string normalized = NormalizePath(folderPath);
        if (normalized.Length == 0)
        {
            return GetPaths();
        }

        lock (_lock)
        {
            List<string> paths = LoadPathsLocked();
            paths.RemoveAll(p => PathsEqual(p, normalized));
            paths.Insert(0, normalized);

            if (paths.Count > MaxCount)
            {
                paths = paths.Take(MaxCount).ToList();
            }

            SavePathsLocked(paths);
            Console.WriteLine($"[PathHistory] 已保存路径: {normalized} (共 {paths.Count} 条)");
            return paths.AsReadOnly();
        }
    }

    /// <summary>移除一条路径并持久化</summary>
    public IReadOnlyList<string> RemovePath(string folderPath)
    {
        string normalized = NormalizePath(folderPath);
        if (normalized.Length == 0)
        {
            return GetPaths();
        }

        lock (_lock)
        {
            List<string> paths = LoadPathsLocked();
            int removed = paths.RemoveAll(p => PathsEqual(p, normalized));
            if (removed > 0)
            {
                SavePathsLocked(paths);
                Console.WriteLine($"[PathHistory] 已移除路径: {normalized} (剩余 {paths.Count} 条)");
            }

            return paths.AsReadOnly();
        }
    }

    #endregion

    #region 路径比较

    /// <summary>Windows 路径比较忽略大小写与斜杠方向</summary>
    internal static bool PathsEqual(string a, string b)
    {
        return string.Equals(NormalizeForCompare(a), NormalizeForCompare(b), StringComparison.Ordinal);
    }

    private static string NormalizePath(string path) => path.Trim();

    private static string NormalizeForCompare(string path)
    {
        return path.Trim().Replace('/', '\\').ToLowerInvariant();
    }

    #endregion

    #region 文件读写

    private List<string> LoadPathsLocked()
    {
        if (!File.Exists(_filePath))
        {
            return [];
        }

        try
        {
            string json = File.ReadAllText(_filePath);
            List<string>? parsed = JsonSerializer.Deserialize<List<string>>(json);
            if (parsed is null)
            {
                return [];
            }

            return parsed
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(NormalizePath)
                .DistinctBy(NormalizeForCompare)
                .Take(MaxCount)
                .ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[PathHistory] 读取配置失败，将重建: {ex.Message}");
            return [];
        }
    }

    private void SavePathsLocked(List<string> paths)
    {
        string? dir = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        string json = JsonSerializer.Serialize(paths, JsonOptions);
        string tempPath = _filePath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _filePath, overwrite: true);
    }

    #endregion

    #region 自检

    /// <summary>ponytail: 临时目录集成自检，验证增删与 MaxCount</summary>
    internal static bool RunSelfCheck()
    {
        string tempDir = Path.Combine(Path.GetTempPath(), "csharp-ref-analyzer-path-history-" + Guid.NewGuid().ToString("N"));
        string tempFile = Path.Combine(tempDir, "path-history.json");
        bool ok = true;

        try
        {
            Directory.CreateDirectory(tempDir);
            PathHistoryStore store = new(tempFile);

            ok &= Assert(store.GetPaths().Count == 0, "初始列表为空");

            store.AddPath(@"C:\Projects\Alpha");
            ok &= Assert(store.GetPaths().Count == 1 && store.GetPaths()[0].Contains("Alpha"),
                "Add 后含 Alpha");

            store.AddPath(@"C:\Projects\Beta");
            ok &= Assert(store.GetPaths()[0].Contains("Beta") && store.GetPaths()[1].Contains("Alpha"),
                "新路径置顶");

            store.AddPath(@"c:/projects/alpha");
            ok &= Assert(store.GetPaths().Count == 2 && store.GetPaths()[0].Contains("alpha"),
                "重复路径去重并置顶（大小写/斜杠）");

            store.RemovePath(@"C:\Projects\Beta");
            ok &= Assert(store.GetPaths().Count == 1 && !store.GetPaths().Any(p => p.Contains("Beta")),
                "Remove 生效");

            for (int i = 0; i < MaxCount + 3; i++)
            {
                store.AddPath($@"C:\Temp\Path{i}");
            }

            ok &= Assert(store.GetPaths().Count == MaxCount, $"超过 MaxCount 截断为 {MaxCount}");

            // 重启模拟：新实例读同一文件
            PathHistoryStore reloaded = new(tempFile);
            ok &= Assert(reloaded.GetPaths().Count == MaxCount, "持久化后重载条数一致");
            ok &= Assert(File.Exists(tempFile), "配置文件已写入磁盘");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[PathHistory SelfCheck] 异常: {ex}");
            ok = false;
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, recursive: true);
                }
            }
            catch
            {
                // ponytail: 临时目录清理失败不影响自检结论
            }
        }

        Console.WriteLine(ok ? "[PathHistory SelfCheck] 通过" : "[PathHistory SelfCheck] 失败");
        return ok;
    }

    private static bool Assert(bool condition, string message)
    {
        if (!condition)
        {
            Console.WriteLine($"[PathHistory SelfCheck] FAIL: {message}");
        }
        else
        {
            Console.WriteLine($"[PathHistory SelfCheck] OK: {message}");
        }

        return condition;
    }

    #endregion
}
