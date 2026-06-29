using System.Text;
using CsharpRefAnalyzer.Models;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>从分析根目录内读取 .cs 源码片段（带行号上下文）</summary>
public static class SourceSnippetReader
{
    private const int DefaultContextLines = 3;
    private const int MaxContextLines = 20;

    /// <summary>读取指定行附近的源码片段；highlightLines 非空时合并为一块并多处高亮</summary>
    public static SnippetResultDto ReadSnippet(
        string folderPath,
        string relativeFilePath,
        int line,
        int contextLines = DefaultContextLines,
        IReadOnlyList<int>? highlightLines = null)
    {
        string fullPath = SourceFileGuard.ResolveScopedFile(folderPath, relativeFilePath);
        int ctx = Math.Clamp(contextLines, 0, MaxContextLines);
        string[] allLines = File.ReadAllLines(fullPath, Encoding.UTF8);
        if (allLines.Length == 0)
        {
            return new SnippetResultDto
            {
                FilePath = relativeFilePath.Replace('\\', '/'),
                HighlightLine = Math.Max(1, line),
                Lines = []
            };
        }

        HashSet<int> highlightSet = BuildHighlightSet(line, allLines.Length, highlightLines);
        int rangeMin = highlightSet.Min();
        int rangeMax = highlightSet.Max();
        int start = Math.Max(1, rangeMin - ctx);
        int end = Math.Min(allLines.Length, rangeMax + ctx);

        List<SnippetLineDto> lines = [];
        for (int i = start; i <= end; i++)
        {
            lines.Add(new SnippetLineDto
            {
                Number = i,
                Text = allLines[i - 1],
                Highlight = highlightSet.Contains(i)
            });
        }

        Console.WriteLine(
            $"[Snippet] {relativeFilePath}:{rangeMin}" +
            (highlightSet.Count > 1 ? $"-{rangeMax} ({highlightSet.Count} 处高亮)" : "") +
            $" ({lines.Count} 行上下文)");

        return new SnippetResultDto
        {
            FilePath = relativeFilePath.Replace('\\', '/'),
            HighlightLine = rangeMin,
            Lines = lines
        };
    }

    private static HashSet<int> BuildHighlightSet(int line, int fileLineCount, IReadOnlyList<int>? highlightLines)
    {
        IEnumerable<int> raw = highlightLines is { Count: > 0 }
            ? highlightLines
            : [Math.Max(1, line)];

        HashSet<int> set = [];
        foreach (int n in raw)
        {
            if (n >= 1 && n <= fileLineCount)
            {
                set.Add(n);
            }
        }

        if (set.Count == 0)
        {
            set.Add(Math.Clamp(Math.Max(1, line), 1, fileLineCount));
        }

        return set;
    }
}
