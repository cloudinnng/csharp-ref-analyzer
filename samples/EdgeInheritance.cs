namespace SampleApp;

// 测试：abstract / sealed / 多层继承 / 多接口实现 / override 方法体引用

/// <summary>抽象基类：继承 Animal，供 ConcreteHost 扩展</summary>
public abstract class BaseAnimalHost : Animal
{
    public abstract void HostWork();
}

/// <summary>密封实现类：override 内 new AppRunner 并调用</summary>
public sealed class ConcreteHost : BaseAnimalHost
{
    public override void HostWork()
    {
        AppRunner entry = new AppRunner();
        entry.Run();
    }
}

/// <summary>多接口实现：BaseList 上 IWorker + ITaskRunner 均应产生 Extends 边</summary>
public class DualImpl : IWorker, ITaskRunner
{
    public void Work()
    {
        Human worker = new Human();
        worker.DoWork();
    }

    public void Execute()
    {
        Animal.Spawn();
    }
}
