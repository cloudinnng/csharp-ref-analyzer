namespace SampleApp;

// 测试：nullable、数组 应解析到元素类型；List<T> 仅识别容器名（不应误连 Human）

public class TypeShapes
{
    public Animal? NullableTarget;

    public AppRunner[] ArrayTarget;

    public System.Collections.Generic.List<Human> GenericList;

    public void UseShapes()
    {
        if (NullableTarget is not null)
        {
            NullableTarget.Live();
        }

        foreach (AppRunner item in ArrayTarget)
        {
            item.Run();
        }
    }
}
