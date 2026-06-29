using System.Collections.Immutable;
using System.Text;
using CsharpRefAnalyzer.Models;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>用 Roslyn 语义 + 语法回退构建文件夹内类之间的引用图</summary>
public static class ReferenceGraphBuilder
{
    private const string EdgeKeySeparator = "\u001f";
    private const int MaxDiagnostics = 50;

    /// <summary>分析结果（内部模型）</summary>
    public sealed class GraphResult
    {
        public required string RootPath { get; init; }
        public required int FilesScanned { get; init; }
        public required Dictionary<string, ClassNodeDto> Classes { get; init; }
        public required List<ReferenceEdgeDto> References { get; init; }
        public required List<AnalysisErrorDto> Errors { get; init; }
    }

    /// <summary>文件夹内类型索引，供语法回退匹配（Unity 无程序集引用时）</summary>
    private sealed class TypeIndex
    {
        public required Dictionary<string, ClassNodeDto> ById { get; init; }
        public required Dictionary<string, List<string>> BySimpleName { get; init; }
        public required Dictionary<string, string> ByQualifiedName { get; init; }

        public static TypeIndex FromClasses(Dictionary<string, ClassNodeDto> classes)
        {
            Dictionary<string, List<string>> bySimple = new(StringComparer.Ordinal);
            Dictionary<string, string> byQualified = new(StringComparer.Ordinal);

            foreach (ClassNodeDto c in classes.Values)
            {
                if (!bySimple.TryGetValue(c.Name, out List<string>? list))
                {
                    list = [];
                    bySimple[c.Name] = list;
                }

                list.Add(c.Id);

                string qualified = string.IsNullOrEmpty(c.Namespace) ? c.Name : $"{c.Namespace}.{c.Name}";
                byQualified[qualified] = c.Id;
                byQualified[$"global::{qualified}"] = c.Id;
                if (c.Id.StartsWith("global::", StringComparison.Ordinal))
                {
                    byQualified[c.Id["global::".Length..]] = c.Id;
                }
            }

            return new TypeIndex
            {
                ById = classes,
                BySimpleName = bySimple,
                ByQualifiedName = byQualified
            };
        }

        /// <summary>按类型语法文本解析文件夹内类型 id</summary>
        public string? ResolveTypeSyntax(TypeSyntax? typeSyntax)
        {
            if (typeSyntax is null)
            {
                return null;
            }

            string text = ExtractTypeName(typeSyntax);
            if (string.IsNullOrEmpty(text) || IsBuiltInType(text))
            {
                return null;
            }

            if (ByQualifiedName.TryGetValue(text, out string? exactId))
            {
                return exactId;
            }

            // 取最后一段简单名
            string simple = text.Contains('.') ? text.Split('.')[^1] : text;
            if (BySimpleName.TryGetValue(simple, out List<string>? ids) && ids.Count == 1)
            {
                return ids[0];
            }

            return null;
        }

        private static string ExtractTypeName(TypeSyntax syntax)
        {
            return syntax switch
            {
                IdentifierNameSyntax id => id.Identifier.Text,
                QualifiedNameSyntax q => q.ToString(),
                GenericNameSyntax g => g.Identifier.Text,
                NullableTypeSyntax n => ExtractTypeName(n.ElementType),
                ArrayTypeSyntax a => ExtractTypeName(a.ElementType),
                AliasQualifiedNameSyntax a => a.Name.ToString(),
                _ => syntax.ToString().Split('<')[0].Trim()
            };
        }

        private static bool IsBuiltInType(string name)
        {
            return name is "object" or "string" or "int" or "float" or "double" or "bool" or "void" or "var";
        }
    }

    private sealed record TypeDeclContext(
        string FromId,
        SyntaxNode Declaration,
        SemanticModel Model);

    #region 入口

