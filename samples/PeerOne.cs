namespace SampleApp;

/// <summary>循环依赖一侧：与 PeerTwo 互相持有引用</summary>
public class PeerOne
{
    private PeerTwo? _peer;

    public void Link(PeerTwo peer)
    {
        _peer = peer;
        peer.Back(this);
    }
}
