---
title: SRE 日志：我的包去哪了？
type: tags
date: 2024-05-12 01:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

这算是新开的一个系列，主要是记录一些 SRE 日常帮自己/帮人调试问题的经历。会完整的记录排查的过程。希望能帮上大家的忙

这篇是一个非常常见的问题，我的包去哪了？

<!--more-->

## 开篇

群里的的一个小伙伴提出了一个问题，他在用 dind （Docker in Docker）的时候，A 容器往 B 容器发送的 UDP 包，B 容器能收到，但是 A 容器收不到返回的值。

OK， 是个很经典的“我的包去哪了“的问题。

我们先来构建一下本地的环境看能不能复现

1. 本机的 IP 为 192.168.0.239
2. 我们单独隔离出一个 network ，CIDR 为 172.18.0.0/16
3. 我们先跑一个 dind 容器，name 为 dind1， IP 为 172.18.0.2, 暴露 UDP 4000 端口至 Host
4. 我们再跑一个 dind 容器，name 为 dind2， IP 为 172.18.0.3
5. dind1 中启动一个容器运行一段简单的 UDP 服务，监听 4000 端口，IP 为 172.17.0.2，暴露 UDP 4000 端口至 dind1
6. dind2 中启动一个容器，IP 为 172.17.0.2, 执行 UDP 客户端，通过 192.168.0.239 的 4000 端口发送一个 UDP 报文

UDP Server 和 UDP Client 的代码如下：

```python
import socket

def udp_echo_server(host='0.0.0.0', port=4000):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind((host, port))
        print(f"Server started at {host}:{port}")

        while True:
            data, addr = sock.recvfrom(1024)  
            print(f"Received from {addr}: {data.decode()}")

            sock.sendto(data, addr)

if __name__ == "__main__":
    udp_echo_server()
```

```python
import socket

def send_message(host='192.168.0.239', port=4000, message='Hello, UDP!'):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.sendto(message.encode(), (host, port))
        data, _ = sock.recvfrom(1024)
        print(f"Received from server: {data.decode()}")

if __name__ == "__main__":
    send_message()
```

我们来看下现象

![本地复现](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/39cdb9a5-6c2d-4481-8e85-aba8399e5de4)

emmmm，能够正确复现

我们直接来抓一下包看看（直接抓虚拟网桥 br-xxxx 上的包）

![Wireshark 抓包结果](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/b9745dce-8b19-43b6-ba04-be8de6d1461d)

唔，我们看到第三个 172.18.0.2 已经向来程回包了，那么为什么我们客户端没有收到呢？包去哪了？（实际上 wireshark 这一步已经能确定问题了）

这个时候我们祭出 pwru ，Cilium 做的工具，可以抓内核包（表现为 skb）在内核中的处理流程（感兴趣的话我可以写个实现解析），来看看

因为我们是回程的时候出的问题，所以我们需要抓 src port 为 4000 的 UDP 包，执行 `sudo pwru 'src port 4000'`

看下日志

```log
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] __netif_receive_skb_one_core
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]                   ip_rcv
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]              ip_rcv_core
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]               sock_wfree
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]             nf_hook_slow
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]              nf_checksum
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]           nf_ip_checksum
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]       udp_v4_early_demux
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]     ip_route_input_noref
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]      ip_route_input_slow
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]      fib_validate_source
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]    __fib_validate_source
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]         ip_local_deliver
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]             nf_hook_slow
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]  ip_local_deliver_finish
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]  ip_protocol_deliver_rcu
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]        raw_local_deliver
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]                  udp_rcv
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]           __udp4_lib_rcv
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]              __icmp_send
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]        __ip_options_echo
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] security_skb_classify_flow
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] bpf_lsm_xfrm_decode_session
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]    __xfrm_decode_session
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] security_xfrm_decode_session
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] bpf_lsm_xfrm_decode_session
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608] kfree_skb_reason(SKB_DROP_REASON_NO_SOCKET)
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]   skb_release_head_state
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]         skb_release_data
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]            skb_free_head
0xffff9f7827643600     24 [/usr/bin/docker-proxy:53608]             kfree_skbmem
```

我们看到了一个 `SKB_DROP_REASON_NO_SOCKET`，这个意思是因为没有对应的 socket 存在，所以直接丢弃了 skb

神奇，通常来说，我们 UDP 的包在 iptables 等路径上是由 conntrack 的存在的，意味着我们的包应该是有对应的 socket 的，为什么会没有呢？

我们来看下 dind2 conntrack 的状态，我们可以通过 `/proc/net/nf_conntrack` 获取到 conntrack 的信息

这里我们先看一下 dind2 的 conntrack 信息

```text
ipv4     2 udp      17 27 src=172.17.0.2 dst=192.168.0.239 sport=34320 dport=4000 [UNREPLIED] src=192.168.0.239 dst=172.18.0.3 sport=4000 dport=34320 mark=0 zone=0 use=2
ipv4     2 udp      17 27 src=172.18.0.1 dst=172.18.0.3 sport=4000 dport=34320 [UNREPLIED] src=172.18.0.3 dst=172.18.0.1 sport=34320 dport=4000 mark=0 zone=0 use=2
```

