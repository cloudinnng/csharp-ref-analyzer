namespace SampleApp;

// 测试：?? 空合并、switch 表达式、本地函数、is 模式、collection 表达式内的 new

/// <summary>现代 C# 语法下的类型引用采集</summary>
public class ModernSyntaxUser
{
    /// <summary>?? 右侧 new Human 应产生 Calls；返回类型与参数产生 Uses</summary>
    public Human PickOrCreate(Human? candidate)
    {
        return candidate ?? new Human();
    }

    /// <summary>switch 表达式 default 分支 new AppRunner</summary>
    public int Dispatch(object item)
    {
        return item switch
        {
            AppRunner runner => RunRunner(runner),
            _ => SpawnDefault()
        };
    }

    private static int SpawnDefault()
    {
        AppRunner entry = new AppRunner();
        entry.Run();
        return 0;
    }

    private static int RunRunner(AppRunner runner)
    {
        runner.Run();
        return 1;
    }

    /// <summary>本地函数体内 new Animal 并调用</summary>
    public void ViaLocalFunction()
    {
        void SpawnLocal()
        {
            Animal creature = new Animal();
            creature.Live();
        }

        SpawnLocal();
    }

    /// <summary>is 模式匹配后调用（pattern 变量 h 由 CollectInvocation 经参数/局部映射处理）</summary>
    public void ViaIsPattern(object value)
    {
        if (value is Human matched)
        {
            matched.DoWork();
        }
    }

    /// <summary>collection 表达式元素 new Human</summary>
    public Human[] BuildTeam()
    {
        return [new Human(), new Human()];
    }
}
