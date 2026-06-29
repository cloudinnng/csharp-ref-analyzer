namespace SampleApp;

/// <summary>将 Human 的生命周期回调全部置空（测试多处 instance 成员引用）</summary>
public class HumanEventBinder
{
    private Human _target;

    public void Wire()
    {
        _target.OnWake = null;
        _target.OnWork = null;
        _target.OnMove = null;
        _target.OnRest = null;
    }
}
