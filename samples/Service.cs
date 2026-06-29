namespace SampleApp;

public interface ITaskRunner
{
    void Execute();
}

public class TaskRunnerImpl : ITaskRunner
{
    public void Execute()
    {
        AppRunner entry = new AppRunner();
        entry.Run();
    }
}
