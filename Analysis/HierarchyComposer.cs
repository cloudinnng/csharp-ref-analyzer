using CsharpRefAnalyzer.Models;

namespace CsharpRefAnalyzer.Analysis;

/// <summary>根据引用图构建调用层级与环检测</summary>
public static class HierarchyComposer
{
    /// <summary>调用树节点（前端按需构建，此处提供辅助）</summary>
    public sealed class TreeNode
    {
        public required string ClassId { get; init; }
        public required ReferenceKind Kind { get; init; }
        public List<TreeNode> Children { get; } = [];
        public bool Truncated { get; set; }
    }

    public const int MaxTreeNodes = 200;
    public const int DefaultMaxDepth = 5;

    #region 分层与环

    /// <summary>将引用图转为 AnalysisResultDto 的分层与环信息（按最长调用链深度分层）</summary>
    public static (List<LayerDto> Layers, List<List<string>> Cycles) ComposeLayers(
        Dictionary<string, ClassNodeDto> classes,
        List<ReferenceEdgeDto> references)
    {
        if (classes.Count == 0)
        {
            return ([], []);
        }

        Dictionary<string, HashSet<string>> outgoing = BuildAdjacency(references, forward: true);
        Dictionary<string, HashSet<string>> incoming = BuildAdjacency(references, forward: false);
        List<List<string>> cycles = DetectCycles(classes.Keys, outgoing);
        HashSet<string> cycleNodeIds = cycles.SelectMany(c => c).ToHashSet(StringComparer.Ordinal);

        Dictionary<string, int> inDegree = classes.Keys.ToDictionary(
            id => id,
            id => incoming.TryGetValue(id, out HashSet<string>? set) ? set.Count : 0);

        // 深度 = 从入口沿引用边向下的最长步数（第 0 层 = 文件夹内无人引用的顶层类）
        Dictionary<string, int> depth = classes.Keys.ToDictionary(id => id, _ => 0);
        Dictionary<string, int> remaining = new(inDegree, StringComparer.Ordinal);

        Queue<string> queue = new(inDegree.Where(kv => kv.Value == 0).Select(kv => kv.Key).OrderBy(k => k, StringComparer.Ordinal));

        if (queue.Count == 0)
        {
            string pseudoRoot = classes.Keys.OrderBy(k => k, StringComparer.Ordinal).First();
            queue.Enqueue(pseudoRoot);
            remaining[pseudoRoot] = 0;
        }

        while (queue.Count > 0)
        {
            string id = queue.Dequeue();

            if (!outgoing.TryGetValue(id, out HashSet<string>? targets))
            {
                continue;
            }

            foreach (string target in targets.OrderBy(t => t, StringComparer.Ordinal))
            {
                depth[target] = Math.Max(depth[target], depth[id] + 1);
                remaining[target]--;
                if (remaining[target] == 0)
                {
                    queue.Enqueue(target);
                }
            }
        }

        // 环内/剩余节点：多轮松弛（跳过 SCC 内部边，避免 Cycle1↔Cycle2 互相抬深度）
        for (int pass = 0; pass < classes.Count; pass++)
        {
            bool changed = false;
            foreach (ReferenceEdgeDto edge in references)
            {
                if (cycleNodeIds.Contains(edge.FromId) && cycleNodeIds.Contains(edge.ToId))
                {
                    continue;
                }

                int candidate = depth[edge.FromId] + 1;
                if (candidate > depth[edge.ToId])
                {
                    depth[edge.ToId] = candidate;
                    changed = true;
                }
            }

            if (!changed)
            {
                break;
            }
        }

        // 环内节点：与环外前驱保持同一深度带（取环外前驱最大深度 + 1，环内统一）
        foreach (List<string> scc in cycles)
        {
            if (scc.Count <= 1)
            {
                continue;
            }

            int baseDepth = 0;
            foreach (ReferenceEdgeDto edge in references)
            {
                if (scc.Contains(edge.ToId) && !scc.Contains(edge.FromId))
                {
                    baseDepth = Math.Max(baseDepth, depth[edge.FromId] + 1);
                }
            }

            if (baseDepth == 0 && scc.Any(id => inDegree[id] == 0))
            {
                baseDepth = 0;
            }
            else if (baseDepth == 0)
            {
                baseDepth = scc.Min(id => depth[id]);
            }

            foreach (string id in scc)
            {
                depth[id] = Math.Max(depth[id], baseDepth);
            }
        }

        List<LayerDto> layers = depth
            .GroupBy(kv => kv.Value)
            .OrderBy(g => g.Key)
            .Select(g => new LayerDto
            {
                Level = g.Key,
                ClassIds = g.Select(x => x.Key).OrderBy(x => x, StringComparer.Ordinal).ToList()
            })
            .ToList();

        MarkCycleClasses(classes, cycles);

        Console.WriteLine($"[Hierarchy] {layers.Count} 层 (深度 0~{layers.LastOrDefault()?.Level ?? 0}), {cycles.Count} 个环");

        return (layers, cycles);
    }

