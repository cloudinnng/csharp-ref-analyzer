using System.Text;
using CsharpRefAnalyzer.Models;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>从源文件中提取类型成员大纲与输入/输出端口（纯语法树，不依赖语义模型）</summary>
public static class ClassOutlineReader
{
    /// <summary>按定义行号（及可选类型名）读取类型成员大纲</summary>
    public static ClassOutlineResultDto ReadClassOutline(
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

        SyntaxTree tree = CSharpSyntaxTree.ParseText(sourceText, path: fullPath);
        CompilationUnitSyntax root = tree.GetCompilationUnitRoot();

        BaseTypeDeclarationSyntax? typeDecl = FindTypeDeclaration(root, line, typeName);
        if (typeDecl is null)
        {
            throw new InvalidOperationException(
                $"未在 {relativeFilePath}:{line} 找到类型定义{(typeName is not null ? $" ({typeName})" : "")}");
        }

        string resolvedName = GetTypeName(typeDecl);
        int declLine = typeDecl.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        Models.TypeKind kind = MapTypeKind(typeDecl);

        List<MemberDto> members = [];
        List<IoPortDto> inputs = [];
        List<IoPortDto> outputs = [];

        if (typeDecl is TypeDeclarationSyntax typeWithMembers)
        {
            foreach (MemberDeclarationSyntax member in typeWithMembers.Members)
            {
                switch (member)
                {
                    case FieldDeclarationSyntax field:
                        ExtractFields(field, members, inputs, outputs);
                        break;
                    case PropertyDeclarationSyntax prop:
                        ExtractProperty(prop, members, inputs, outputs);
                        break;
                    case MethodDeclarationSyntax method:
                        ExtractMethod(method, members, outputs);
                        break;
                    case EventFieldDeclarationSyntax evt:
                        ExtractEvent(evt, members, outputs);
                        break;
                    case ConstructorDeclarationSyntax ctor:
                        ExtractConstructor(ctor, members, inputs);
                        break;
                }
            }
        }
        else if (typeDecl is EnumDeclarationSyntax enumDecl)
        {
            foreach (EnumMemberDeclarationSyntax enumMember in enumDecl.Members)
            {
                string name = enumMember.Identifier.Text;
                int enumLine = enumMember.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
                members.Add(new MemberDto
                {
                    Kind = MemberKind.Field,
                    Name = name,
                    Access = AccessLevel.Public,
                    TypeText = resolvedName,
                    IsStatic = true,
                    Line = enumLine,
                    Signature = name,
                    Io = IoDirection.None
                });
            }
        }

        Console.WriteLine(
            $"[ClassOutline] {relativeFilePath} {resolvedName} " +
            $"成员 {members.Count}，输入 {inputs.Count}，输出 {outputs.Count}");

        return new ClassOutlineResultDto
        {
            TypeName = resolvedName,
            FilePath = relativeFilePath.Replace('\\', '/'),
            Line = declLine,
            Kind = kind,
            Members = members,
            Inputs = inputs,
            Outputs = outputs
        };
    }

    #region 成员提取

    private static void ExtractFields(
        FieldDeclarationSyntax field,
        List<MemberDto> members,
        List<IoPortDto> inputs,
        List<IoPortDto> outputs)
    {
        AccessLevel access = ParseAccessLevel(field.Modifiers);
        bool isStatic = field.Modifiers.Any(SyntaxKind.StaticKeyword);
        bool isReadOnly = field.Modifiers.Any(SyntaxKind.ReadOnlyKeyword);
        bool isConst = field.Modifiers.Any(SyntaxKind.ConstKeyword);
        string typeText = field.Declaration.Type.ToString();

        foreach (VariableDeclaratorSyntax variable in field.Declaration.Variables)
        {
            string name = variable.Identifier.Text;
            int line = variable.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
            IoDirection io = ClassifyFieldIo(access, isReadOnly, isConst);

            members.Add(new MemberDto
            {
                Kind = MemberKind.Field,
                Name = name,
                Access = access,
                TypeText = typeText,
                IsStatic = isStatic,
                Line = line,
                Signature = $"{typeText} {name}",
                Io = io
            });

            if (access == AccessLevel.Private)
            {
                continue;
            }

            if (io == IoDirection.Input)
            {
                inputs.Add(new IoPortDto { Kind = MemberKind.Field, Name = name, TypeText = typeText, Source = "可写字段" });
            }
            else if (io == IoDirection.Output)
            {
                outputs.Add(new IoPortDto
                {
                    Kind = MemberKind.Field,
                    Name = name,
                    TypeText = typeText,
                    Source = isConst ? "const" : "readonly"
                });
            }
        }
    }