    /// <summary>扫描文件夹并构建引用图</summary>
    public static GraphResult Build(string folderPath)
    {
        CsFolderScanner.ScanResult scan = CsFolderScanner.Scan(folderPath);
        CSharpCompilation compilation = CsFolderScanner.BuildCompilation(scan);

        List<AnalysisErrorDto> errors = []; // ponytail: Unity 缺引用时 GetDiagnostics 极慢，跳过
        Dictionary<string, ClassNodeDto> classes = RegisterInScopeTypes(compilation, scan.RootPath);
        TypeIndex typeIndex = TypeIndex.FromClasses(classes);
        List<ReferenceEdgeDto> references = CollectReferences(compilation, classes, typeIndex);

        Console.WriteLine($"[GraphBuilder] 注册 {classes.Count} 个类型, {references.Count} 条引用边");

        return new GraphResult
        {
            RootPath = scan.RootPath,
            FilesScanned = scan.FilePaths.Count,
            Classes = classes,
            References = references,
            Errors = errors
        };
    }

    #endregion

    #region 类型注册

    private static Dictionary<string, ClassNodeDto> RegisterInScopeTypes(
        CSharpCompilation compilation,
        string rootPath)
    {
        Dictionary<string, ClassNodeDto> map = new(StringComparer.Ordinal);

        foreach (SyntaxTree tree in compilation.SyntaxTrees)
        {
            SemanticModel model = compilation.GetSemanticModel(tree);
            CompilationUnitSyntax root = tree.GetCompilationUnitRoot();

            foreach (SyntaxNode node in root.DescendantNodes().Where(static n =>
                         n is ClassDeclarationSyntax or InterfaceDeclarationSyntax or StructDeclarationSyntax
                             or RecordDeclarationSyntax or EnumDeclarationSyntax))
            {
                INamedTypeSymbol? symbol = node switch
                {
                    ClassDeclarationSyntax c => model.GetDeclaredSymbol(c) as INamedTypeSymbol,
                    InterfaceDeclarationSyntax i => model.GetDeclaredSymbol(i) as INamedTypeSymbol,
                    StructDeclarationSyntax s => model.GetDeclaredSymbol(s) as INamedTypeSymbol,
                    RecordDeclarationSyntax r => model.GetDeclaredSymbol(r) as INamedTypeSymbol,
                    EnumDeclarationSyntax e => model.GetDeclaredSymbol(e) as INamedTypeSymbol,
                    _ => null
                };

                // ponytail: Unity 脚本缺程序集引用时 GetDeclaredSymbol 可能为 null，用语法回退注册
                if (symbol is null || symbol.IsImplicitlyDeclared)
                {
                    RegisterFromSyntax(node, tree, rootPath, map);
                    continue;
                }

                string id = symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
                if (map.ContainsKey(id))
                {
                    continue;
                }

                map[id] = new ClassNodeDto
                {
                    Id = id,
                    Name = symbol.Name,
                    Namespace = symbol.ContainingNamespace.IsGlobalNamespace
                        ? string.Empty
                        : symbol.ContainingNamespace.ToDisplayString(),
                    Kind = MapTypeKind(symbol, node),
                    FilePath = ToRelativePath(rootPath, tree.FilePath),
                    Line = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1
                };
            }
        }

        return map;
    }

    /// <summary>语义模型不可用时的语法级类型注册</summary>
    private static void RegisterFromSyntax(
        SyntaxNode node,
        SyntaxTree tree,
        string rootPath,
        Dictionary<string, ClassNodeDto> map)
    {
        string name = node switch
        {
            EnumDeclarationSyntax e => e.Identifier.Text,
            BaseTypeDeclarationSyntax t => t.Identifier.Text,
            _ => string.Empty
        };

        if (string.IsNullOrEmpty(name))
        {
            return;
        }

        string ns = GetNamespaceFromSyntax(node);
        string id = string.IsNullOrEmpty(ns) ? $"global::{name}" : $"global::{ns}.{name}";
        if (map.ContainsKey(id))
        {
            return;
        }

        map[id] = new ClassNodeDto
        {
            Id = id,
            Name = name,
            Namespace = ns,
            Kind = node switch
            {
                InterfaceDeclarationSyntax => Models.TypeKind.Interface,
                StructDeclarationSyntax => Models.TypeKind.Struct,
                RecordDeclarationSyntax => Models.TypeKind.Record,
                EnumDeclarationSyntax => Models.TypeKind.Enum,
                _ => Models.TypeKind.Class
            },
            FilePath = ToRelativePath(rootPath, tree.FilePath),
            Line = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1
        };
    }

