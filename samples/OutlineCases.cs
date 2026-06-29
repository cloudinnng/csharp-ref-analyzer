namespace SampleApp;

/// <summary>ponytail: 成员大纲与输入/输出分类自检样例</summary>
public class OutlineCases
{
    // 输入：public 可写字段
    public int WritableField;

    // 输出：public readonly 字段
    public readonly string ReadOnlyField = "fixed";

    // 输出：public get-only 属性
    public string ReadOnlyProp { get; }

    // 输入：public 可写属性
    public double WritableProp { get; set; }

    // 私有字段：不应出现在 IO 清单
    private int _hidden;

    // 输出：public event
    public event Action? OnChanged;

    public OutlineCases(string seed, int count)
    {
        ReadOnlyProp = seed;
        WritableField = count;
    }

    public string Compute(int factor)
    {
        return ReadOnlyProp + factor;
    }
}
