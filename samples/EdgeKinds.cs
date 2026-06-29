namespace SampleApp;

// 测试：interface / struct / record / enum 注册与引用

public interface IWorker
{
    void Work();
}

public struct PointBox
{
    public Animal Target;
}

public record PayloadRecord(AppRunner Source);

public enum WorkMode
{
    Idle,
    Active
}

public class KindConsumer : IWorker
{
    public WorkMode Mode;
    public PointBox Box;
    public PayloadRecord? Payload;

    public void Work()
    {
        AppRunner entry = new AppRunner();
        entry.Run();
    }
}