    private static string GetNamespaceFromSyntax(SyntaxNode node)
    {
        SyntaxNode? current = node.Parent;
        while (current is not null)
        {
            if (current is NamespaceDeclarationSyntax nsDecl)
            {
                return nsDecl.Name.ToString();
            }

            if (current is FileScopedNamespaceDeclarationSyntax fileNs)
            {
                return fileNs.Name.ToString();
            }

            current = current.Parent;
        }

        return string.Empty;
    }

    private static Models.TypeKind MapTypeKind(INamedTypeSymbol symbol, SyntaxNode node)
    {
        if (node is EnumDeclarationSyntax)
        {
            return Models.TypeKind.Enum;
        }

        if (node is InterfaceDeclarationSyntax)
        {
            return Models.TypeKind.Interface;
        }

        if (node is RecordDeclarationSyntax || symbol.IsRecord)
        {
            return Models.TypeKind.Record;
        }

        if (symbol.TypeKind == Microsoft.CodeAnalysis.TypeKind.Struct)
        {
            return Models.TypeKind.Struct;
        }

        return Models.TypeKind.Class;
    }

    #endregion

    #region 引用采集

    private static List<ReferenceEdgeDto> CollectReferences(
        CSharpCompilation compilation,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex)
    {
        Dictionary<string, ReferenceEdgeDto> edgeMap = new(StringComparer.Ordinal);
        List<TypeDeclContext> contexts = [];

        foreach (SyntaxTree tree in compilation.SyntaxTrees)
        {
            SemanticModel model = compilation.GetSemanticModel(tree);
            CompilationUnitSyntax root = tree.GetCompilationUnitRoot();

            foreach (SyntaxNode node in root.DescendantNodes().Where(static n =>
                         n is ClassDeclarationSyntax or InterfaceDeclarationSyntax or StructDeclarationSyntax
                             or RecordDeclarationSyntax or EnumDeclarationSyntax))
            {
                string? fromId = ResolveTypeId(node, model, typeIndex);
                if (fromId is null || !classes.ContainsKey(fromId))
                {
                    continue;
                }

                contexts.Add(new TypeDeclContext(fromId, node, model));
            }
        }

        Console.WriteLine($"[GraphBuilder] 扫描 {contexts.Count} 个类型的引用…");

        foreach (TypeDeclContext ctx in contexts)
        {
            CollectTypeDeclarationReferences(ctx, classes, typeIndex, edgeMap);
            CollectBodyReferences(ctx, classes, typeIndex, edgeMap);
        }

        return edgeMap.Values.ToList();
    }

    private static string? ResolveTypeId(SyntaxNode decl, SemanticModel model, TypeIndex typeIndex)
    {
        if (model.GetDeclaredSymbol(decl) is INamedTypeSymbol symbol)
        {
            return symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
        }

        string name = decl switch
        {
            EnumDeclarationSyntax e => e.Identifier.Text,
            BaseTypeDeclarationSyntax t => t.Identifier.Text,
            _ => string.Empty
        };

        if (string.IsNullOrEmpty(name))
        {
            return null;
        }

        string ns = GetNamespaceFromSyntax(decl);
        string qualified = string.IsNullOrEmpty(ns) ? name : $"{ns}.{name}";
        return typeIndex.ByQualifiedName.GetValueOrDefault(qualified)
               ?? typeIndex.BySimpleName.GetValueOrDefault(name)?.FirstOrDefault();
    }