    private static void ExtractProperty(
        PropertyDeclarationSyntax prop,
        List<MemberDto> members,
        List<IoPortDto> inputs,
        List<IoPortDto> outputs)
    {
        AccessLevel access = ParseAccessLevel(prop.Modifiers);
        bool isStatic = prop.Modifiers.Any(SyntaxKind.StaticKeyword);
        string name = prop.Identifier.Text;
        string typeText = prop.Type.ToString();
        int line = prop.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

        bool hasSetter = HasPropertySetter(prop);
        bool isGetOnly = !hasSetter;
        IoDirection io = ClassifyPropertyIo(access, hasSetter, isGetOnly);

        string accessorHint = isGetOnly ? "{ get; }" : hasSetter ? "{ get; set; }" : "{ get; init; }";
        members.Add(new MemberDto
        {
            Kind = MemberKind.Property,
            Name = name,
            Access = access,
            TypeText = typeText,
            IsStatic = isStatic,
            Line = line,
            Signature = $"{typeText} {name} {accessorHint}",
            Io = io
        });

        if (access == AccessLevel.Private)
        {
            return;
        }

        if (io == IoDirection.Input)
        {
            inputs.Add(new IoPortDto
            {
                Kind = MemberKind.Property,
                Name = name,
                TypeText = typeText,
                Source = prop.AccessorList?.Accessors.Any(a => a.IsKind(SyntaxKind.InitAccessorDeclaration)) == true
                    ? "init"
                    : "set"
            });
        }
        else if (io == IoDirection.Output)
        {
            outputs.Add(new IoPortDto { Kind = MemberKind.Property, Name = name, TypeText = typeText, Source = "get" });
        }
    }

    private static void ExtractMethod(
        MethodDeclarationSyntax method,
        List<MemberDto> members,
        List<IoPortDto> outputs)
    {
        AccessLevel access = ParseAccessLevel(method.Modifiers);
        bool isStatic = method.Modifiers.Any(SyntaxKind.StaticKeyword);
        string name = method.Identifier.Text;
        string returnType = method.ReturnType.ToString();
        int line = method.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

        string paramList = string.Join(", ",
            method.ParameterList.Parameters.Select(p =>
                $"{p.Type} {p.Identifier.Text}".Trim()));

        members.Add(new MemberDto
        {
            Kind = MemberKind.Method,
            Name = name,
            Access = access,
            TypeText = returnType,
            IsStatic = isStatic,
            Line = line,
            Signature = $"{returnType} {name}({paramList})",
            Io = IoDirection.None
        });

        // 方法返回值作为输出端口
        if (access != AccessLevel.Private && !IsVoidType(returnType))
        {
            outputs.Add(new IoPortDto
            {
                Kind = MemberKind.Method,
                Name = name,
                TypeText = returnType,
                Source = "返回值"
            });
        }
    }

    private static void ExtractEvent(
        EventFieldDeclarationSyntax evt,
        List<MemberDto> members,
        List<IoPortDto> outputs)
    {
        AccessLevel access = ParseAccessLevel(evt.Modifiers);
        bool isStatic = evt.Modifiers.Any(SyntaxKind.StaticKeyword);
        string typeText = evt.Declaration.Type.ToString();

        foreach (VariableDeclaratorSyntax variable in evt.Declaration.Variables)
        {
            string name = variable.Identifier.Text;
            int line = variable.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

            members.Add(new MemberDto
            {
                Kind = MemberKind.Event,
                Name = name,
                Access = access,
                TypeText = typeText,
                IsStatic = isStatic,
                Line = line,
                Signature = $"event {typeText} {name}",
                Io = access == AccessLevel.Private ? IoDirection.None : IoDirection.Output
            });

            if (access != AccessLevel.Private)
            {
                outputs.Add(new IoPortDto { Kind = MemberKind.Event, Name = name, TypeText = typeText, Source = "event" });
            }
        }
    }

