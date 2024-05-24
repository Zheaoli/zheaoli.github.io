---
title: 实现 NES 中的一些笔记：nametable 的 mirror 计算
type: tags
date: 2024-05-25 01:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,计算机体系,汇编]
toc: true
---

随便记录一些写 NES 中的笔记，这次写一下关于 nametable 的 mirror 计算。

<!--more-->

## 正文

NES 红白机的渲染过程相对来说比较复杂，为了讲今天的 mirror 计算，大致科普一下一些信息

1. 首先我们屏幕显示的分辨率为 256*240，然后我们最基本的渲染单元为 tile，一个 tile 为8个像素，意味着我们一个屏幕上有 32*30 个 tile
2. 我们屏幕上显示的背景图案是存放在 Pattern Table 中的，Pattern Table 映射到 CHR 中，可能是 RAM 也可能是 ROM，取决于 Mapper 的实现
3. 我们为了在屏幕上显示合理的图案，我们需要一个 Index 去索引每个 Tile 的图案在 Pattern Table 中的位置。现在 32*30 个 tile，我们需要 32*30 个 8bit 的 Index，也就是 960 Byte 的数据。然后我们用剩下的 64 Byte 的数据来存放 Attribute Table，Attribute Table 用来存放每个 tile 的属性，比如颜色，是否翻转等等

通常来说，我们 NES 里面设计了四个 nametable，理论上的空间是 4KB 的空间。但是实际上我们内置的 PPU 的 VRAM 只有 2KB（除非特定的 Mapper 支持映射到 4KB 或者更大），可能一些同学已经想到了，因为大部分游戏背景是重复的，所以我们可以复用背景，所以我们需要做 mirror 计算

我们四个 nametables 的布局是这样的

| A | B |
|---|---|
| C | D |

为了方便我们后面描述，我们起始地址设置为 0x00（实际上是 0x2000）

1. A: 0x00 ~ 0x3FF
2. B: 0x400 ~ 0x7FF
3. C: 0x800 ~ 0xBFF
4. D: 0xC00 ~ 0xFFF

我们常见有两种 mirror 计算方式

1. 垂直镜像，将 C 映射到 A，D 映射到 B
2. 水平镜像，将 B 映射到 A，D 映射到 C

那么这个地址的换算逻辑怎么写呢？

我们最开始直观观察，我们可以发现，这个实际上是有两个 table 映射到 0x00 到 0x400 空间，剩下两个映射到 0x400 到 0x800 空间

那么我们很简单了，最暴利的方法是直接用哈希表来算

```python
import enum

INDEX = [[0, 0, 1, 1], [0, 1, 0, 1]]


class Direction(enum.IntEnum):
    Horizontal = 0
    Vertical = 1


def mirror_lookup(direction: Direction, address: int) -> int:
    page = address // 0x400
    offset = address % 0x400
    return INDEX[direction][page] * 0x400 + offset
```

很简单的操作，我们根据传入的地址除以 0x400 来判断是哪个 page，然后根据 direction + page 来判断是映射到哪个区间，然后返回新的地址

这样就可以了吗？

我们看下我们上面的代码，需要一个额外的空间来存储映射关系，以及需要两次额外的寻址操作。在70年代这寸土寸金的地方，毫无疑问是无法接受的

那么我们有没有更好的方法呢？

有！

我们先来看垂直镜像，我们可以发现 A 和 C 的地址是一样的，B 和 D 的地址是一样的，那么实际上，这里我们可以转化为一个简单的对于 0x800 的取模运算

那么水平镜像的代码怎么写呢？我们可以这样想一下

我们现在布局可以想象为一个 800 \* 800 的矩阵，我们可以先缩小为 400 \* 400 的矩阵。即我们 A 到 B 取值范围就缩小为 0x00 到 0x3FF，同时我们 C 到 D 的取值范围也缩小为 0x400 到 0x7FF。这个时候，我们就能发现我们利用位运算 `&` 的性质，和 0x400 做与运算，我们就能得到 A 和 B 两个区间的基准起始地址 0x00 以及 C 和 D 两个区间的基准起始地址 0x400。最后加上模运算的结果，我们就能得到新的地址

```python

def mirror_lookup_new(direction: Direction, address: int) -> int:
    if direction == Direction.Vertical:
        return address % (2 * 0x400)
    return ((address>>1) & 0x400) + (address % 0x400)
```

最后我们来跑一个 benchmark

```python
print(
    timeit.repeat(lambda: mirror_lookup(Direction.Horizontal, 0x401), number=10000000)
)
print(
    timeit.repeat(
        lambda: mirror_lookup_new(Direction.Horizontal, 0x401),
        number=10000000,
    )
)
```

结果是

```text
print(
    timeit.repeat(lambda: mirror_lookup(Direction.Horizontal, 0x401), number=10000000)
)
print(
    timeit.repeat(
        lambda: mirror_lookup_new(Direction.Horizontal, 0x401),
        number=10000000,
    )
)

```

我？？？哦，突然想起，Python 中位运算不一定快。这个时候我赶紧用 C 写了个版本进行测试

```C
#include <stdio.h>
#include <stdint.h>
#include <sys/time.h>

#define PAGE_SIZE 0x400

typedef enum {
    Horizontal = 0,
    Vertical = 1
} Direction;

int INDEX[2][4] = {{0, 0, 1, 1}, {0, 1, 0, 1}}; // Declare INDEX globally

int mirror_lookup(Direction direction, int address) {
    int page = address / PAGE_SIZE;
    int offset = address % PAGE_SIZE;
    return INDEX[direction][page] * PAGE_SIZE + offset;
}

int mirror_lookup_new(Direction direction, int address) {
    if (direction == Vertical) {
        return address % (2 * PAGE_SIZE);
    }
    return ((address >> 1) & PAGE_SIZE) + (address % PAGE_SIZE);
}

long long current_time() {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long long)(tv.tv_sec) * 1000000 + tv.tv_usec;
}

int main() {
    // Timing the original function
    long long start1 = current_time();
    for (int i = 0; i < 100000000; i++) {
        mirror_lookup(Horizontal, 0x401);
    }
    long long end1 = current_time();
    printf("Time taken for original function: %lld microseconds\n", end1 - start1);

    // Timing the new function
    long long start2 = current_time();
    for (int i = 0; i < 100000000; i++) {
        mirror_lookup_new(Horizontal, 0x401);
    }
    long long end2 = current_time();
    printf("Time taken for modified function: %lld microseconds\n", end2 - start2);

    return 0;
}

```

结果是

```text
Time taken for original function: 355402 microseconds
Time taken for modified function: 251868 microseconds
```

大概快了百分之30，符合预期

## 总结

很多时候能发现各种古早的系统里为了性能做的各种的 trick，非常好玩。

这里留个思考题

> 我们假设 NES 的 CPU 是理光 6502，CPU 频率 1.79 MHz，我们能否再定量分析下我们实现一个 mirror 流程的两种方法各自需要多少时钟周期？
