namespace SampleApp.Sub;

// 测试：嵌套命名空间内通过简单名引用 SampleApp.AppRunner

public class NestedUser
{
    public SampleApp.AppRunner Entry;

    public void Run()
    {
        SampleApp.AppRunner runner = new SampleApp.AppRunner();
        runner.Run();
    }
}
