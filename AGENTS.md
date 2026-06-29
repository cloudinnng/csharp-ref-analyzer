开发的时候需要同时支持:

http://[局域网IP]:8780/

http://127.0.0.1:8780/

## F5 调试与编译

F5 调试会锁定 `bin/Debug` DLL，导致 `dotnet build` 失败或运行旧代码。注意：

1. 改 C# 需先停止调试（Shift+F5），再 build，再重启调试（F5 或 Ctrl+Shift+F5），别指望热更新。
2. 只改 `wwwroot` 刷新浏览器即可，无需重启后端。
3. build 报错除自身代码外，优先排查是否有调试进程未关。

F5 启动 C# 项目后会在 **Cursor 内置浏览器** 打开 `http://127.0.0.1:8780/`（`.vscode/launch.json` 中 `editor-browser` + `serverReadyAction`）。若仍跳外部浏览器，请在 Cursor **Settings → Tools & MCP** 开启 **Show Localhost Links in Browser**。