namespace SampleApp;

// 测试：BCL 类型(string)不产生边；自类型 new 不产生自环

public class FilterCases
{
    public string ExternalName = "ignored";

    public void SelfCreate()
    {
        FilterCases local = new FilterCases();
        local.ExternalName = "still no external edge";
    }
}
