namespace SampleApp;

// 测试：泛型方法参数/约束；List<T> 不展开类型参数（负例与 TypeShapes 一致）

/// <summary>泛型方法：Human 参数 + where T : Animal 约束（约束边为已知限制，不断言）</summary>
public class GenericProcessor
{
    public void Process<T>(Human subject) where T : Animal
    {
        subject.DoWork();
        T typed = default!;
        typed.Live();
    }

    /// <summary>泛型容器字段：仅识别 List，不应连 Human</summary>
    public System.Collections.Generic.List<Human> Buffer;

    public void FillBuffer()
    {
        Buffer = new System.Collections.Generic.List<Human>();
        Buffer.Add(new Human());
    }
}
