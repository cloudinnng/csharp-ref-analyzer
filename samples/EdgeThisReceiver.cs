namespace SampleApp;

// 测试：this._field 形式的 instance 调用 / 成员访问（Unity 脚本常见写法）

public class ThisReceiverUser
{
    private Human _target;

    public void ViaThis()
    {
        this._target.DoWork();
        this._target.OnWake = null;
        this._target.OnWork = null;
    }
}
