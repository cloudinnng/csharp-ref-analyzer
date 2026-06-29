namespace SampleApp;

// 测试：字段(多声明符)、属性、方法返回/参数、event 字段声明

public class Declarations
{
    public event System.Action? AppRunnerEvent;

    public Human PropertyTarget { get; set; }

    public Animal MethodReturn() => new Animal();

    public void TakesParam(AppRunner input)
    {
        input.Run();
    }

    // 一行两个字段声明，均应产生 Uses 引用
    private Human _first, _second;
}
