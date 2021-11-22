---
title: 聊聊 sk_buff 中一个冷门字段: nohdr
type: tags
date: 2021-11-22 21:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

今天遇到一个很有意思的问题，“nohdr 字段到底有什么用”，在这里写个水文简单记录一下

<!--more-->

## 正文

### 前情提要

首先来说，不管介绍再冷门的字段，既然涉及到 SKBUFF ，那么就得先来对 sk_buff 做个简单的介绍

简而言之，sk_buff 是 Linux 网络子系统的核心数据结构，从链路层到我们最终对数据包的操作，背后都离不开 sk_buff 

sk_buff 要完全讲解基本就相当于把 Linux 网络系统完全讲解了，所以讲完是不可能讲完的，这辈子都不可能的！

简单聊几个关键，可能会帮助大家理解我们本文提到的冷门字段 nohdr 的关键字段吧

首先来讲，最重要的三个字段：`data` ，`mac` 和 `nh` ，分别代表着当前 sk_buff 的数据区的起始地址，L2 header 的起始地址，L3 Header 的起始地址。用一个图方便大家理解

![sk_buff 三剑客](https://user-images.githubusercontent.com/7054676/142876157-422a2115-15bb-4b9e-8ed7-9335c09b695f.png)

看了图的同学可能会有点明白了，实际上在内核里，也是一层一层的通过指针偏移，不断的添加新的 header 来处理网络请求。和我们直觉相符。可能有同学会问，我既然知道 L3 Header 的起始地址，IP 之类的 L3 协议的 header 长度是固定的。我是不是可以算出 L4 的偏移，然后手动处理。

Bingo，内核里有 `tcphdr` 的数据结构（对应 IP 是 `iphdr` ），你根据偏移，手动 cast 就可以手动处理。不过详细做法以后再聊

接着两个比较重要的字段，是 `len` 和 `data_len` ，这两个字段都是标识数据长度，但是简要来说，len 代表着当前 sk_buff 所有数据的长度（即包含当前协议的 header 和 payload），data_len 代表当前有效数据长度（即当前协议 payload 长度）

OK，前情提要到此结束

### 关于 nohdr

花开两朵，各表一支。聊了 sk_buff 一些预备知识，我们来聊一下 `nohdr` 这个字段。说实话这个字段真的很冷门

首先官方对此有对应描述

> The 'nohdr' field is used in the support of TCP Segmentation Offload ('TSO' for short). Most devices supporting this feature need to make some minor modifications to the TCP and IP headers of an outgoing packet to get it in the right form for the hardware to process. We do not want these modifications to be seen by packet sniffers and the like. So we use this 'nohdr' field and a special bit in the data area reference count to keep track of whether the device needs to replace the data area before making the packet header modifications.

嗯，这段属实有点拗口。首先 TSO 大家肯定有所所了解。利用网卡来对大数据包进行分段（具体 Linux 下 GSO/TSO 的实现可以改天鸽一篇文章来聊），那么在这种情况下，网卡可能会需要对 header 部分进行一点小的修改来完成分片的操作。

但是有些时候，我们对于 L4 这一层的包，我并不需要关心其被修改的 Header ，只需要关心其 payload，那么怎么搞。这个时候就是 `nohdr` 发挥作用了。

在这里， `nohdr` 生效还需要配合另外一个字段，`dataref` 。 `dataref` 是一个计数字段，其具体的含义是指当前 data 字段所指向的数据区，被多少个 sk_buff 所引用。在这里有两种情况

1. 在 nohdr 为 0 的情况下，dataref 值为数据区的引用计数

2. 在 nohdr 为 1 的情况下，高16位，是数据区中 payload 数据区的引用计数，低16位是数据区的引用计数

对此官方有这样的描述

```c
/* We divide dataref into two halves. The higher 16 bits hold references * to the payload part of skb->data. The lower 16 bits hold references to * the entire skb->data. It is up to the users of the skb to agree on * where the payload starts.

* * All users must obey the rule that the skb->data reference count must be * greater than or equal to the payload reference count.

* * Holding a reference to the payload part means that the user does not * care about modifications to the header part of skb->data.

*/ 
#define SKB_DATAREF_SHIFT 16 #define SKB_DATAREF_MASK ((1 << SKB_DATAREF_SHIFT) - 1)
```

实际上这里也不太难理解为什么这么设计。首先来说，我们在内核里去获取数据包的时候，有些时候不需要去关心具体的 header，只需要关心具体的 payload。 而我们对于 payload 的引用计数，也需要单独的处理来保证其正确性。这样确保我们的数据还没处理完的时候。数据片不会被内核提前释放。当然这里需要大家在处理这块的时候需要保证数据区的引用计数要大于 payload 的引用计数（感觉这里像约定大于配置的做法？（当然这里不遵守约定的后果就是你内核 dump 了2333

在最后，我们的内核也通过 dataref 来在合适的时机释放数据区的内存空间，释放条件是满足以下其一即可

1. !skb->cloned: skb 没有 被 clone
2. !atomic_sub_return(skb->nohdr ? (1 << SKB_DATAREF_SHIFT) + 1 : 1, &skb_shinfo(skb)->dataref) 即在 nohdr 为 1 的时候通过 dataref-(1 << SKB_DATAREF_SHIFT) + 1) 判断是否需要释放数据区。而 nohdr 为 0 的时候通过 dataref-1 来决定是否需要释放数据区

## 总结

水文差不多就这样。。`nohdr` 真的是个很冷门的字段。嗯，因为这篇水文的一些 reference 是在地铁上查的。。我就懒得列在文章里了。。差不多这样。。写题去了。。
