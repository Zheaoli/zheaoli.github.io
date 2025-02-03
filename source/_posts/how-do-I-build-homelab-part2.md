---
title: "家庭 Homelab 升级计划: v2"
type: tags
date: 2023-12-28 20:00:00
tags: [Homelab,Linux,笔记,水文]
categories: [生活,电子产品,Homelab]
toc: true
description: 人生嘛，Homelab 图个乐子
swiper_index: 3
---

这是一个为了一盘醋包了一盘饺子的故事

<!--more-->

## 正文

熟悉我的朋友都知道，我是个 SRE，啊，不是，书接上回，大家都知道我在六月上旬的时候，家里的 HomeLab 来了一次全新的调整。

整体的效果如下

![机柜](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/7135cd07-6391-4eab-829a-8fbc11565d3c)

![网络拓扑](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/91030573-8562-42da-a8f3-d6daf9e95947)

![家里的 VM](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/7b57634d-acae-4e7e-a2c6-3aaf9a4ac93e)

现在我大概的设备如下

1. 三台 NUC （两台 Intel NUC，一台零刻 NUC），单 2.5G 口，上面跑了一个 PVE 集群，开启了一堆虚拟机
2. 一台新入的 2.5G * 4 的小主机，上面单独跑了一个 PVE，PVE 上承载了一个 OpenWRT，做了硬件直通
3. UDM-SE 作为我的主路由，负责控制 DHCP ，VLAN SSID 等 AC 功能
4. 一个 2.5G\*12 + 1G\*12 的 24 口交换机
5. 一个群晖 DS1821+，上面跑了一些媒体服务

同时，因为我发现 VM 管理很麻烦，所以我在10月底，将 K3S 引入了我的 Homelab 中，具体的结构如下

1. 三台物理 NUC 抽出6个 VM
2. 每个物理 NUC 上面跑一个 K3S Master + K3S Agent

这样算是做了个最基本使用的环境（后续可能会再如几个 NUC 作为一些特殊的节点）

差不多 v1 状态介绍完了，那么接下来，我来介绍下 v2 的改造

## V2 启动

