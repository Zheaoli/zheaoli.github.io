---
title: 简单聊聊在 Linux 内核中的网络质量监控
type: tags
date: 2022-01-31 21:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

这可能是2021年最后一篇文章（农历年），也可能是2022年第一篇文章，不过这完全取决于我什么时候写完。这次来简单聊聊 Linux 中的网络监控

<!--more-->

## 开篇

这篇文章，既是一篇水文，又不是一篇水文。不过还是新手向的一个文章。这篇文章实际上在我的草稿箱里呆了一年多的时间了，灵感最初源自我在阿里的一些工作（某种意义上算是国内领先的（但也是比较小众的工作（XD

随着技术的发展，大家对于服务的稳定性要求越来越高，而保证服务质量的前提就是有着合格的监控的覆盖面（阿里对于服务稳定性的要求叫做 "1-5-10" 即，一分钟发现，五分钟处理，十分钟自愈，而这样一个对于稳定性的要求没有足够的覆盖面的监控的话，那么一切等于圈圈）。而在这其中，网络质量的监控是重中之重

在讨论网络质量的监控之前，我们需要来明确网络质量这个定义的覆盖范围。

1. 网络链路上的异常情况
2. 服务端网络的处理能力

在明确这样的覆盖范围后，我们可以来思考什么样的指标代表着网络质量的降低。（注：本文主要分析 TCP 及 over TCP 协议的监控，后续不再赘述）

1. 毫无疑问，如果我们存在丢包的情况
2. 发送/接收队列阻塞
3. 超时

那么我们可以再来看下具体细节

1. 如 RFC793<sup>1</sup> 提出的 RTO，RFC6298<sup>2</sup> 提出的 Retransmission Timer 等指标，可以衡量包传送时间。一个粗略的概括是，这两个指标越大代表着网络质量越低
2. 如 RFC2018<sup>3</sup> 提出的 SACK，一个不精确的概括是 SACK 越多，代表着丢包越多
3. 如果我们的链接频繁的被 RST，那么也代表着我们的网络质量存在问题

当然在实际的生产过程中，我们还可以从很多其余的指标来辅助衡量网络质量，不过因为本文主要是介绍思路以 prototype 为主，所以不做过多赘述

在明确我们这篇文章中要获取什么指标后，我们再来分析一下我们怎么样去获取这些指标

## 内核网络质量监控

### 暴力版

从内核中获取网络的 metric ，本质上来说是从内核获取运行状态。说道这点，对 Linux 有所了解的同学第一反应肯定是说从 **The Proc Filesystem**<sup>4</sup> 看一下能不能拿到具体的指标。Yep， 不错的思路，实际上的确可以拿到一部分的指标（这也是 `netstat` 等一些网络工具的原理)

在 `/proc/net/tcp` 中，我们可以获取到内核吐出的 Metric，现在包括这样一些

1. 连接状态
2. 本地端口，地址
3. 远程端口，地址
4. 接收队列长度
5. 发送队列长度
6. 慢启动阈值
7. RTO 值
8. 连接所属的 socket 的 inode id
9. uid
10. delay ack 软时钟

完整的解释可以参考 **proc_net_tcp.txt**<sup>5</sup>

这样的做法针对于 prototype 可能说是可以的，不过其固有的几个弊端限制了在生产上大规模使用

1. 内核已经明确不推荐使用 **proc_net_tcp.txt**<sup>5</sup>，换句话说，并不保证未来的兼容性与维护
2. 内核直接提供的 metric 信息还是太少，一些关于 RTT，SRTT 这样的指标还是没法获取，也没法获取 SACK 等一些特定事件。
3. 根据内核输出的 metric。存在的问题是实时性和精度的问题，换句话说，我们在不考虑精度的情况下可以去做这方面的尝试
4. **proc_net_tcp.txt**<sup>5</sup> 是和 network namespace 进行绑定的，换句话说，在容器的场景下，我们需要遍历可能存在的多个 network namespace ，不断的走 `nsenter` 去获取对应的 Metric

