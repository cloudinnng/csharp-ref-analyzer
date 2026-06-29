using System.Text;
using CsharpRefAnalyzer.Models;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>从源文件中提取单个类型定义的完整源码</summary>
public static class SourceClassReader
{
    /// <summary>按定义行号（及可选类型名）读取整文件源码，并标记类型定义行高亮范围</summary>
    public static ClassSourceResultDto ReadClassSource(
        string folderPath,
        string relativeFilePath,
        int line,
        string? typeName = null)
    {
        if (line < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(line), "line 必须 >= 1");
        }

        string fullPath = SourceFileGuard.ResolveScopedFile(folderPath, relativeFilePath);
        string sourceText = File.ReadAllText(fullPath, Encoding.UTF8);
        string[] allLines = sourceText.Split('\n');

        SyntaxTree tree = CSharpSyntaxTree.ParseText(sourceText, path: fullPath);
        CompilationUnitSyntax root = tree.GetCompilationUnitRoot();

        BaseTypeDeclarationSyntax? typeDecl = FindTypeDeclaration(root, line, typeName);
        if (typeDecl is null)
        {
            throw new InvalidOperationException(
                $"未在 {relativeFilePath}:{line} 找到类型定义{(typeName is not null ? $" ({typeName})" : "")}");
        }

        FileLinePositionSpan span = typeDecl.GetLocation().GetLineSpan();
        int startLine = span.StartLinePosition.Line + 1;
        int endLine = span.EndLinePosition.Line + 1;
        string resolvedName = GetTypeName(typeDecl);
        int displayStart = 1;
        int displayEnd = allLines.Length;

        List<SnippetLineDto> lines = [];
        for (int i = displayStart; i <= displayEnd; i++)
        {
            string text = allLines[i - 1];
            if (text.EndsWith('\r'))
            {
                text = text[..^1];
            }

            lines.Add(new SnippetLineDto
            {
                Number = i,
                Text = text,
                Highlight = i >= startLine && i <= endLine
            });
        }

        Console.WriteLine(
            $"[ClassSource] {relativeFilePath} {resolvedName} L{startLine}-{endLine} " +
            $"(整文件 {lines.Count} 行，类型 {endLine - startLine + 1} 行高亮)");

        return new ClassSourceResultDto
        {
            FilePath = relativeFilePath.Replace('\\', '/'),
            TypeName = resolvedName,
            StartLine = startLine,
            EndLine = endLine,
            Lines = lines
        };
    }

    private static BaseTypeDeclarationSyntax? FindTypeDeclaration(
        CompilationUnitSyntax root,
        int line,
        string? typeName)
    {
        BaseTypeDeclarationSyntax? lineMatch = null;
        BaseTypeDeclarationSyntax? nameMatch = null;

        foreach (SyntaxNode node in root.DescendantNodes())
        {
            if (node is not BaseTypeDeclarationSyntax typeDecl)
            {
                continue;
            }

            int declLine = typeDecl.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
            string declName = GetTypeName(typeDecl);

            if (declLine == line)
            {
                if (typeName is null ||
                    string.Equals(declName, typeName, StringComparison.Ordinal))
                {
                    return typeDecl;
                }

                lineMatch = typeDecl;
            }

            if (typeName is not null &&
                string.Equals(declName, typeName, StringComparison.Ordinal))
            {
                nameMatch = typeDecl;
            }
        }

        return lineMatch ?? nameMatch;
    }

    private static string GetTypeName(BaseTypeDeclarationSyntax typeDecl) =>
        typeDecl switch
        {
            ClassDeclarationSyntax c => c.Identifier.Text,
            InterfaceDeclarationSyntax i => i.Identifier.Text,
            StructDeclarationSyntax s => s.Identifier.Text,
            RecordDeclarationSyntax r => r.Identifier.Text,
            EnumDeclarationSyntax e => e.Identifier.Text,
            _ => typeDecl.ToString()
        };
}

/// <summary>ponytail: 与 SourceSnippetReader 共用的路径校验</summary>
internal static class SourceFileGuard
{
    internal static string ResolveScopedFile(string folderPath, string relativeFilePath)
    {
        string root = Path.GetFullPath(folderPath);
        if (!Directory.Exists(root))
        {
            throw new DirectoryNotFoundException($"文件夹不存在: {root}");
        }

        if (string.IsNullOrWhiteSpace(relativeFilePath))
        {
            throw new ArgumentException("filePath 不能为空", nameof(relativeFilePath));
        }

        string fullPath = Path.GetFullPath(
            Path.Combine(root, relativeFilePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new UnauthorizedAccessException($"文件不在分析目录内: {relativeFilePath}");
        }

        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"文件不存在: {relativeFilePath}", fullPath);
        }

        return fullPath;
    }
}