    private static void ExtractConstructor(
        ConstructorDeclarationSyntax ctor,
        List<MemberDto> members,
        List<IoPortDto> inputs)
    {
        AccessLevel access = ParseAccessLevel(ctor.Modifiers);
        string name = ctor.Identifier.Text;
        int line = ctor.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

        string paramList = string.Join(", ",
            ctor.ParameterList.Parameters.Select(p =>
                $"{p.Type} {p.Identifier.Text}".Trim()));

        members.Add(new MemberDto
        {
            Kind = MemberKind.Constructor,
            Name = name,
            Access = access,
            TypeText = string.Empty,
            IsStatic = false,
            Line = line,
            Signature = $"{name}({paramList})",
            Io = IoDirection.None
        });

        if (access == AccessLevel.Private)
        {
            return;
        }

        foreach (ParameterSyntax param in ctor.ParameterList.Parameters)
        {
            if (param.Type is null)
            {
                continue;
            }

            inputs.Add(new IoPortDto
            {
                Kind = MemberKind.Constructor,
                Name = param.Identifier.Text,
                TypeText = param.Type.ToString(),
                Source = "构造参数"
            });
        }
    }

    #endregion

    #region 分类与解析

    private static IoDirection ClassifyFieldIo(AccessLevel access, bool isReadOnly, bool isConst)
    {
        if (access == AccessLevel.Private)
        {
            return IoDirection.None;
        }

        if (isReadOnly || isConst)
        {
            return IoDirection.Output;
        }

        return IoDirection.Input;
    }

    private static IoDirection ClassifyPropertyIo(AccessLevel access, bool hasSetter, bool isGetOnly)
    {
        if (access == AccessLevel.Private)
        {
            return IoDirection.None;
        }

        if (hasSetter)
        {
            return IoDirection.Input;
        }

        if (isGetOnly)
        {
            return IoDirection.Output;
        }

        return IoDirection.None;
    }

    private static bool HasPropertySetter(PropertyDeclarationSyntax prop)
    {
        // 表达式体属性视为 get-only
        if (prop.ExpressionBody is not null)
        {
            return false;
        }

        if (prop.AccessorList is null)
        {
            return false;
        }

        return prop.AccessorList.Accessors.Any(a =>
            a.IsKind(SyntaxKind.SetAccessorDeclaration) ||
            a.IsKind(SyntaxKind.InitAccessorDeclaration));
    }

    private static bool IsVoidType(string typeText) =>
        string.Equals(typeText, "void", StringComparison.Ordinal);

    private static AccessLevel ParseAccessLevel(SyntaxTokenList modifiers)
    {
        bool isPublic = modifiers.Any(SyntaxKind.PublicKeyword);
        bool isProtected = modifiers.Any(SyntaxKind.ProtectedKeyword);
        bool isInternal = modifiers.Any(SyntaxKind.InternalKeyword);
        bool isPrivate = modifiers.Any(SyntaxKind.PrivateKeyword);

        if (isPublic)
        {
            return AccessLevel.Public;
        }

        if (isProtected && isInternal)
        {
            return AccessLevel.ProtectedInternal;
        }

        if (isPrivate && isProtected)
        {
            return AccessLevel.PrivateProtected;
        }

        if (isProtected)
        {
            return AccessLevel.Protected;
        }

        if (isInternal)
        {
            return AccessLevel.Internal;
        }

        // ponytail: 类成员无修饰符默认 private
        return AccessLevel.Private;
    }

    private static Models.TypeKind MapTypeKind(BaseTypeDeclarationSyntax typeDecl) =>
        typeDecl switch
        {
            InterfaceDeclarationSyntax => Models.TypeKind.Interface,
            StructDeclarationSyntax => Models.TypeKind.Struct,
            RecordDeclarationSyntax => Models.TypeKind.Record,
            EnumDeclarationSyntax => Models.TypeKind.Enum,
            _ => Models.TypeKind.Class
        };

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

    #endregion
}
