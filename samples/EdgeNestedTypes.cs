namespace SampleApp;

// 测试：嵌套 class 应单独注册；内部类型方法体引用 AppRunner

/// <summary>外层宿主：内含嵌套类型 InnerRunner</summary>
public class OuterHost
{
    private InnerRunner _inner = new InnerRunner();

    public void Start()
    {
        _inner.Go();
    }

    /// <summary>嵌套类：独立类型节点，方法内 new AppRunner</summary>
    public class InnerRunner
    {
        public void Go()
        {
            AppRunner entry = new AppRunner();
            entry.Run();
        }
    }
}