    private static void CollectTypeDeclarationReferences(
        TypeDeclContext ctx,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        SyntaxNode node = ctx.Declaration;

        if (node is BaseTypeDeclarationSyntax baseDecl && baseDecl.BaseList is not null)
        {
            foreach (BaseTypeSyntax baseTypeSyntax in baseDecl.BaseList.Types)
            {
                TryAddEdgeBySyntax(ctx.FromId, baseTypeSyntax.Type, ReferenceKind.Extends, baseTypeSyntax,
                    null, classes, typeIndex, edgeMap);
            }
        }
    }

    /// <summary>只扫描类型体内的引用相关语法节点（避免对每个 Identifier 做语义绑定）</summary>
    private static void CollectBodyReferences(
        TypeDeclContext ctx,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        // ponytail: 字段/参数/局部变量名 → 类型，用于 instance 成员访问语法回退
        Dictionary<string, TypeSyntax> memberTypes = BuildMemberTypeMap(ctx.Declaration);

        foreach (SyntaxNode node in ctx.Declaration.DescendantNodes())
        {
            switch (node)
            {
                case InvocationExpressionSyntax invocation:
                    CollectInvocation(ctx.FromId, invocation, memberTypes, ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case ObjectCreationExpressionSyntax creation:
                    CollectObjectCreation(ctx.FromId, creation, ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case MemberAccessExpressionSyntax memberAccess
                    when memberAccess.Parent is not InvocationExpressionSyntax:
                    CollectInstanceMemberAccess(ctx.FromId, memberAccess, memberTypes, classes, typeIndex, edgeMap);
                    break;
                case FieldDeclarationSyntax field:
                    CollectFieldDeclaration(ctx.FromId, field, ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case VariableDeclarationSyntax varDecl
                    when varDecl.Parent is not FieldDeclarationSyntax:
                    CollectVariableDeclaration(ctx.FromId, varDecl, ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case ParameterSyntax param when param.Type is not null:
                    CollectTypeUsage(ctx.FromId, param.Type, param, param.Identifier.Text,
                        ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case PropertyDeclarationSyntax prop:
                    CollectTypeUsage(ctx.FromId, prop.Type, prop, prop.Identifier.Text,
                        ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case MethodDeclarationSyntax method when method.ReturnType is not null:
                    CollectTypeUsage(ctx.FromId, method.ReturnType, method, method.Identifier.Text,
                        ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case EventFieldDeclarationSyntax evt:
                    CollectTypeUsage(ctx.FromId, evt.Declaration.Type, evt, null,
                        ctx.Model, classes, typeIndex, edgeMap);
                    break;
                case IdentifierNameSyntax id:
                    CollectTypedIdentifierUsage(ctx.FromId, id, memberTypes, classes, typeIndex, edgeMap);
                    break;
            }
        }
    }

    /// <summary>
    /// 字段/参数/局部变量在表达式中的使用（如 SetBrush(preset) 中的 preset）。
    /// ponytail: 仅语法+memberTypes 回退，不调用 GetSymbolInfo。
    /// </summary>
    private static void CollectTypedIdentifierUsage(
        string fromId,
        IdentifierNameSyntax id,
        Dictionary<string, TypeSyntax> memberTypes,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        // 类型声明中的标识符（如参数类型 BrushPreset preset 里的 BrushPreset）
        if (id.Ancestors().Any(static a => a is TypeSyntax))
        {
            return;
        }

        // 字段/局部声明处的变量名（如 private Human _x）不是「使用」点
        if (id.Parent is VariableDeclaratorSyntax)
        {
            return;
        }

        // obj.Method() 中的 obj 由 CollectInvocation 处理
        if (id.Parent is MemberAccessExpressionSyntax memberAccess && memberAccess.Expression == id)
        {
            return;
        }

        if (!memberTypes.TryGetValue(id.Identifier.Text, out TypeSyntax? variableType))
        {
            return;
        }

        TryAddEdgeBySyntax(fromId, variableType, ReferenceKind.Uses, id, id.Identifier.Text,
            classes, typeIndex, edgeMap);
    }

    /// <summary>收集字段、参数、局部变量名到类型的映射（语法级）</summary>
    private static Dictionary<string, TypeSyntax> BuildMemberTypeMap(SyntaxNode typeDeclaration)
    {
        Dictionary<string, TypeSyntax> map = new(StringComparer.Ordinal);

        foreach (SyntaxNode node in typeDeclaration.DescendantNodes())
        {
            switch (node)
            {
                case FieldDeclarationSyntax field:
                    foreach (VariableDeclaratorSyntax v in field.Declaration.Variables)
                    {
                        map[v.Identifier.Text] = field.Declaration.Type;
                    }

                    break;
                case ParameterSyntax param when param.Type is not null:
                    map[param.Identifier.Text] = param.Type;
                    break;
                case VariableDeclaratorSyntax varDecl
                    when varDecl.Parent is VariableDeclarationSyntax varType:
                    map[varDecl.Identifier.Text] = varType.Type;
                    break;
                case PropertyDeclarationSyntax prop when prop.Type is not null:
                    map[prop.Identifier.Text] = prop.Type;
                    break;
            }
        }

        return map;
    }

    /// <summary>
    /// 从 instance 表达式的 receiver 链解析成员变量/参数名。
    /// 支持 _field.Method()、this._field.Method()、helper.Method()。
    /// </summary>
    private static string? GetInstanceReceiverName(ExpressionSyntax? expression)
    {
        if (expression is null)
        {
            return null;
        }

        if (expression is IdentifierNameSyntax id)
        {
            return id.Identifier.Text;
        }

        if (expression is MemberAccessExpressionSyntax ma)
        {
            // this._field / base._field → 取 _field
            if (ma.Expression is ThisExpressionSyntax or BaseExpressionSyntax)
            {
                return ma.Name.Identifier.Text;
            }

            // a.b.Method() → 用 a 查 memberTypes
            if (ma.Expression is IdentifierNameSyntax leftId)
            {
                return leftId.Identifier.Text;
            }

            return GetInstanceReceiverName(ma.Expression);
        }

        return null;
    }

    /// <summary>instance 成员访问：field.Method / field.Prop（含事件赋值左侧）</summary>
    private static void CollectInstanceMemberAccess(
        string fromId,
        MemberAccessExpressionSyntax memberAccess,
        Dictionary<string, TypeSyntax> memberTypes,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        string? receiverName = GetInstanceReceiverName(memberAccess.Expression);
        if (receiverName is null || !memberTypes.TryGetValue(receiverName, out TypeSyntax? instanceType))
        {
            return;
        }

        TryAddEdgeBySyntax(fromId, instanceType, ReferenceKind.Uses, memberAccess,
            memberAccess.Name.Identifier.Text, classes, typeIndex, edgeMap);
    }

    private static void CollectInvocation(
        string fromId,
        InvocationExpressionSyntax invocation,
        Dictionary<string, TypeSyntax> memberTypes,
        SemanticModel model,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        if (invocation.Expression is not MemberAccessExpressionSyntax memberAccess)
        {
            return;
        }

        string? receiverName = GetInstanceReceiverName(memberAccess.Expression);
        if (receiverName is not null &&
            memberTypes.TryGetValue(receiverName, out TypeSyntax? instanceType))
        {
            // instance 调用：helper.DoWork() / this._inputHandler.OnX()
            TryAddEdgeBySyntax(fromId, instanceType, ReferenceKind.Calls, invocation,
                memberAccess.Name.Identifier.Text, classes, typeIndex, edgeMap);
            return;
        }

        // 静态调用：ClassName.Method()（receiver 为类型名）
        if (memberAccess.Expression is IdentifierNameSyntax staticReceiver)
        {
            TryAddEdgeBySyntax(fromId, staticReceiver, ReferenceKind.Calls, invocation,
                staticReceiver.Identifier.Text, classes, typeIndex, edgeMap);
        }
    }

    private static void CollectObjectCreation(
        string fromId,
        ObjectCreationExpressionSyntax creation,
        SemanticModel model,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        if (TryAddEdgeBySyntax(fromId, creation.Type, ReferenceKind.Calls, creation, ".ctor",
                classes, typeIndex, edgeMap))
        {
            return;
        }

        // ponytail: 语法未命中则跳过，不调用 GetSymbolInfo
    }

    private static void CollectFieldDeclaration(
        string fromId,
        FieldDeclarationSyntax field,
        SemanticModel model,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        foreach (VariableDeclaratorSyntax v in field.Declaration.Variables)
        {
            CollectTypeUsage(fromId, field.Declaration.Type, v, v.Identifier.Text,
                model, classes, typeIndex, edgeMap);
        }
    }

    private static void CollectVariableDeclaration(
        string fromId,
        VariableDeclarationSyntax varDecl,
        SemanticModel model,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        foreach (VariableDeclaratorSyntax v in varDecl.Variables)
        {
            CollectTypeUsage(fromId, varDecl.Type, v, v.Identifier.Text,
                model, classes, typeIndex, edgeMap);
        }
    }

    private static void CollectTypeUsage(
        string fromId,
        TypeSyntax typeSyntax,
        SyntaxNode node,
        string? memberName,
        SemanticModel model,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        if (TryAddEdgeBySyntax(fromId, typeSyntax, ReferenceKind.Uses, node, memberName,
                classes, typeIndex, edgeMap))
        {
            return;
        }

        // ponytail: 语法未命中时不做 GetTypeInfo，Unity 脚本缺引用时语义绑定无价值且慢
    }

    private static bool TryAddEdgeBySyntax(
        string fromId,
        TypeSyntax typeSyntax,
        ReferenceKind kind,
        SyntaxNode node,
        string? memberName,
        Dictionary<string, ClassNodeDto> classes,
        TypeIndex typeIndex,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        string? toId = typeIndex.ResolveTypeSyntax(typeSyntax);
        if (toId is null || string.Equals(fromId, toId, StringComparison.Ordinal))
        {
            return false;
        }

        MergeEdge(fromId, toId, kind, node, memberName, edgeMap);
        return true;
    }

    private static void AddSymbolReference(
        string fromId,
        ISymbol? symbol,
        SyntaxNode node,
        Dictionary<string, ClassNodeDto> classes,
        Dictionary<string, ReferenceEdgeDto> edgeMap,
        ReferenceKind? forceKind = null)
    {
        switch (symbol)
        {
            case INamedTypeSymbol named:
                TryAddEdge(fromId, named, forceKind ?? ReferenceKind.Uses, node, null, classes, edgeMap);
                break;
            case IMethodSymbol method:
                TryAddEdge(fromId, method.ContainingType, forceKind ?? ReferenceKind.Calls, node, method.Name, classes, edgeMap);
                break;
            case IFieldSymbol field:
                TryAddEdge(fromId, field.ContainingType, forceKind ?? ReferenceKind.Uses, node, field.Name, classes, edgeMap);
                break;
            case IPropertySymbol property:
                TryAddEdge(fromId, property.ContainingType, forceKind ?? ReferenceKind.Uses, node, property.Name, classes, edgeMap);
                break;
        }
    }

    private static void TryAddEdge(
        string fromId,
        ITypeSymbol? targetType,
        ReferenceKind kind,
        SyntaxNode node,
        string? memberName,
        Dictionary<string, ClassNodeDto> classes,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        INamedTypeSymbol? named = UnwrapType(targetType);
        if (named is null)
        {
            return;
        }

        string toId = named.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
        if (!classes.ContainsKey(toId) || string.Equals(fromId, toId, StringComparison.Ordinal))
        {
            // 语义 id 与语法 id 不一致时（Unity 常见），按简单名回退
            string simple = named.Name;
            if (classes.Values.FirstOrDefault(c => c.Name == simple) is { } match &&
                !string.Equals(fromId, match.Id, StringComparison.Ordinal))
            {
                MergeEdge(fromId, match.Id, kind, node, memberName, edgeMap);
            }

            return;
        }

        MergeEdge(fromId, toId, kind, node, memberName, edgeMap);
    }

    private static void MergeEdge(
        string fromId,
        string toId,
        ReferenceKind kind,
        SyntaxNode node,
        string? memberName,
        Dictionary<string, ReferenceEdgeDto> edgeMap)
    {
        string key = $"{fromId}{EdgeKeySeparator}{toId}{EdgeKeySeparator}{kind}";
        FileLinePositionSpan lineSpan = node.GetLocation().GetLineSpan();
        int line = lineSpan.StartLinePosition.Line + 1;
        (int? spanStart, int? spanLength) = GetSingleLineCharacterSpan(lineSpan);

        if (edgeMap.TryGetValue(key, out ReferenceEdgeDto? existing))
        {
            existing.Count++;
            existing.Sites.Add(new ReferenceSiteDto
            {
                Line = line,
                MemberName = memberName,
                SpanStart = spanStart,
                SpanLength = spanLength
            });
            return;
        }

        edgeMap[key] = new ReferenceEdgeDto
        {
            FromId = fromId,
            ToId = toId,
            Kind = kind,
            Count = 1,
            Line = line,
            MemberName = memberName,
            Sites =
            [
                new ReferenceSiteDto
                {
                    Line = line,
                    MemberName = memberName,
                    SpanStart = spanStart,
                    SpanLength = spanLength
                }
            ]
        };
    }

    /// <summary>单行语法节点的列范围，用于源码面板行内高亮</summary>
    private static (int? SpanStart, int? SpanLength) GetSingleLineCharacterSpan(FileLinePositionSpan lineSpan)
    {
        if (lineSpan.StartLinePosition.Line != lineSpan.EndLinePosition.Line)
        {
            return (null, null);
        }

        int start = lineSpan.StartLinePosition.Character;
        int length = lineSpan.EndLinePosition.Character - start;
        return length > 0 ? (start, length) : (null, null);
    }

    private static INamedTypeSymbol? UnwrapType(ITypeSymbol? type)
    {
        while (type is not null)
        {
            if (type is INamedTypeSymbol named)
            {
                if (named is { TypeKind: Microsoft.CodeAnalysis.TypeKind.Error, OriginalDefinition: INamedTypeSymbol orig })
                {
                    type = orig;
                    continue;
                }

                return named;
            }

            if (type is IArrayTypeSymbol array)
            {
                type = array.ElementType;
                continue;
            }

            if (type is IPointerTypeSymbol pointer)
            {
                type = pointer.PointedAtType;
                continue;
            }

            break;
        }

        return null;
    }

    #endregion

    #region 诊断

    private static List<AnalysisErrorDto> CollectDiagnostics(CSharpCompilation compilation, string rootPath)
    {
        ImmutableArray<Diagnostic> diags = compilation.GetDiagnostics();
        List<AnalysisErrorDto> errors = [];
        int skipped = 0;

        foreach (Diagnostic d in diags)
        {
            if (d.Severity != DiagnosticSeverity.Error && d.Severity != DiagnosticSeverity.Warning)
            {
                continue;
            }

            if (errors.Count >= MaxDiagnostics)
            {
                skipped++;
                continue;
            }

            string file = d.Location.SourceTree?.FilePath ?? string.Empty;
            errors.Add(new AnalysisErrorDto
            {
                File = string.IsNullOrEmpty(file) ? string.Empty : ToRelativePath(rootPath, file),
                Message = d.GetMessage()
            });
        }

        if (skipped > 0)
        {
            errors.Add(new AnalysisErrorDto
            {
                File = string.Empty,
                Message = $"… 另有 {skipped} 条诊断已省略（Unity/外部引用缺失时常见，不影响文件夹内互引分析）"
            });
        }

        return errors;
    }

    private static string ToRelativePath(string rootPath, string? filePath)
    {
        if (string.IsNullOrEmpty(filePath))
        {
            return string.Empty;
        }

        string full = Path.GetFullPath(filePath);
        string root = Path.GetFullPath(rootPath);
        if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            return full[(root.Length + 1)..].Replace('\\', '/');
        }

        return full.Replace('\\', '/');
    }

    #endregion
}