我最近在做一些 Redis 迁移的工具，所以我想常态化的在集群里跑一个 Redis Cluster。基础的技术方案很简单 [redis-cluster helm charts](https://github.com/bitnami/charts/blob/main/bitnami/redis-cluster/README.md) 不就完了嘛。

但是问题出现在，我想在集群外访问这个 Redis Cluster，那么这就有点麻烦了。因为自建集群存在一个问题是需要一个 External-IP 作为入口。在云厂商托管的 K8S 中，这一切都很简单。但是在自己的 Homelab 中就需要别的技术方案了。

调研了一圈，发现 [MetalLb](https://metallb.universe.tf/) 将会是一个不错的选择。

1. 安装简单，开箱即用
2. 支持 L2 和 BGP 两种模式

那么就，安装一下？这里又有一个当时觉得头疼的地方，因为我用的主路由 UDM-SE 不支持 BGP，所以我只能选择 L2 模式。那么就配置一下

```yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: first-pool
  namespace: metallb-system
spec:
  addresses:
  - 192.168.20.1-192.168.20.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: main
  namespace: metallb-system
spec:
  ipAddressPools:
  - first-pool
```

然后我的 Service 就能成功的分配到可以访问的 IP 了。一切看起来很好对不对？很明显不是啊！

说到不足就需要来先聊一下 MetalLB 的 L2 是怎么做的。它在每个节点上都会启动一个 Speaker 的 DaemonSet，会将你 SVC 被分配的 IP 和 MAC 地址走 ARP 宣告出去（IPV6 走 NDP）。那么这样做有几个问题

1. 同一时刻只能有一个节点的 Speaker 宣告这个 IP，如果这个节点挂了，MetalLB 基于 Hashicorp 的 [memberlist](https://github.com/hashicorp/memberlist) 做的 failover 会有数十秒的延迟
2. 让你的局域网变得 dirty（占用了局域网的一个 IP Range）

这合理吗？这不合理啊。这清真吗，当然不清真啊。那么咋整啊，如果想换成 BGP 的话。

前面我说了**我用的主路由 UDM-SE 不支持 BGP，所以我只能选择 L2 模式。** 对吧。但是仔细思考之后，事情好像起了那么一些变化？

是这样，目前我的主路由只会作为最上层的网关，而我大部分设备的 Gateway 是通过 DHCP 下发的配置指向了我的 OpenWRT 实例，那么这样说的话，我好像在 OpenWRT 上做 BGP 支持就可以了？Exactly！

我把我定制的固件 [Auto-OpenWRT](https://github.com/Zheaoli/Auto-OpenWrt) 添加了 `quagga` 相关的包后，编译，替换虚拟机镜像。然后开始进入我们的配置流程。

先看下 OpenWRT 的配置(ssh 到 OpenWRT 上，利用 vtysh 进行配置)

```text
router bgp 65000
bgp router-id 192.168.5.1
neighbor 192.168.12.11 remote-as 65009
neighbor 192.168.12.11 description "k3s-master-1"
neighbor 192.168.12.12 remote-as 65009
neighbor 192.168.12.12 description "k3s-node-1"
neighbor 192.168.12.13 remote-as 65009
neighbor 192.168.12.13 description "k3s-node-2"
neighbor 192.168.12.14 remote-as 65009
neighbor 192.168.12.14 description "k3s-node-3"
neighbor 192.168.12.15 remote-as 65009
neighbor 192.168.12.15 description "k3s-node-4
neighbor 192.168.12.16 remote-as 65009
neighbor 192.168.12.16 description "k3s-node-5"
```

这里我将 OpenWRT 的 BGP AS 设置为 65000，然后将 K3S 的 BGP AS 设置为 65009。

然后我们对 K3S 的配置进行修改

```yaml
apiVersion: metallb.io/v1beta2
kind: BGPPeer
metadata:
  name: bgp-config
  namespace: metallb-system
spec:
  myASN: 65009
  peerASN: 65000
  peerAddress: 192.168.5.1
---
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: first-pool
  namespace: metallb-system
spec:
  addresses:
  - 10.47.40.1/24
---
apiVersion: metallb.io/v1beta1
kind: BGPAdvertisement
metadata:
  name: main
  namespace: metallb-system
spec:
  ipAddressPools:
  - first-pool
```

OK, 回来看下我们的 OpenWRT 的一些结果

```text
OpenWrt# show ip bgp summary
BGP router identifier 192.168.5.1, local AS number 65000
RIB entries 13, using 1456 bytes of memory
Peers 6, using 53 KiB of memory

Neighbor        V         AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
192.168.12.11   4 65009      12       9        0    0    0 00:02:43        7
192.168.12.12   4 65009      12       8        0    0    0 00:02:54        7
192.168.12.13   4 65009      12       9        0    0    0 00:02:49        7
192.168.12.14   4 65009      12       9        0    0    0 00:02:53        7
192.168.12.15   4 65009      12       9        0    0    0 00:02:46        7
192.168.12.16   4 65009      12       9        0    0    0 00:02:44        7

Total number of neighbors 6
```

Right，Neighbor 成功建立，然后我们创建几个 LoadBalancer SVC 看一下

```text
NAME                          TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)                          AGE
shake-test-cluster            ClusterIP      10.43.135.231   <none>        6379/TCP                         2d19h
shake-test-cluster-0-svc      LoadBalancer   10.43.51.216    10.47.40.0    6379:32530/TCP,16379:30502/TCP   38h
shake-test-cluster-1-svc      LoadBalancer   10.43.131.210   10.47.40.1    6379:32576/TCP,16379:31528/TCP   38h
shake-test-cluster-2-svc      LoadBalancer   10.43.255.193   10.47.40.2    6379:31159/TCP,16379:30952/TCP   38h
shake-test-cluster-3-svc      LoadBalancer   10.43.208.189   10.47.40.3    6379:30919/TCP,16379:32387/TCP   38h
shake-test-cluster-4-svc      LoadBalancer   10.43.138.170   10.47.40.5    6379:31628/TCP,16379:31405/TCP   38h
shake-test-cluster-5-svc      LoadBalancer   10.43.21.204    10.47.40.6    6379:32273/TCP,16379:30076/TCP   38h
```

OK 分配了一些 VIP，我们再来看下 OpenWRT 的 BGP 路由表

```text
OpenWrt# show ip bgp

   Network          Next Hop            Metric LocPrf Weight Path
*  10.47.40.0/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.1/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.2/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.3/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.4/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.5/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
*  10.47.40.6/32    192.168.12.11                          0 65009 i
*                   192.168.12.16                          0 65009 i
*                   192.168.12.15                          0 65009 i
*                   192.168.12.13                          0 65009 i
*                   192.168.12.14                          0 65009 i
*>                  192.168.12.12                          0 65009 i
```

很好，我们的路由表里面已经有了我们的 VIP，以及 Next Hop，当某个节点发生故障的时候，OpenWRT 会自动将路由表更新，然后将流量转发到其他节点上。

那么 SVC 的需求算是告一段落了，这算本次升级的结束了吗？

当然不是。

在完成 BGP 后，OpenWRT 将会承担更多的任务。我现在的方式是，有一个一模一样的备机在旁边，当主机挂了的时候，我需要手动切换到备机上。这样的话，我就需要一个自动化的方案。

那么这个方案就是 [VRRP](https://en.wikipedia.org/wiki/Virtual_Router_Redundancy_Protocol)。这个协议的原理很简单，就是在两台机器上都跑一个 VRRP 的 Daemon，然后通过一个 Virtual IP 来进行访问。当主机挂了的时候，备机会接管这个 Virtual IP。

在 OpenWRT 上，我们可以通过 `keepalived` 来实现这个功能。我们先来看下配置

```conf
global_defs {
    router_id LVS_DEVEL
}

vrrp_instance VI_1 {
    state BACKUP #默认的主节点值为 MASTER
    interface eth0
    virtual_router_id 51
    priority 10
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass 1111
    }
    virtual_ipaddress {        
        192.168.5.1/16 dev eth0
    }
}
```

这里我们将 Virtual IP 设置为 192.168.5.1，而背后的四个节点为

- 192.168.5.2
- 192.168.5.3
- 192.168.5.4
- 192.168.5.5

其中 192.168.5.2 为主节点，这四个 OpenWRT 都在我四个 NUC 机器上，确保一个硬件挂了其余的节点可以接管。

我们来测试下，先下线 192.168.5.2

```text
Thu Dec 28 20:14:52 2023 daemon.info Keepalived_vrrp[13785]: (VI_1) Entering MASTER STATE
Thu Dec 28 20:14:52 2023 daemon.info avahi-daemon[2902]: Registering new address record for 192.168.5.1 on eth0.IPv4.
Thu Dec 28 20:14:52 2023 daemon.info Keepalived_vrrp[13785]: (VI_1) Master received advert from 192.168.5.5 with same priority 10 but higher IP address than ours
Thu Dec 28 20:14:52 2023 daemon.info Keepalived_vrrp[13785]: (VI_1) Entering BACKUP STATE
Thu Dec 28 20:14:52 2023 daemon.info avahi-daemon[2902]: Withdrawing address record for 192.168.5.1 on eth0.
```

我们能看到主节点已经切换到了 192.168.5.5 上了，然后我们再上线

```text
Thu Dec 28 20:26:22 2023 daemon.info Keepalived_vrrp[3000]: (VI_1) Master received advert from 192.168.5.2 with higher priority 100, ours 10
Thu Dec 28 20:26:22 2023 daemon.info Keepalived_vrrp[3000]: (VI_1) Entering BACKUP STATE
Thu Dec 28 20:26:22 2023 daemon.info avahi-daemon[2909]: Withdrawing address record for 192.168.5.1 on eth0.
Thu Dec 28 20:26:22 2023 daemon.notice ttyd[7586]: [2023/12/28 20:26:22:2320] N: rops_handle_POLLIN_netlink: DELADDR
```

我们能看到，主节点也已经切换回了

现在算是终于做到了基础的 HA 了

## 总结

这次升级主要还是以软件升级为主，希望能尽可能体验和云上一致。同时保持基础的 HA

下一步的迭代计划是（我自己想的）：

1. 可以尝试做更多路由的骚操作，比如 DSR
2. 可以添置新的一些交换机，尝试 RDMA 之类的好玩的东西

差不多就这样把