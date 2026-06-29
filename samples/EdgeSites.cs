namespace SampleApp;

// 测试：同一 (from→to) 多条 Sites；同 kind 多次引用行号均保留

public class MultiSite
{
    private Human _target;

    public void WireMany()
    {
        _target.DoWork();
        _target.OnWake = null;
        _target.OnWork = null;
    }
}