所以在这样的背景下，**proc_net_tcp.txt**<sup>5</sup> 并不太适合比较大规模的使用场景。所以我们需要对其做更近一步的优化

### 优化 1.0 版

在上文里，我们提到了关于直接从 **The Proc Filesystem**<sup>4</sup> 中获取数据的弊端。其中一条很重要的是提到了

> 内核已经明确不推荐使用 **proc_net_tcp.txt**<sup>5</sup>，换句话说，并不保证未来的兼容性与维护

那么推荐的做法是什么呢？答案是 **netlink+sock_diag** 

简单介绍下 netlink<sup>6</sup> 是 Linux 2.2 引入的一种 Kernel Space 与 User Space 进行通信的机制，最早由 RFC3549<sup>7</sup> 提出。官方对于 netlink<sup>6</sup> 的描述大概是这样

> Netlink is used to transfer information between the kernel anduser-space processes. It consists of a standard sockets-based interface for user space processes and an internal kernel API for kernel modules.  
> The internal kernel interface is not documented in this manual page.  There is also an obsolete netlink interface via netlink character devices; this interface is not documented here and is provided only for backward compatibility.

简而言之大概是用户可以利用 netlink<sup>6</sup> 很方便的与内核中的不同的 Kernel Module 进行数据交互

而在我们这样的场景下，我们就需要利用到 sock_diag<sup>8</sup>，官方对此的描述是

> The sock_diag netlink subsystem provides a mechanism for obtaining information about sockets of various address families from the kernel.  This subsystem can be used to obtain information about individual sockets or request a list of sockets.

这里简而言之是说我们可以利用 sock_diag<sup>7</sup> 来获取不同 socket 的连接状态及相应的指标。（我们能获取到上文提到的所有指标，也能获得更细的 RTT 等指标）啊对了，这里要注意，netlink<sup>6</sup> 可以通过设置参数来从所有的 Network Namespace 获取指标。

在使用 netlink<sup>6</sup> 时，可能直接用 Pure C 来写比较繁琐。所幸，社区已经有不少封装成熟的 Lib，比如这里我选用 vishvananda 所封装的 netlink 库<sup>8</sup>，这里我给一个 Demo

```go
package main

import (
    "fmt"

	"github.com/vishvananda/netlink"
	"syscall"
)

func main() {
	results, err := netlink.SocketDiagTCPInfo(syscall.AF_INET)
	if err != nil {
		return
	}
	for _, item := range results {
		if item.TCPInfo != nil {
			fmt.Printf("Source:%s, Dest:%s, RTT:%d\n", item.InetDiagMsg.ID.Source.String(), item.InetDiagMsg.ID.Destination.String(), item.TCPInfo.Rtt)
		}
	}
}
```

运行示例大概是这样

