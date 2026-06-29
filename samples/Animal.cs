namespace SampleApp;

/// <summary>基类：所有生物的公共行为</summary>
public class Animal
{
    public void Live()
    {
        Console.WriteLine("Animal lives");
    }

    // EdgeCalls 测试用：静态方法调用 Animal.Spawn()
    public static void Spawn()
    {
    }
}
