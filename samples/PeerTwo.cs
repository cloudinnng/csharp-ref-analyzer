namespace SampleApp;

/// <summary>循环依赖另一侧：与 PeerOne 互相持有引用</summary>
public class PeerTwo
{
    private PeerOne? _peer;

    public void Back(PeerOne peer)
    {
        _peer = peer;
    }

    public void Ping()
    {
        _peer?.Link(this);
    }
}