啊哈！问题在这里（其实很多时候 SKB_DROP_REASON_NO_SOCKET 的问题可以先去看下 conntrack 的状态），我们去程的包是

- src=172.17.0.2 dst=192.168.0.239 sport=34320 dport=4000

回程的时候变成

- src=172.18.0.1 dst=172.18.0.3 sport=4000 dport=34320

这完全不一样嘛，而我们的 dind2 没有打开 34320 端口，同时 conntrack 也没有对应的状态，所以直接丢弃了 skb

那么为什么会发生这样的改变呢？我们用 pwru 来看下 skb 的处理流程，日志文件太长，我将原始文件贴在这里，欢迎大家去分析 <https://gist.github.com/Zheaoli/f0a485fc3c6e5f60af486c8198f895ab>

这里我们说一下日志的结论，截止到 `SKB_DROP_REASON_NO_SOCKET` 的时候，我们有这样一些关键变化

1. 172.17.0.2:34320 -> 192.168.0.239:4000 
2. 172.18.0.3:34320 -> 192.168.0.239:4000
3. 172.18.0.1:34320 -> 172.18.0.2:4000
4. 172.18.0.2:4000 -> 172.18.0.1:34320
5. 172.18.0.1:4000 -> 172.18.0.3:34320

我们来解释下，

1. 第一跳非常简单，原始的包
2. 第二条是在包到达 dind2 的时候，iptables 做了一次 SNAT 的操作，将源地址改为 dind 的 IP 地址
3. 然后包到达宿主机后，因为 docker proxy 监听了所有的端口，所以会捕获这个包，然后根据规则，转发向 172.18.0.2
4. 然后 docker proxy 向 172.18.0.2 转发的包，因为路由的规则，ip 地址会变成 172.18.0.1 
5. 剩下的就是正常的回程了，

写到这里大家可能已经发现了问题，我们向 192.168.0.239 直接发送的包，没有离开机器，所以 IP 地址不会被 MASQUERADE 为本机的 IP，然后直接被 docker-proxy 接管后 src ip 依旧为 172.18.0.3，导致了 conntrack 的状态不匹配，所以最终在 172.18.0.3 上没有对应的 socket，导致了 skb 被丢弃

我们可以截取一部分日志来看

```text
0xffff9f7898af0200     10 [/usr/bin/python3.12:155497]     ipv4_pktinfo_prepare netns=4026531840 mark=0x0 iface=4(br-1534421c90dc) proto=0x0800 mtu=1500 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     10 [/usr/bin/python3.12:155497] __udp_enqueue_schedule_skb netns=4026531840 mark=0x0 iface=4(br-1534421c90dc) proto=0x0800 mtu=1500 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     19 [/usr/bin/docker-proxy:53608]          skb_consume_udp netns=0 mark=0x0 iface=0 proto=0x0800 mtu=0 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     19 [/usr/bin/docker-proxy:53608]  __consume_stateless_skb netns=0 mark=0x0 iface=0 proto=0x0800 mtu=0 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     19 [/usr/bin/docker-proxy:53608]         skb_release_data netns=0 mark=0x0 iface=0 proto=0x0800 mtu=0 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     19 [/usr/bin/docker-proxy:53608]            skb_free_head netns=0 mark=0x0 iface=0 proto=0x0800 mtu=0 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7898af0200     19 [/usr/bin/docker-proxy:53608]             kfree_skbmem netns=0 mark=0x0 iface=0 proto=0x0800 mtu=0 len=11 172.18.0.3:40870->192.168.0.239:4000(udp)
0xffff9f7935554700     19 [/usr/bin/docker-proxy:53608]              udp4_hwcsum netns=4026531840 mark=0x0 iface=0 proto=0x0000 mtu=0 len=39 172.18.0.1:36794->172.18.0.2:4000(udp)
0xffff9f7935554700     19 [/usr/bin/docker-proxy:53608]              ip_send_skb netns=4026531840 mark=0x0 iface=0 proto=0x0000 mtu=0 len=39 172.18.0.1:36794->172.18.0.2:4000(udp)
0xffff9f7935554700     19 [/usr/bin/docker-proxy:53608]           __ip_local_out netns=4026531840 mark=0x0 iface=0 proto=0x0000 mtu=0 len=39 172.18.0.1:36794->172.18.0.2:4000(udp)
0xffff9f7935554700     19 [/usr/bin/docker-proxy:53608]             nf_hook_slow netns=4026531840 mark=0x0 iface=0 proto=0x0800 mtu=0 len=39 172.18.0.1:36794->172.18.0.2:4000(udp)
0xffff9f7935554700     19 [/usr/bin/docker-proxy:53608]                ip_output netns=4026531840 mark=0x0 iface=0 proto=0x0800 mtu=0 len=39 172.18.0.1:36794->172.18.0.2:4000(udp)
```

差不多问题就这样，实际上我们复盘整个问题排查流程，我们实际上可以在 wireshark 抓包的时候就能大致的确定问题的范围，有效利用 pwru 等新时代的工具，可以更快的定位问题。

## 最后

留两个课后作业

1. 为什么其余 Host 同级别机器的包能正常和 dind1 里的 udp server 通信？
2. TCP 存在同样问题吗？如果不，为什么