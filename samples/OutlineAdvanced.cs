namespace SampleApp;

/// <summary>ponytail: 扩展 Outline 自检——索引器、static 工厂、init 属性</summary>
public class OutlineAdvanced
{
    public int Count { get; set; }

    public AppRunner this[int index]
    {
        get => _slots[index];
        set => _slots[index] = value;
    }

    private AppRunner[] _slots = [];

    /// <summary>static 工厂：返回值应出现在输出端口</summary>
    public static AppRunner CreateDefault()
    {
        return new AppRunner();
    }

    public void Reset()
    {
        Count = 0;
    }
}
