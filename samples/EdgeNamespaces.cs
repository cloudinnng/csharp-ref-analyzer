// 测试：file-scoped namespace + global:: 完全限定名引用

namespace SampleApp.Scoped;

/// <summary>file-scoped 命名空间内的类型，引用 SampleApp.AppRunner</summary>
public class ScopedUser
{
    public global::SampleApp.AppRunner Entry;

    public void RunScoped()
    {
        global::SampleApp.AppRunner runner = new global::SampleApp.AppRunner();
        runner.Run();
    }
}