![netlink](https://user-images.githubusercontent.com/7054676/151838248-eadaacf0-3d7a-4542-a091-9d401c37339c.png)

OK，现在我们能用官方推荐的 Best Practice 来获取到更全更细的指标，也无需操心 Network namespace 的问题，但是我们最开始的几个问题还有一个比较棘手，就是实时性的问题。

因为如果我们选择周期性的轮询，那么如果在我们的轮询间隔中发生了网络波动，我们将丢失掉对应的现场。所以我们怎么样去解决实时性的问题呢？

### 优化 2.0 版

如果要在具体的比如重传，connection reset 等事件发生的时候，直接触发我们的调用。看过我之前博客的同学，可能第一时间考虑使用 eBPF + kprobe 的组合，在一些诸如 `tcp_reset` ，`tcp_retransmit_skb` 之类的关键调用上打点来获取实时的数据。Sounds good！

不过实际上还是有一些小小的问题

1. kprobe 的开销在高频的情况下，相对来说会比较大一些
2. 如果我们仅仅需要一些诸如 source_address, dest_address, source_port, dest_port 之类的信息，我们直接走 kprobe 拿完整地 skb 再来 cast 属实有点浪费

所以我们有什么更好的方法吗？有的！

在 Linux 中，对于一系列的类似我们需求这样的特殊事件的触发与回调的场景，有一套基础设施叫做 Tracepoint<sup>9</sup>。这套设施，能够很好的帮我们处理监听事件并回调的需求。而在 Linux 4.15 以及 4.16 之后，Linux 新增了6个 tcp 相关的 Tracepoint<sup>9</sup>

分别是

1. tcp:tcp_destroy_sock
2. tcp:tcp_probe
3. tcp:tcp_receive_reset
4. tcp:tcp_retransmit_skb
5. tcp:tcp_retransmit_synack
6. tcp:tcp_send_reset

这些 Tracepoint<sup>9</sup> 的含义，大家看名字可能就能明白了

而在这些 Tracepoint<sup>9</sup> 触发的时候，他们会给注册回调函数传入若干参数，这里我也给大家列一下

```text
tcp:tcp_retransmit_skb
    const void * skbaddr;
    const void * skaddr;
    __u16 sport;
    __u16 dport;
    __u8 saddr[4];
    __u8 daddr[4];
    __u8 saddr_v6[16];
    __u8 daddr_v6[16];
tcp:tcp_send_reset
    const void * skbaddr;
    const void * skaddr;
    __u16 sport;
    __u16 dport;
    __u8 saddr[4];
    __u8 daddr[4];
    __u8 saddr_v6[16];
    __u8 daddr_v6[16];
tcp:tcp_receive_reset
    const void * skaddr;
    __u16 sport;
    __u16 dport;
    __u8 saddr[4];
    __u8 daddr[4];
    __u8 saddr_v6[16];
    __u8 daddr_v6[16];
tcp:tcp_destroy_sock
    const void * skaddr;
    __u16 sport;
    __u16 dport;
    __u8 saddr[4];
    __u8 daddr[4];
    __u8 saddr_v6[16];
    __u8 daddr_v6[16];
tcp:tcp_retransmit_synack
    const void * skaddr;
    const void * req;
    __u16 sport;
    __u16 dport;
    __u8 saddr[4];
    __u8 daddr[4];
    __u8 saddr_v6[16];
    __u8 daddr_v6[16];
tcp:tcp_probe
    __u8 saddr[sizeof(struct sockaddr_in6)];
    __u8 daddr[sizeof(struct sockaddr_in6)];
    __u16 sport;
    __u16 dport;
    __u32 mark;
    __u16 length;
    __u32 snd_nxt;
    __u32 snd_una;
    __u32 snd_cwnd;
    __u32 ssthresh;
    __u32 snd_wnd;
    __u32 srtt;
    __u32 rcv_wnd;
```

嗯，看到这里，大家可能心里应该有个数了，那么我们还是来写一下示例代码

```python
from bcc import BPF

bpf_text = """
BPF_RINGBUF_OUTPUT(tcp_event, 65536);

enum tcp_event_type {
    retrans_event,
    recv_rst_event,
};

struct event_data_t {
    enum tcp_event_type type;
    u16 sport;
    u16 dport;
    u8 saddr[4];
    u8 daddr[4];
    u32 pid;
};

TRACEPOINT_PROBE(tcp, tcp_retransmit_skb)
{
    struct event_data_t event_data={};
    event_data.type = retrans_event;
    event_data.sport = args->sport;
    event_data.dport = args->dport;
    event_data.pid=bpf_get_current_pid_tgid()>>32;
    bpf_probe_read_kernel(&event_data.saddr,sizeof(event_data.saddr), args->saddr);
    bpf_probe_read_kernel(&event_data.daddr,sizeof(event_data.daddr), args->daddr);
    tcp_event.ringbuf_output(&event_data, sizeof(struct event_data_t), 0);
    return 0;
}

TRACEPOINT_PROBE(tcp, tcp_receive_reset)
{
    struct event_data_t event_data={};
    event_data.type = recv_rst_event;
    event_data.sport = args->sport;
    event_data.dport = args->dport;
    event_data.pid=bpf_get_current_pid_tgid()>>32;
    bpf_probe_read_kernel(&event_data.saddr,sizeof(event_data.saddr), args->saddr);
    bpf_probe_read_kernel(&event_data.daddr,sizeof(event_data.daddr), args->daddr);
    tcp_event.ringbuf_output(&event_data, sizeof(struct event_data_t), 0);
    return 0;
}

"""

bpf = BPF(text=bpf_text)


def process_event_data(cpu, data, size):
    event = bpf["tcp_event"].event(data)
    event_type = "retransmit" if event.type == 0 else "recv_rst"
    print(
        "%s %d %d %s %s %d"
        % (
            event_type,
            event.sport,
            event.dport,
            ".".join([str(i) for i in event.saddr]),
            ".".join([str(i) for i in event.daddr]),
            event.pid,
        )
    )


bpf["tcp_event"].open_ring_buffer(process_event_data)


while True:
    bpf.ring_buffer_consume()
```

我这里使用了 `tcp_receive_reset` 和 `tcp_retransmit_skb` 来监控我们机器上的程序。为了演示具体的效果，我先用 Go 写了一个访问 Google 的程序，然后通过 `sudo iptables -I OUTPUT -p tcp -m string --algo kmp --hex-string "|c02bc02fc02cc030cca9cca8c009c013c00ac014009c009d002f0035c012000a130113021303|" -j REJECT --reject-with tcp-reset` 来给这个 Go 程序注入 Connection Reset （这里的注入原理是 Go 默认库的发起 HTTPS 链接的 Client Hello 特征是固定的，我用 iptables 识别出方向流量，然后重置链接）

效果如下

![Tracepoint](https://user-images.githubusercontent.com/7054676/151841316-8c954deb-e7a6-4229-80d6-4134d884a003.png)

嗯，写到这里，你可能想明白了，我们可以将 Tracepoint<sup>9</sup> 和 netlink<sup>6</sup> 结合使用来满足我们实时性的需求

### 优化 3.0 版

实际上写到现在，也更多的是讲一些 Prototype 和思路上的介绍。而为了能满足生产上的需要，还有很多的工作要做（这也是我之前所做的工作的一部分），包括不仅限于：

1. 工程上的性能优化，避免影响服务
2. Kubernetes 等容器平台的兼容
3. 对接 Prometheus 等数据监控平台
4. 可能需要嵌入 CNI 来获取更简便的监控路径等等

实际上社区在这一块也有很多很有意思的工作，比如 Cilium 等，大家有兴趣也可以关注下。而我后续拾掇拾掇代码，也会在合适的时候将我之前的一些实现路径给开源出来。

## 总结

这篇文章差不多就写到这里，内核的网络监控终归是比较小众的领域。希望我这里面的一些经验能够帮助上大家。嗯，祝大家新年快乐！虎年大吉！（下一篇文章就是写去年的年终总结了）

## Reference

1. RFC793: https://datatracker.ietf.org/doc/html/rfc793
2. RFC6298：https://datatracker.ietf.org/doc/html/rfc6298
3. RFC2018：https://datatracker.ietf.org/doc/html/rfc2018
4. The /proc Filesystem：https://www.kernel.org/doc/html/latest/filesystems/proc.html
5. proc_net_tcp.txt：https://www.kernel.org/doc/Documentation/networking/proc_net_tcp.txt
6. netlink：https://man7.org/linux/man-pages/man7/netlink.7.html
7. sock_diag：https://man7.org/linux/man-pages/man7/sock_diag.7.html
8. vishvananda/netlink：https://github.com/vishvananda/netlink
9: Linux Tracepoint：https://www.kernel.org/doc/html/latest/trace/tracepoints.html