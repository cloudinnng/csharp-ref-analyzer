using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using CsharpRefAnalyzer.Analysis;
using CsharpRefAnalyzer.Models;

namespace CsharpRefAnalyzer.Editor;

/// <summary>通过本机 Cursor CLI 打开文件行，并尝试将 Cursor 窗口置前（绕过浏览器 cursor:// 无法抢焦点）</summary>
public static class CursorEditorLauncher
{
    private const int SwRestore = 9;

    /// <summary>在 Cursor 中打开已校验路径下的文件并定位行号</summary>
    public static OpenEditorResultDto Open(OpenEditorRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FolderPath))
        {
            throw new ArgumentException("folderPath 不能为空", nameof(request));
        }

        if (request.Line < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(request.Line), "line 必须 >= 1");
        }

        string fullPath = SourceFileGuard.ResolveScopedFile(request.FolderPath, request.FilePath);
        string cursorExecutable = ResolveCursorExecutable();
        string gotoArgument = BuildGotoArgument(fullPath, request.Line, request.Column);

        Console.WriteLine(
            $"[CursorEditor] 启动 CLI exe={cursorExecutable} goto={gotoArgument}");

        RunCursorGoto(cursorExecutable, gotoArgument);

        bool focused = TryBringCursorToForeground();
        Console.WriteLine($"[CursorEditor] 置前结果 focused={focused}");

        return new OpenEditorResultDto
        {
            Success = true,
            Focused = focused,
            Method = "cli",
            CursorExecutable = cursorExecutable
        };
    }

    #region CLI 解析与启动

    /// <summary>构建 -g 参数：绝对路径:行[:列]</summary>
    private static string BuildGotoArgument(string fullPath, int line, int? column)
    {
        StringBuilder builder = new(fullPath);
        builder.Append(':').Append(line);
        if (column is >= 1)
        {
            builder.Append(':').Append(column.Value);
        }

        return builder.ToString();
    }

    /// <summary>执行 cursor -r -g "path:line[:col]"（复用已有窗口）</summary>
    private static void RunCursorGoto(string cursorExecutable, string gotoArgument)
    {
        string gotoFlag = QuoteCliArgument(gotoArgument);
        ProcessStartInfo startInfo;

        if (OperatingSystem.IsWindows()
            && cursorExecutable.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase))
        {
            // ponytail: .cmd 需经 cmd.exe 启动；UseShellExecute 更贴近用户双击行为
            startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/d /s /c \"\"{cursorExecutable}\" -r -g {gotoFlag}\"",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
        }
        else
        {
            startInfo = new ProcessStartInfo
            {
                FileName = cursorExecutable,
                Arguments = $"-r -g {gotoFlag}",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
        }

        using Process? process = Process.Start(startInfo);
        if (process is null)
        {
            throw new InvalidOperationException($"无法启动 Cursor: {cursorExecutable}");
        }
    }

    /// <summary>Windows cmd 风格引号包裹（路径含空格时必需）</summary>
    private static string QuoteCliArgument(string value)
    {
        if (!value.Contains(' ') && !value.Contains('"'))
        {
            return value;
        }

        return $"\"{value.Replace("\"", "\\\"")}\"";
    }

    /// <summary>解析 Cursor 可执行文件：CURSOR_PATH → PATH → 默认安装目录</summary>
    internal static string ResolveCursorExecutable()
    {
        string? fromEnv = Environment.GetEnvironmentVariable("CURSOR_PATH");
        if (!string.IsNullOrWhiteSpace(fromEnv) && File.Exists(fromEnv))
        {
            Console.WriteLine($"[CursorEditor] 使用 CURSOR_PATH={fromEnv}");
            return fromEnv;
        }

        if (OperatingSystem.IsWindows())
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] windowsCandidates =
            [
                Path.Combine(localAppData, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
                Path.Combine(localAppData, "Programs", "cursor", "Cursor.exe"),
                Path.Combine(localAppData, "Programs", "Cursor", "Cursor.exe"),
            ];

            foreach (string candidate in windowsCandidates)
            {
                if (File.Exists(candidate))
                {
                    Console.WriteLine($"[CursorEditor] 找到 Windows 安装: {candidate}");
                    return candidate;
                }
            }

            string? fromPath = FindOnPath("cursor.cmd")
                               ?? FindOnPath("cursor.exe")
                               ?? FindOnPath("cursor");
            if (fromPath is not null)
            {
                Console.WriteLine($"[CursorEditor] 找到 PATH: {fromPath}");
                return fromPath;
            }
        }
        else if (OperatingSystem.IsMacOS())
        {
            string[] macCandidates =
            [
                "/usr/local/bin/cursor",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Applications", "Cursor.app", "Contents", "Resources", "app", "bin", "cursor"),
            ];

            foreach (string candidate in macCandidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }
        else
        {
            string? fromPath = FindOnPath("cursor");
            if (fromPath is not null)
            {
                return fromPath;
            }
        }

        throw new FileNotFoundException(
            "未找到 Cursor 可执行文件。请安装 Cursor，或将 cursor 加入 PATH，或设置环境变量 CURSOR_PATH。");
    }

    private static string? FindOnPath(string fileName)
    {
        string? pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathEnv))
        {
            return null;
        }

        foreach (string dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            string trimmed = dir.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            string full = Path.Combine(trimmed, fileName);
            if (File.Exists(full))
            {
                return full;
            }
        }

        return null;
    }

    #endregion

    #region 窗口置前

    /// <summary>CLI 发出跳转后稍等，再尝试激活 Cursor 主窗口</summary>
    private static bool TryBringCursorToForeground()
    {
        Thread.Sleep(180);

        if (OperatingSystem.IsWindows())
        {
            return TryBringCursorToForegroundWindows();
        }

        if (OperatingSystem.IsMacOS())
        {
            return TryActivateCursorMacOs();
        }

        return false;
    }

    private static bool TryBringCursorToForegroundWindows()
    {
        IntPtr handle = FindCursorMainWindowHandle();
        if (handle == IntPtr.Zero)
        {
            Console.WriteLine("[CursorEditor] 未找到 Cursor 主窗口句柄");
            return false;
        }

        ShowWindow(handle, SwRestore);
        bool ok = SetForegroundWindow(handle);
        if (!ok)
        {
            // ponytail: 部分环境下 SetForegroundWindow 失败，再试 AppActivate 兼容层
            ok = TryAppActivateCursorWindows();
        }

        Console.WriteLine($"[CursorEditor] SetForegroundWindow={ok} handle=0x{handle:X}");
        return ok;
    }

    private static bool TryAppActivateCursorWindows()
    {
        try
        {
            Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null)
            {
                return false;
            }

            object? shell = Activator.CreateInstance(shellType);
            if (shell is null)
            {
                return false;
            }

            object? result = shellType.InvokeMember(
                "AppActivate",
                System.Reflection.BindingFlags.InvokeMethod,
                null,
                shell,
                ["Cursor"]);

            bool ok = result is int activated && activated != 0;
            Console.WriteLine($"[CursorEditor] WScript.AppActivate(Cursor)={ok}");
            return ok;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CursorEditor] AppActivate 失败: {ex.Message}");
            return false;
        }
    }

    private static IntPtr FindCursorMainWindowHandle()
    {
        Process[] processes = Process.GetProcessesByName("Cursor");
        IntPtr fallback = IntPtr.Zero;

        foreach (Process process in processes)
        {
            try
            {
                if (process.MainWindowHandle != IntPtr.Zero)
                {
                    return process.MainWindowHandle;
                }

                process.Refresh();
                if (process.MainWindowHandle != IntPtr.Zero)
                {
                    return process.MainWindowHandle;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CursorEditor] 读取进程窗口失败 pid={process.Id}: {ex.Message}");
            }
        }

        return fallback;
    }

    private static bool TryActivateCursorMacOs()
    {
        try
        {
            ProcessStartInfo startInfo = new()
            {
                FileName = "osascript",
                Arguments = "-e 'tell application \"Cursor\" to activate'",
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using Process? process = Process.Start(startInfo);
            process?.WaitForExit(5_000);
            bool ok = process is { ExitCode: 0 };
            Console.WriteLine($"[CursorEditor] macOS activate ok={ok}");
            return ok;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CursorEditor] macOS activate 失败: {ex.Message}");
            return false;
        }
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    #endregion
}
