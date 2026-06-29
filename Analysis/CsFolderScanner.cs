using System.Reflection;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>递归扫描文件夹中的 .cs 文件并构建 Roslyn Compilation</summary>
public static class CsFolderScanner
{
    private static readonly HashSet<string> SkipDirNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "bin", "obj", ".git", ".vs", "node_modules"
    };

    /// <summary>扫描结果：语法树列表 + 源文件路径</summary>
    public sealed class ScanResult
    {
        public required string RootPath { get; init; }
        public required IReadOnlyList<SyntaxTree> SyntaxTrees { get; init; }
        public required IReadOnlyList<string> FilePaths { get; init; }
    }

    #region 扫描

    /// <summary>递归枚举文件夹下所有 .cs 文件（跳过 bin/obj 等噪声目录）</summary>
    public static ScanResult Scan(string folderPath)
    {
        string root = Path.GetFullPath(folderPath);
        if (!Directory.Exists(root))
        {
            throw new DirectoryNotFoundException($"文件夹不存在: {root}");
        }

        Console.WriteLine($"[Scanner] 开始扫描: {root}");

        List<string> filePaths = [];
        CollectCsFiles(root, root, filePaths);
        filePaths.Sort(StringComparer.OrdinalIgnoreCase);

        Console.WriteLine($"[Scanner] 找到 {filePaths.Count} 个 .cs 文件");

        List<SyntaxTree> trees = [];
        foreach (string filePath in filePaths)
        {
            string text = File.ReadAllText(filePath, Encoding.UTF8);
            SyntaxTree tree = CSharpSyntaxTree.ParseText(
                text,
                path: filePath,
                encoding: Encoding.UTF8,
                options: CSharpParseOptions.Default.WithLanguageVersion(LanguageVersion.CSharp12));
            trees.Add(tree);
        }

        return new ScanResult
        {
            RootPath = root,
            SyntaxTrees = trees,
            FilePaths = filePaths
        };
    }

    private static void CollectCsFiles(string root, string current, List<string> filePaths)
    {
        foreach (string file in Directory.EnumerateFiles(current, "*.cs"))
        {
            filePaths.Add(Path.GetFullPath(file));
        }

        foreach (string dir in Directory.EnumerateDirectories(current))
        {
            string dirName = Path.GetFileName(dir);
            if (SkipDirNames.Contains(dirName))
            {
                Console.WriteLine($"[Scanner] 跳过目录: {dirName}");
                continue;
            }

            CollectCsFiles(root, dir, filePaths);
        }
    }

    #endregion

    #region Compilation

    /// <summary>基于扫描到的语法树构建 ad-hoc Compilation（ponytail: 散落 .cs，无 csproj）</summary>
    public static CSharpCompilation BuildCompilation(ScanResult scan)
    {
        MetadataReference[] refs = GetBasicReferences();
        Console.WriteLine($"[Scanner] 加载 {refs.Length} 个 BCL 程序集引用");

        return CSharpCompilation.Create(
            assemblyName: "CsharpRefAnalyzer.AdHoc",
            syntaxTrees: scan.SyntaxTrees,
            references: refs,
            options: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
    }

    /// <summary>加载最少 BCL 引用（ponytail: 散落 .cs 够用即可，避免 173 个 DLL 拖慢 Unity 大目录）</summary>
    private static MetadataReference[] GetBasicReferences()
    {
        HashSet<string> seen = new(StringComparer.OrdinalIgnoreCase);
        List<MetadataReference> refs = [];

        void AddAssembly(Assembly assembly)
        {
            if (string.IsNullOrEmpty(assembly.Location))
            {
                return;
            }

            if (seen.Add(assembly.Location))
            {
                refs.Add(MetadataReference.CreateFromFile(assembly.Location));
            }
        }

        AddAssembly(typeof(object).Assembly);
        AddAssembly(typeof(Enumerable).Assembly);
        AddAssembly(typeof(List<>).Assembly);
        AddAssembly(typeof(System.IO.File).Assembly);
        AddAssembly(typeof(System.Threading.Tasks.Task).Assembly);

        return refs.ToArray();
    }

    #endregion
}
