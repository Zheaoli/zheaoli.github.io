---
title: 容器 CPU 和 Memory 限制行为简述
type: tags
date: 2022-08-08 00:00:00
tags: [编程,Linux,容器]
categories: [编程,Linux]
toc: true
---

这篇是给之前没啥容器经验的选手准备的一篇文章，主要是讲一下容器的 CPU 和 Memory 限制行为。

<!--more-->

## CPU 限制

首先 Mac 或者是 Windows 选手在使用 Docker Desktop 的时候，会设置 Docker Desktop 的 CPU 限制，默认是 1，也就是说 Docker Desktop 只能使用 1 个 CPU。这是因为 Docker Desktop 裹了一层虚拟机（Windows 下应该是 WSL2/Hyper-V，Mac 下可能是 QEMU）。这相当于我们在一个特定 CPU 数量的宿主机中跑 Docker

首先提到 CPU 限制，本质上是限制进程的 CPU 使用的时间片，在 Linux 下，进程存在三种调度优先级

1. SCHED_NORMAL
2. SCHED_FIFO
3. SCHED_RR

1 用的是 Linux 中 CFS 调度器，而常见普通进程都是 SCHED_NORMAL 。OK 前提知识带过

说回容器中的 CPU 限制，目前主流语境下，容器特指以 Docker 为代表的一系列的基于 Linux 中 CGroup 和 Namespace 进行隔离的技术方案。那么在这个语境下，CPU 限制的实现利用了Linux CGroup 中三个 CPU Subsystem。我们主要关心的如下四个参数

1. cpu.cfs_period_us
2. cpu.cfs_quota_us
3. cpu.shares
4. cpuset.cpus

现在分别来聊一下

首先说 cpu.shares，在 Docker 中的使用参数是 --cpu-shares，本质上是一个下限的软限制，用来设定 CPU 的利用率权重。默认值是 1024。这里对于相对值可能理解有点抽象。那么我们来看个例子 假如一个 1core 的主机运行 3 个 container，其中一个 cpu-shares 设置为 1024，而其它 cpu-shares 被设置成 512。当 3 个容器中的进程尝试使用 100% CPU 的时候（因为 cpu.shares 针对的是下限，只有使用 100% CPU 很重要，此时才可以体现设置值），则设置 1024 的容器会占用 50% 的 CPU 时间。那再举个例子，之前这个场景，其余的两个容器如果都没有太多任务，那么空余出来的 CPU 时间，是可以继续被第一个 1024 的容器继续使用的

接下来聊一下 cpu.cfs_quota_us 和 cpu.cfs_period_us ，这两个是需要组合使用才能生效，本质上含义是在 cpu.cfs_period_us 的单位时间内，进程最多可以利用 cpu.cfs_quota_us （单位都是 us），如果 quota 耗尽，那么进程会被内核 throttle 。在 Docker 下，你可以利用 --cpu-period 和 --cpu-quota 这两个值分别进行设置。也可以通过 --cpu 来进行设置，当我们设置 --cpu 为 2 的时候，容器会保证 cpu.cfs_quota_us 两倍于 cpu.cfs_period_us，剩下的就以此类推了（Docker 默认的 cpu.cfs_period_us 的阈值是 100ms 即 10000us）

现在已经聊了三个参数了，那么我们什么时候该用什么参数呢。通常来说，对于性能相对敏感的进程，我们可以使用 cpu.shares 来保证进程尽可能多的使用 CPU），业务进程可以利用 cpu.cfs_quota_us 和 cpu.cfs_period_us 来保证相对较好的公平分配。但是这样也带来一个问题，就是对于业务流量比较大的应用，可能会因为频繁被 throtlle 导致我们的 RT 等指标出现毛刺。Linux 5.12 之后有了一个新功能，cpu.cfs_burst_us ，即进程可以在 CPU 利用率比较低的空闲时段积累一定的 credit，然后在密集使用的时候换取一定的 buffer，实现更少的 throttle 和更高的 CPU 利用率（当然这个特性还暂时没有被主流容器所完全支持）

现在新的问题来了，无论 share 还是 cpu.cfs_quota_us 和 cpu.cfs_period_us 被 throttle 的概率都不少，如果我们想让进程更好的利用 CPU 怎么办？答案就是 cpuset.cpus ，Docker 中的参数是 --cpuset-cpus，可以让进程进行绑核处理

嗯，CPU 的部分就到这里

## Mem 限制

还是前提科普

首先 Mac 或者是 Windows 选手在使用 Docker Desktop 的时候，会设置 Docker Desktop 的 Mem 限制，这相当于我们在一个特定 Mem 数量的宿主机中跑 Docker

然后在我们今天的语境下，Mem 资源的限制还是依托于 CGroup 的 Memory Subsystem，参数有很多，我们目前只需要关心

1. memory.limit_in_bytes

含义即是容器的最大内存限制，如果设置为 -1，代表着无任何内存的限制。在 Docker 中的参数是 --memory。

行为的话分为这样两种情况

1. 如果系统内存还有空余，但是容器内存超过了 Limit, 那么容器进程会被 OOMKiller Kill 掉
2. 如果系统内存先于容器达到了内核阈值，那么 OOMKiller 会在整个系统范围内根据根据负载等多个因素计算一个 score，然后 rank 后从高到低进行 OOM Kill 的操作

当然实际上还有一种额外的情况。可以通过 --oom-kill-disable 参数设置 memory.oom_control 的值。如果设置为1，那么容器内存超过 Limit 就不会被 OOM Kill 掉而是会被暂停，如果设置为0，那么容器内存超过 Limit 就会被 OOM Kill 掉

嗯关于 Mem 的行为差不多就这些

## 总结

差不多就这样吧，纯新手向的文章，水文一篇，大家别介意（
