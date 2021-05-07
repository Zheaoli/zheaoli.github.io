---
title: Linux 上关于 inotify 的小笔记
type: tags
date: 2019-07-02 21:35:00
tags: [Linux,编程,随笔,总结]
categories: [编程,Linux]
toc: true
---

最近还是无心写啥文章，说好的写几篇关于 Raft 的论文也因为一些事 delay 了。但是想了想还是准备写点什么，于是写个小的水文来记录下关于今天碰到的一个 Linux 内核参数的问题， 顺便做个笔记

<!-- more -->

## 开始

我是一个不太喜欢 Mac 的人，所以我自己在家使用的开发环境是 Manjaro（这里打个广告，非常棒的发行版，堪称开箱即用，广告五毛一条）。然后代码工具就是 Jetbrains 的全家桶和 VSCode 搭配使用。

今天打开 Goland 的时候，发现 IDE 给了这样一个 Warning ，`External file changes sync may be slow: The current inotify(7) watch limit is too low.`

于是大家知道，我是个看着这些 warning 有强迫症的人，于是我就去查了查

## 简单聊聊

我们平常经常会有需求，去监控一个文件或者一个目录下的变化，比如创建文件，删除文件等。我们常规的做法可能是一个直接暴力轮询的方式来做

但是这样的性能会极差。那么我们有没有什么手段来处理一下这个事么？

有的！ Linux 提供了对应的 API 来处理这事，这就是我们今天要聊到的 `inotify`

按照官方的说法，`inotify` 其实很简单，

> The inotify API provides a mechanism for monitoring file system events. Inotify can be used to monitor individual files, or to monitor directories. When a directory is monitored, inotify will return events for the directory itself, and for files inside the directory.

大意就是说 `inotify` 是用来监控文件系统事件的。可以使用在单个文件或者目录上。被监听的文件目录本身的变化或者内部文件的变化都在监听范围内。

在监听了对应的文件后，`inotify` 将返回如下事件 

1. IN_ACCESS 文件可读

2. IN_ATTRIB 元数据变化

3. IN_CLOSE_WRITE File opened for writing was closed

4. IN_CLOSE_NOWRITE File not opened for writing was closed

5. IN_CREATE 被监听的目录下有文件/目录被创建

6. IN_DELETE 被监听的目录下有文件/目录被删除

7. IN_DELETE_SELF 被监听的文件/目录被删除

8. IN_MODIFY 文件被修改

9. IN_MOVE_SELF 被监听的文件/目录被移动

10. IN_MOVED_FROM 有文件/目录从被监听的目录中被移出

11. IN_MOVED_TO 有文件/目录移动至被监听的目录中

12. IN_OPEN 文件被打开

总共12类事件，已经能涵盖住我们常见的需求。但是 `inotify` 也有其自己的弊端。

1. 不支持递归监听。举个例子，我监听 A 目录，我可以捕获到在 A 目录下创建 B 目录这个事件。但是我们没法监听到 B 目录下事件，除非将 B 目录也添加到监听队列中

2. Python 可用的 inotify 很少

对于第一个缺陷。常见的解决手段，是我们自行实现递归监听。当主目录下存在创建文件/目录事件的时候，我们将对应的文件/目录也添加到监听队列中。

但是这样就带来一个新的问题。如果一个非常大的项目，我们按照这样的方式去做，那么最后对应的内存损耗是很吓人的。所以在 `inotify` 设计之初，就通过一些内核参数做了一些限制

我们常见的有两个

1. /proc/sys/fs/inotify/max_queued_events  限制事件队列长度，一旦出现事件堆积，那么新的事件将被废弃

2. /proc/sys/fs/inotify/max_user_watches 限制每个 User ID 能够创建的 watcher 数，以免监听过多导致内存爆炸

在默认情况下 `max_user_watches` 的值取决于不同的 Linux 发行版，对于大多数发行版而言，其值相对较小。也就是说一旦达到限制，那么将没法添加新的 watcher。这也是 IDE 为什么会提示
`External file changes sync may be slow: The current inotify(7) watch limit is too low.` 的原因

可以通过修改 `/etc/sysctl.conf` 来修改对应的参数，最后解决这个问题

## 最后

Linux 果然是个宝库。感觉隔三差五就会遇到自己没涉及到的东西。所以还是记录下来，当作一篇水文，顺便供自己参阅