    private static Dictionary<string, HashSet<string>> BuildAdjacency(
        List<ReferenceEdgeDto> references,
        bool forward)
    {
        Dictionary<string, HashSet<string>> adj = new(StringComparer.Ordinal);

        foreach (ReferenceEdgeDto edge in references)
        {
            string from = forward ? edge.FromId : edge.ToId;
            string to = forward ? edge.ToId : edge.FromId;

            if (!adj.TryGetValue(from, out HashSet<string>? set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                adj[from] = set;
            }

            set.Add(to);
        }

        return adj;
    }

    /// <summary>Tarjan 强连通分量检测环（大小 &gt; 1 或自环）</summary>
    private static List<List<string>> DetectCycles(
        IEnumerable<string> classIds,
        Dictionary<string, HashSet<string>> outgoing)
    {
        List<string> ids = classIds.OrderBy(x => x, StringComparer.Ordinal).ToList();
        Dictionary<string, int> indexMap = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);

        int[] index = new int[ids.Count];
        int[] lowLink = new int[ids.Count];
        bool[] onStack = new bool[ids.Count];
        Stack<int> stack = new();
        List<List<string>> cycles = [];
        int currentIndex = 0;

        void StrongConnect(int v)
        {
            index[v] = currentIndex;
            lowLink[v] = currentIndex;
            currentIndex++;
            stack.Push(v);
            onStack[v] = true;

            string id = ids[v];
            if (outgoing.TryGetValue(id, out HashSet<string>? targets))
            {
                foreach (string target in targets)
                {
                    if (!indexMap.TryGetValue(target, out int w))
                    {
                        continue;
                    }

                    if (index[w] == -1)
                    {
                        StrongConnect(w);
                        lowLink[v] = Math.Min(lowLink[v], lowLink[w]);
                    }
                    else if (onStack[w])
                    {
                        lowLink[v] = Math.Min(lowLink[v], index[w]);
                    }
                }
            }

            if (lowLink[v] == index[v])
            {
                List<string> scc = [];
                int w;
                do
                {
                    w = stack.Pop();
                    onStack[w] = false;
                    scc.Add(ids[w]);
                } while (w != v);

                if (scc.Count > 1 || (scc.Count == 1 && outgoing.TryGetValue(scc[0], out HashSet<string>? self) && self.Contains(scc[0])))
                {
                    cycles.Add(scc.OrderBy(x => x, StringComparer.Ordinal).ToList());
                }
            }
        }

        for (int i = 0; i < ids.Count; i++)
        {
            index[i] = -1;
        }

        for (int i = 0; i < ids.Count; i++)
        {
            if (index[i] == -1)
            {
                StrongConnect(i);
            }
        }

        return cycles;
    }

    private static void MarkCycleClasses(Dictionary<string, ClassNodeDto> classes, List<List<string>> cycles)
    {
        HashSet<string> inCycle = cycles.SelectMany(c => c).ToHashSet(StringComparer.Ordinal);
        foreach (string id in inCycle)
        {
            if (classes.TryGetValue(id, out ClassNodeDto? node))
            {
                node.InCycle = true;
            }
        }
    }

    #endregion

    #region 调用树

    /// <summary>以 rootId 为根构建向下调用树</summary>
    public static TreeNode BuildCallTree(
        string rootId,
        List<ReferenceEdgeDto> references,
        int maxDepth = DefaultMaxDepth,
        int maxNodes = MaxTreeNodes)
    {
        Dictionary<string, List<ReferenceEdgeDto>> outgoing = references
            .GroupBy(r => r.FromId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        TreeNode root = new() { ClassId = rootId, Kind = ReferenceKind.Uses };
        HashSet<string> visited = new(StringComparer.Ordinal) { rootId };
        int nodeCount = 1;

        BuildTreeRecursive(root, outgoing, 0, maxDepth, maxNodes, visited, ref nodeCount);
        return root;
    }

    private static void BuildTreeRecursive(
        TreeNode node,
        Dictionary<string, List<ReferenceEdgeDto>> outgoing,
        int depth,
        int maxDepth,
        int maxNodes,
        HashSet<string> visited,
        ref int nodeCount)
    {
        if (depth >= maxDepth || nodeCount >= maxNodes)
        {
            if (depth >= maxDepth && outgoing.ContainsKey(node.ClassId))
            {
                node.Truncated = true;
            }

            return;
        }

        if (!outgoing.TryGetValue(node.ClassId, out List<ReferenceEdgeDto>? edges))
        {
            return;
        }

        foreach (ReferenceEdgeDto edge in edges.OrderBy(e => e.ToId).ThenBy(e => e.Kind))
        {
            if (nodeCount >= maxNodes)
            {
                node.Truncated = true;
                return;
            }

            TreeNode child = new() { ClassId = edge.ToId, Kind = edge.Kind };
            node.Children.Add(child);
            nodeCount++;

            if (visited.Add(edge.ToId))
            {
                BuildTreeRecursive(child, outgoing, depth + 1, maxDepth, maxNodes, visited, ref nodeCount);
                visited.Remove(edge.ToId);
            }
        }
    }

    #endregion
}
