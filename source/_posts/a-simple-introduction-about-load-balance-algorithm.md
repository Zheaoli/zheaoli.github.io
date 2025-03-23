---
title: 简单聊聊常见的负载均衡算法
type: tags
date: 2025-03-23 20:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,网络]
toc: true
cover: /images/pixai-1860500966642493859-3.png
---

这篇文章鸽了很久，最终决定还是老老实实写完，来介绍一下常见的一些负载均衡算法实现。本文的代码最终都会放在 **load-balancer-algorithm**[<sup>1</sup>](#refer-anchor-1) 这个 repo 中

~~我从来没有觉得写博客快乐过~~

<!--more-->

## 正文

### 先行准备

既然是讲 LoadBalancer 中常用的一些负载均衡算法，我们先来对一些前置准备做一些讨论

我们目前需要两个基础的数据结构

1. 代表着 Backend 节点的结构
2. 代表着请求上下文的结构

那么我们可以得出下面一些基础代码

```python
import dataclasses


@dataclasses.dataclass
class Node:
    host: str = ""
    port: int = 0
    node_available: bool = True

    @property
    def available(self) -> bool:
        return self.node_available

import dataclasses


@dataclasses.dataclass
class RequestContext:
    pass

```

同时我们在没有后端节点可供选择的时候，我们需要抛出一个异常

```python
class NoNodesAvailableError(ValueError):
    pass
```

好了，我们现在可以进行更进一步的抽象，我们可以将我们的负载均衡算法抽象为策略(Strategy), 那么我们可以得出如下的一些代码

```python
from __future__ import annotations

import typing
from abc import ABC, abstractmethod

if typing.TYPE_CHECKING:
    from load_balancer_algorithm.context import RequestContext
    from load_balancer_algorithm.node import Node


class Strategy(ABC):
    nodes: list[Node] = []

    def __init__(self, nodes:list[Node]) -> None:
        self.nodes = nodes

    @abstractmethod
    def get_node(self, ctx: RequestContext) -> Node:
        pass

    def add_node(self, node: Node) -> None:
        self.nodes.append(node)

    def remove_node(self, node: Node) -> None:
        self.nodes= list(filter(lambda n: n != node, self.nodes))
```

好了，我们现在可以往下去实现一些负载均衡算法了

### 随机选择

负载均衡最简单的一个算法是做一个随机的选择，实现非常简单，最简单的伪代码实现差不多这样

```python
a = []
random.choice(a)
```

我们来完整实现一下

```python
class RandomStrategy(Strategy):
    def get_node(self, ctx: RequestContext) -> Node:
        nodes = list(filter(lambda node: node.available, self.nodes))
        if not nodes:
            raise NoNodesAvailableError

        return random.choice(nodes)
```

OK，现在我们增加一个需求，现在我们每个节点都需要有一个权重值，权重值越高的节点被选中的概率越高。我们可以使用 random.choices 来实现这个需求，不过在此之前我们需要对 Node 进行一些修改

```python
import dataclasses


@dataclasses.dataclass
class Node:
    host: str = ""
    port: int = 0
    node_available: bool = True
    weight: int = 0

    @property
    def available(self) -> bool:
        return self.node_available
```

然后我们来实现一下 WeightedRandomStrategy

```python

class WeightedRandomStrategy(Strategy):
    def get_node(self, ctx: RequestContext) -> Node:
        nodes = list(filter(lambda node: node.available, self.nodes))
        if not nodes:
            raise NoNodesAvailableError

        weights = [node.weight for node in nodes]
        return random.choices(nodes, weights=weights)[0]
```

Random 确实是我们非常常用的一套负载均衡算法，但是缺点也很明显，其负载均衡的效果有一定的不可预测性，是神是鬼全靠你使用的 Random 函数的质量。运气不好就会出现分布非常密集的情况。那么我们有没有可用的更好的负载均衡算法呢？

### 轮询算法

我们对于负载均衡算法常见的需求是在逻辑上有一定的可预测性，从这角度上讲，轮询算法是一个非常好的选择。我们可以使用一个 index 来记录当前的节点，然后每次请求的时候都将 index + 1，直到 index 超过节点的数量，然后 index = 0

```python
class RoundRobinStrategy(Strategy):
    def __init__(self, nodes: list[Node]) -> None:
        super().__init__(nodes)
        self.index = 0

    def get_node(self, ctx: RequestContext) -> Node:
        nodes = list(filter(lambda node: node.available, self.nodes))
        if not nodes:
            raise NoNodesAvailableError

        node = nodes[self.index]
        self.index += 1
        if self.index >= len(nodes):
            self.index = 0

        return node
```

这里我们实现了一个最基础的轮询算法（我们假设不存在节点不可用，节点增删改的情况），所以我们 index 一直可以有规律的变化

这里的结果很明显，如果有一个 [A, B] 的节点列表，那么我们会得到一个 [A, B, A, B, A, B] 的结果

那么现在我们更改一下需求，我们需要实现一个类似 WeightedRandomStrategy 的轮询算法，权重越高的节点被选中的概率越高。

```python
class WeightedRoundRobinStrategy(Strategy):
    def __init__(self, nodes: list[Node]) -> None:
        super().__init__(nodes)
        self.index = 0
    
    def get_node(self, ctx: RequestContext) -> Node:
        nodes = list(filter(lambda node: node.available, self.nodes))
    
        if not nodes:
            raise NoNodesAvailableError
        nodes=[node for node in nodes for _ in range(node.weight)]
        node = nodes[self.index]
        self.index += 1
        if self.index >= len(nodes):
            self.index = 0
        return node
```

这里的核心算法很简单，我们基于每个节点的权重，得到一个扩展后的节点列表，然后我们就可以使用最基础的轮询算法来实现了

但是这里核心的一个弊端很明显，假设我们有 [A(weight=2),B(weight=1)] 这样一个节点组合，我们会得到 [A, A, B] 这样一个选择结果，这里的节点分布会非常不均匀。那么怎么办呢？我们可以参考一种来自 Nginx 的平滑算法[<sup>2</sup>](#refer-anchor-2)

我们首先给节点加上一个 current_weight 的熟悉，记录当前节点的权重值

```python
import dataclasses


@dataclasses.dataclass
class Node:
    host: str = ""
    port: int = 0
    node_available: bool = True
    weight = 0
    current_weight: int = 0

    @property
    def available(self) -> bool:
        return self.node_available

    def __post_init__(self):
        self.current_weight = self.weight

```

然后我们来实现一下 WeightedRoundRobinStrategy

```python
class WeightedRoundRobinStrategy(RoundRobinStrategy):
    def get_node(self, ctx: RequestContext) -> Node:
        nodes = list(filter(lambda node: node.available, self.nodes))
        if not nodes:
            raise NoNodesAvailableError
        best_node = None
        total = 0
        for node in nodes:
            total += node.weight
            if not best_node or node.weight > best_node.weight:
                best_node = node
        if not best_node:
            raise NoNodesAvailableError
        best_node.weight -= total
        return best_node
```

这里新增的 current_weight 的作用很简单，

- 每次选取节点时，遍历可用节点，遍历时把当前节点的 current_weight 的值加上它的 weight
- 同时累加所有节点的 weight 值为 total 。
- 如果当前节点的 current_weight 值最大，那么这个节点就是被选中的节点，同时把它的 current_weight 减去 total
- 没有被选中的节点的 current_weight 不用减少。

这本质上其实很巧妙的将节点打散，同时将 index 的属性利用 current_weight 来处理，经过处理，我们假设有 [A(weight=3),B(weight=2),C(weight=1)] 这样一个节点组合，我们会得到 [A, B, A, C, B, A] 这样一个选择结果，这里的节点分布会相对均匀很多

OK，现在我们轮询函数实现完成了，我们能发现，Random 和轮询算法本质上是两种无状态的算法（最原始的 RoundRobin 有状态，但是我们通过 current_weight 的方式将其变成了无状态），但是我们通常在业务上会有一些根据状态来选择节点的需求，常见的场景有

1. 我们需要请求去往目前负载最低的节点
2. 某一类请求我们需要去往同一个节点

因此下面我们会来介绍两种算法

1. 最小链接/加权最小链接
2. 一致性 Hash 算法

### 最小链接算法

最小链接算法是一个非常简单的算法，我们需要在每次请求的时候，遍历所有的节点，找到当前连接数最少的节点，然后将请求转发到这个节点上。我们可以使用一个连接数的属性来记录当前节点的连接数

```python
class LeastConnectionStrategy(Strategy):
    def get_node(self, ctx: RequestContext) -> Node:
        best = None
        for node in self.nodes:
            if not node.available:
                continue
            if not best or node.connections < best.connections:
                best = node
        if not best:
            raise NoNodesAvailableError
        best.connections += 1
        return best
```

OK，那么我们接下来老规矩需要考虑加权的 LeastConnection 算法，这里稍晚有一点绕

- 假设用 C 表示连接数、W 表示权重、S 表示被选中的节点、Sn 表示未被选中的节点
- 那么 S 必须满足 C(S) / W(S) < C(Sn) / W(Sn) ，这个条件也可以表示为 C(S) x W(Sn) < C(Sn) x W(S)

那么我们来实现一下

```python
class WeightedLeastConnectionStrategy(LeastConnectionStrategy):
    def get_node(self, ctx: RequestContext) -> Node:
        best = None
        for node in self.nodes:
            if not node.available:
                continue
            if not best or (node.connections / node.weight) < (best.connections / best.weight):
                best = node
        if not best:
            raise NoNodesAvailableError
        best.connections += 1
        return best
```

当然我们这里实际上有一点问题是，这里的选择可能会连续选择到同一个节点上（因为权重的不均匀），这里可以考虑把符合条件的节点放到一个列表中，然后使用我们前面提到过的 RoundRobin/Random 来选择一个节点来进行请求转发

这里我就不实现了，大家可以自己实现一下

### 一致性 Hash 算法

我们在业务中经常有这样一种需求，我们需要将同一类请求转发到同一个节点上，这个时候我们就需要使用一致性 Hash 算法来实现了

最基础的一致性 Hash 算法是将请求的 key 和节点的 key 进行 hash 计算，然后将请求转发到 hash 值最接近的节点上。我们可以使用一个 ring 来表示所有的节点，然后在 ring 上找到离请求最近的节点。

但是这样存在比较大的问题是，如果有节点的增删改，这个时候我们已经分配好的逻辑会存在 rebalance 的问题。所以我们需要将这个变动变得最小。

目前主流的几种一致性 Hash 算法的核心思路都是通过虚拟节点来解决这个问题。我们可以将每个节点映射到多个虚拟节点上，然后在 ring 上找到离请求最近的虚拟节点，然后将请求转发到对应的真实节点上。

这样我们就可以将节点的增删改对请求的影响降到最低。

我们将以 Google 的 Maglev 算法为基础来实现一致性 Hash 算法

首先我们更改一下 Node 的代码

```python
import dataclasses


@dataclasses.dataclass
class Node:
    host: str = ""
    port: int = 0
    node_available: bool = True
    weight: int = 0
    current_weight: int = 0
    connections: int = 0

    @property
    def available(self) -> bool:
        return self.node_available

    def __str__(self) -> str:
        return f"{self.host}:{self.port}"
```

这里我们可以用 str(node) 来获取 nodekey

然后我们来介绍一下 Maglev 算法的核心思路（这里只介绍最简化版本的细节，详情可以参考 Maglev: A Fast and Reliable Software Network Load Balancer[<sup>3</sup>](#refer-anchor-3)）这篇论文

首先，我们要确定经过预处理后的产物 **lookup table** 的长度 M。所有 Key 都会被 hash 到这个 **lookup table** 中去，而 **lookup table** 中的每个元素都会被映射到一个 Node 上

而计算 **lookup table** 的计算分为两步

- 计算每一个 node 对于每一个 **lookup table** 项的一个取值（也就是原文中提到的 permutation）；
- 根据这个值，去计算每一个 **lookup table** 项所映射到的 node（放在 entry 中，此处 entry 用原文的话来讲就是叫做 the final lookup table）。

permutation 是一个 N*M 的矩阵，列对应 **lookup table**，行对应 node。 为了计算 permutation，需要挑选两个 hash 算法，分别计算两个值 offset 与 skip 。最后根据 offset 和 skip 的值来填充 permutation，计算方式描述如下：

1. offset = hash1(name[i]) mod M
2. skip = hash2(name[i]) mod (M − 1)+ 1
3. permutation[i][j] = (offset+ j × skip) mod M

其中 hash1 和 hash2 是两个不同的 hash 函数，我们后续会使用 xxhash 和 mmh3 这两种 hash 函数来实现

然后我们可以给出 lookup table 的计算方式

```python
def calculate_lookup_table(n: int, m: int, permutation: list[list[int]]) -> list[int]:
    # result 是最终记录分布的 Hash 表
    result: list[int] = [-1] * m
    # next 是用来解决冲突的，在遍历过程中突然想要填入的 entry 表已经被占用，
    # 则通过 next 找到下一行。一直进行该过程直到找到一个空位。
    # 因为每一列都包含有 0~M-1 的每一个值，所以最终肯定能遍历完每一行。
    # 计算复杂度为 O(M logM) ~ O(M^2)
    next: list[int] = [0] * n
    flag = 0
    while True:
        for i in range(n):
            x = permutation[i][next[i]]
            while True:
                # 找到空位，退出查找
                if result[x] == -1:
                    break
                next[i] += 1
                x = permutation[i][next[i]]
            result[x] = i
            next[i] += 1
            flag += 1
            # 表已经填满，退出计算
            if flag == m:
                return result
```

在这里我们能看到，这段循环代码必然结束，而最坏情况下，复杂度会非常高，最坏的情况可能会到 O(M^2)。原文中建议找一个远大于 N 的 M （To avoid this happening we always choose M such that M ≫ N.）可以使平均复杂度维持在 O(MlogM)

我们可以用论文中的图来评估下如果节点存在移除的情况，整体的 rebalance 的效果

![Maglev](https://user-images.githubusercontent.com/7054676/82696622-f73b2800-9c99-11ea-8d14-08f67487f3b9.png)

我们现在来完整实现一下 Maglev 算法，我们先确定用请求中的 url 来作为 hash key，所以我们需要对 RequestContext 进行一些修改

```python
import dataclasses


@dataclasses.dataclass
class RequestContext:
    url: str = ""
```

好了，来把剩下的部分实现了

```Python
M = 65537


class MaglevStrategy(Strategy):
    @staticmethod
    def calculate_lookup_table(n: int, m: int, permutations: list[list[int]]) -> list[int]:
        # result 是最终记录分布的 Hash 表
        result: list[int] = [-1] * m
        # next 是用来解决冲突的，在遍历过程中突然想要填入的 entry 表已经被占用，
        # 则通过 next 找到下一行。一直进行该过程直到找到一个空位。
        # 因为每一列都包含有 0~M-1 的每一个值，所以最终肯定能遍历完每一行。
        # 计算复杂度为 O(M logM) ~ O(M^2)
        next: list[int] = [0] * n
        flag = 0
        while True:
            for i in range(n):
                x = permutations[i][next[i]]
                while True:
                    # 找到空位，退出查找
                    if result[x] == -1:
                        break
                    next[i] += 1
                    x = permutations[i][next[i]]
                result[x] = i
                next[i] += 1
                flag += 1
                # 表已经填满，退出计算
                if flag == m:
                    return result

    def __init__(self, nodes: list[Node]) -> None:
        super().__init__(nodes)
        permutations = []
        for i in range(len(nodes)):
            permutation = [0] * M
            offset = mmh3.hash(str(nodes[i])) % M
            skip = (xxhash.xxh32(str(nodes[i])).intdigest() % (M - 1)) + 1
            for j in range(M):
                permutation[j] = (offset + j * skip) % M
            permutations.append(permutation)
        self.tables = self.calculate_lookup_table(len(nodes), M, permutations)

    def get_node(self, ctx: RequestContext) -> Node:
        hash_value = mmh3.hash(str(ctx))
        index = hash_value % M
        node_index = self.tables[index]
        return self.nodes[node_index]
```

如果大家对 Google 整个 Maglev 系统感兴趣，可以去参考一篇我之前写博客，简单聊聊 Maglev ，来自 Google 的软负载均衡实践[<sup>4</sup>](#refer-anchor-4)

## 总结

好了，这次负载均衡算法告一段落，其实工作中还有一些更组合的场景，比如 sharding 轮询之类的，不过整体思路都不会发生太大变化。希望大家看的开心

## Reference

<div id="refer-anchor-1"></div>

- <https://github.com/Zheaoli/load-balancer-algorithm>

<div id="refer-anchor-2"></div>

- <https://github.com/nginx/nginx/commit/52327e0627f49dbda1e8db695e63a4b0af4448b1>

<div id="refer-anchor-3"></div>

- <https://research.google/pubs/maglev-a-fast-and-reliable-software-network-load-balancer/>

<div id="refer-anchor-4"></div>

- <https://www.manjusaka.blog/posts/2020/05/22/a-simple-introduction-about-maglev>
