namespace SampleApp;

// 测试：静态调用 Animal.Spawn()；参数上的 instance 调用 param.DoWork()

public class StaticCaller
{
    public void RunStatic()
    {
        Animal.Spawn();
    }
}

public class ParamCaller
{
    public void Invoke(Human target)
    {
        target.DoWork();
        target.OnWake = null;
    }
}

public class BrushCanvas
{
    public void SetBrush(Human preset, Animal tip) { }
}

/// <summary>参数作为实参传递时也应产生对参数类型的 Uses 引用</summary>
public class ParamArgPass
{
    private BrushCanvas _canvas;

    public void SelectBrush(Human preset)
    {
        _canvas.SetBrush(preset, new Animal());
    }
}
