namespace SampleApp;

/// <summary>应用入口：创建 Human 并触发其行为</summary>
public class AppRunner
{
    public void Run()
    {
        Human worker = new Human();
        worker.DoWork();
    }
}
