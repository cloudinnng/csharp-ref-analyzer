namespace SampleApp;

// 测试：record 主构造函数参数、struct 实例方法、with 表达式（语法解析）

/// <summary>record 主构造：Human + AppRunner 参数均应 Uses</summary>
public record TeamBundle(Human Lead, AppRunner Runner);

/// <summary>组装 TeamBundle 并访问 record 属性</summary>
public class TeamFactory
{
    public TeamBundle Create(Human lead)
    {
        TeamBundle bundle = new TeamBundle(lead, new AppRunner());
        AppRunner tool = bundle.Runner;
        tool.Run();
        return bundle with { Lead = lead };
    }
}

/// <summary>struct 内 instance 方法调用字段类型 Animal</summary>
public struct LiveBox
{
    public Animal Target;

    public void Ping()
    {
        if (Target is not null)
        {
            Target.Live();
        }
    }
}
