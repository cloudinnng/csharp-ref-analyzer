namespace CsharpRefAnalyzer.Models;

/// <summary>分析请求体</summary>
public sealed class AnalyzeRequest
{
    public string FolderPath { get; set; } = string.Empty;
}

/// <summary>最近分析路径列表响应</summary>
public sealed class PathHistoryDto
{
    public List<string> Paths { get; set; } = [];
}

/// <summary>路径历史增删请求（POST / DELETE 共用）</summary>
public sealed class PathHistoryRequest
{
    public string FolderPath { get; set; } = string.Empty;
}

/// <summary>类型种类</summary>
public enum TypeKind
{
    Class,
    Interface,
    Struct,
    Record,
    Enum
}

/// <summary>引用边种类</summary>
public enum ReferenceKind
{
    Extends,
    Implements,
    Calls,
    Uses
}

/// <summary>文件夹内已注册的类型节点</summary>
public sealed class ClassNodeDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Namespace { get; set; } = string.Empty;
    public TypeKind Kind { get; set; }
    /// <summary>是否为 abstract 类（仅 Kind=Class 时有意义）</summary>
    public bool IsAbstract { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
    public bool InCycle { get; set; }
}

/// <summary>单处引用位置（同一 from→to→kind 可有多条）</summary>
public sealed class ReferenceSiteDto
{
    public int Line { get; set; }
    public string? MemberName { get; set; }
    /// <summary>引用节点在该行的起始列（0-based，仅单行节点有效）</summary>
    public int? SpanStart { get; set; }
    /// <summary>引用节点在该行的字符长度</summary>
    public int? SpanLength { get; set; }
}

/// <summary>类之间的引用边</summary>
public sealed class ReferenceEdgeDto
{
    public string FromId { get; set; } = string.Empty;
    public string ToId { get; set; } = string.Empty;
    public ReferenceKind Kind { get; set; }
    public int Count { get; set; }
    public int Line { get; set; }
    public string? MemberName { get; set; }
    public List<ReferenceSiteDto> Sites { get; set; } = [];
}

/// <summary>调用层级中的一层</summary>
public sealed class LayerDto
{
    public int Level { get; set; }
    public List<string> ClassIds { get; set; } = [];
}

/// <summary>解析/分析过程中的非致命错误</summary>
public sealed class AnalysisErrorDto
{
    public string File { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

/// <summary>完整分析结果</summary>
public sealed class AnalysisResultDto
{
    public string RootPath { get; set; } = string.Empty;
    public int FilesScanned { get; set; }
    public List<ClassNodeDto> Classes { get; set; } = [];
    public List<ReferenceEdgeDto> References { get; set; } = [];
    public List<LayerDto> Layers { get; set; } = [];
    public List<List<string>> Cycles { get; set; } = [];
    public List<AnalysisErrorDto> Errors { get; set; } = [];
}

/// <summary>源码片段请求</summary>
public sealed class SnippetRequest
{
    public string FolderPath { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
    public int ContextLines { get; set; } = 3;
    /// <summary>可选：多处引用行（1-based），合并展示时全部高亮</summary>
    public List<int>? HighlightLines { get; set; }
}

/// <summary>源码片段中的一行</summary>
public sealed class SnippetLineDto
{
    public int Number { get; set; }
    public string Text { get; set; } = string.Empty;
    public bool Highlight { get; set; }
}

/// <summary>源码片段响应</summary>
public sealed class SnippetResultDto
{
    public string FilePath { get; set; } = string.Empty;
    public int HighlightLine { get; set; }
    public List<SnippetLineDto> Lines { get; set; } = [];
}

/// <summary>类型完整源码请求</summary>
public sealed class ClassSourceRequest
{
    public string FolderPath { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
    public string? TypeName { get; set; }
}

/// <summary>类型完整源码响应</summary>
public sealed class ClassSourceResultDto
{
    public string FilePath { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public int StartLine { get; set; }
    public int EndLine { get; set; }
    public List<SnippetLineDto> Lines { get; set; } = [];
}

/// <summary>成员种类</summary>
public enum MemberKind
{
    Field,
    Property,
    Method,
    Event,
    Constructor
}

/// <summary>成员可见性</summary>
public enum AccessLevel
{
    Public,
    Protected,
    Internal,
    ProtectedInternal,
    PrivateProtected,
    Private
}

/// <summary>成员输入/输出方向（启发式分类）</summary>
public enum IoDirection
{
    None,
    Input,
    Output
}

/// <summary>类型成员大纲条目</summary>
public sealed class MemberDto
{
    public MemberKind Kind { get; set; }
    public string Name { get; set; } = string.Empty;
    public AccessLevel Access { get; set; }
    public string TypeText { get; set; } = string.Empty;
    public bool IsStatic { get; set; }
    public int Line { get; set; }
    public string Signature { get; set; } = string.Empty;
    public IoDirection Io { get; set; }
}

/// <summary>输入/输出端口条目</summary>
public sealed class IoPortDto
{
    public MemberKind Kind { get; set; }
    public string Name { get; set; } = string.Empty;
    public string TypeText { get; set; } = string.Empty;
    /// <summary>来源说明，如「set」「get」「返回值」「构造参数」</summary>
    public string Source { get; set; } = string.Empty;
}

/// <summary>类型大纲请求</summary>
public sealed class ClassOutlineRequest
{
    public string FolderPath { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
    public string? TypeName { get; set; }
}

/// <summary>类型大纲响应</summary>
public sealed class ClassOutlineResultDto
{
    public string TypeName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
    public TypeKind Kind { get; set; }
    public List<MemberDto> Members { get; set; } = [];
    public List<IoPortDto> Inputs { get; set; } = [];
    public List<IoPortDto> Outputs { get; set; } = [];
}
