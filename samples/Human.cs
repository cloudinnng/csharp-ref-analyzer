namespace SampleApp;

/// <summary>人类：继承 Animal，可被多处引用与赋值</summary>
public class Human : Animal
{
    // HumanEventBinder 测试用：instance 成员赋值（事件/委托风格）
    public System.Action? OnWake;
    public System.Action? OnWork;
    public System.Action? OnMove;
    public System.Action? OnRest;

    public void DoWork()
    {
        Animal parent = new Animal();
        parent.Live();
    }
}
