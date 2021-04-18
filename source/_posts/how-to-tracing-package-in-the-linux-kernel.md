---
title: 利用动态 tracing 技术来 trace 内核中的网络请求
type: tags
date: 2021-04-17 17:09:00
tags: [编程,Linux,笔记,水文,eBPF,SystemTap]
categories: [编程,Linux,Kernel]
toc: true
---

这周帮朋友用 eBPF/SystemTap 这样的动态 tracing 工具做了一些很有趣的功能。这篇文章算是一个总结

<!--more-->

## 开篇

实际上这周的一些想法，最开始是实际上来源于某天一个朋友问我的一个问题

> 我们能不能监控机器上哪些进程在发出 ICMP 请求？需要拿到 PID，ICMP 包出口地址，目标地址，进程启动命令

很有趣的问题。实际上首先拿到这个问题时候，我们第一反应肯定是 “让机器上的进程在发 ICMP 包的时候”直接往一个地方写日志不就好了，emmmm，用一个 meme 镇楼吧

![鸡生蛋蛋生鸡](https://user-images.githubusercontent.com/7054676/115106820-68ae5400-9f99-11eb-8dbd-772d18f6b039.png)

嗯，可能大家都知道我想说什么了，我们这种场景实际上只能选择旁路，无侵入的方式去做。

那么涉及到包的旁路的 trace，大家第一反应肯定是 [tcpdump](https://www.tcpdump.org/manpages/tcpdump.1.html) 去抓包。但是在我们今天的问题下，tcpdump 只能拿到包信息， 但是拿不到具体的 PID，启动命令等信息。

所以我们可能需要用另外一些方式去实现我们的需求

在需求最开始之初，我们还可能的选择的方式有这样一些

1. 走 [/proc/net/tcp](https://www.kernel.org/doc/Documentation/networking/proc_net_tcp.txt) 去拿具体的 socket 的 **inode** 信息，然后反查 pid 关联

2. eBPF + kprobe 内核打点做监控

3. SystemTap + kprobe 内核打点做监控

第一种方式，实际上只能拿到 TCP 一层的信息，但是 ICMP 并不是 TCP 协议啊（衰（虽然同属 L4 

那么看到最后，我们貌似就只有用 eBPF/SystemTap 配合 kprobe 的一条路可以走了

## 基础的 trace

### Kprobe

在继续下面的代码实际操作之前，我们首先要来认识一下 [Kprobe](https://www.kernel.org/doc/html/latest/trace/kprobes.html)

先引用一段官方文档的介绍

> Kprobes enables you to dynamically break into any kernel routine and collect debugging and performance information non-disruptively. You can trap at almost any kernel code address 1, specifying a handler routine to be invoked when the breakpoint is hit.
> There are currently two types of probes: kprobes, and kretprobes (also called return probes). A kprobe can be inserted on virtually any instruction in the kernel. A return probe fires when a specified function returns.
> In the typical case, Kprobes-based instrumentation is packaged as a kernel module. The module’s init function installs (“registers”) one or more probes, and the exit function unregisters them. A registration function such as register_kprobe() specifies where the probe is to be inserted and what handler is to be called when the probe is hit.

简单来说，kprobe 是内核的一个提供的一个 trace 机制，在执行我们所设定特定的内核函数时/后，会按照我们所设定的规则触发我们的回调函数。用官方的话来说，“You can trap at almost any kernel code address”

在我们今天的场景下，不管利用 eBPF 还是 SystemTap 都需要依赖 Kprobe 并选择合适的 hook 点来完成我们内核调用的 trace

那么，在我们今天的场景下，我们应该选择在什么函数上加上对应的 hook 呢？

首先我们来想一下，ICMP 是一个四层的包，最终封装在一个 IP 报文中分发出去，那么我们来看一下，内核中 IP 报文发送中的关键调用，参见下图

![IP Layer 关键系统调用](https://user-images.githubusercontent.com/7054676/115108292-37865180-9fa2-11eb-920f-dada0463ea10.png)

在这里我选择将 ip_finish_output 作为我们的 hook 点。

OK，Hook 点确认后，在开始正式编码前，我们来大概介绍下 `ip_finish_output`

### ip_finish_output

首先来看下这个函数

```c
static int ip_finish_output(struct net *net, struct sock *sk, struct sk_buff *skb)
{
	int ret;

	ret = BPF_CGROUP_RUN_PROG_INET_EGRESS(sk, skb);
	switch (ret) {
	case NET_XMIT_SUCCESS:
		return __ip_finish_output(net, sk, skb);
	case NET_XMIT_CN:
		return __ip_finish_output(net, sk, skb) ? : ret;
	default:
		kfree_skb(skb);
		return ret;
	}
}
```

具体细节先不在这里展开（因为实在是太多了Orz），在系统调用 `ip_finish_output` 时，会触发我们设定的 kprobe 的钩子，在我们所设定的 hook 函数中会收到 `net`, `sk`, `skb` 三个参数（这三个参数也是调用 `ip_finish_output` 时的值。

在这三个参数中，我们主要来将视线放在 `struct sk_buff *skb` 上。

熟悉 Linux Kernel 协议栈实现的同学肯定对 `sk_buff` 这个数据结构非常非常熟悉了。这个数据结构是 Linux Kernel 中网络相关的核心数据结构。通过不断的偏移指针，这个数据结构能够很方便帮助我们确认我们待发送/已接收的数据在内存中所存放的位置。

空口直说好像有点抽象，我们来看个图

![sk_buff](https://user-images.githubusercontent.com/7054676/115132085-9514af80-a02f-11eb-9434-3bf085714817.png)

以发送一个 TCP 包为例，我们能看到这个图中，sk_buff 经历了六个阶段

a. 根据 TCP 中的一些选项如 MSS 等，分配一个 buffer
b. 根据 MAX_TCP_HEADER 在我们申请好的内存 buffer 中预留一段足够容纳所有网络层的 header 的空间（TCP/IP/Link等）
c. 填入 TCP 的 payload
d. 填入 TCP header
e. 填入 IP header
d. 填入 link header

可以参照一下 TCP 报文结构，这样大家会有一个更直观的理解

![TCP Segement Format](https://user-images.githubusercontent.com/7054676/115132279-6c8db500-a031-11eb-9fd3-1ea346015cdb.png)

大家能看到，通过 sk_buff 的一些指针的操作，我们就能很方便的获取到其中不同 layer 的 header 和具体的 payload

OK，现在让我们正式的来开始实现我们所需要的功能

### eBPF + KProbe

首先简单介绍下 eBPF。BPF 指 Berkeley Packet Filter ，最早期是用来设计在内核中实现一些网络包过滤的功能。但是后续社区对其做了非常多的强化增强，使其不仅能应用于网络目地。这也是名字中 e 的来历（extend）

本质上而言，eBPF 在内核维护了一层 VM，可以加载特定规则生成的代码，让内核变得更具有可编程性（后面我争取写一篇 eBPF 从入门到入土的介绍文章）

> Tips: Tcpdump 的背后就是 BPF

然后在这次实现中，我们使用了 [BCC](https://github.com/iovisor/bcc) 来简化我们 eBPF 相关的编写难度

OK，先上代码

```python
from bcc import BPF
import ctypes

bpf_text = """
#include <linux/ptrace.h>
#include <linux/sched.h>        /* For TASK_COMM_LEN */
#include <linux/icmp.h>
#include <linux/ip.h>
#include <linux/netdevice.h>

struct probe_icmp_sample {
    u32 pid;
    u32 daddress;
    u32 saddress;
};

BPF_PERF_OUTPUT(probe_events);

static inline unsigned char *custom_skb_network_header(const struct sk_buff *skb)
{
	return skb->head + skb->network_header;
}

static inline struct iphdr *get_iphdr_in_icmp(const struct sk_buff *skb)
{
    return (struct iphdr *)custom_skb_network_header(skb);
}

int probe_icmp(struct pt_regs *ctx, struct net *net, struct sock *sk, struct sk_buff *skb){
    struct iphdr * ipdata=get_iphdr_in_icmp(skb);
    if (ipdata->protocol!=1){
        return 1;
    }
    u64 __pid_tgid = bpf_get_current_pid_tgid();
    u32 __pid = __pid_tgid;
    struct probe_icmp_sample __data = {0};
    __data.pid = __pid;
    u32 daddress;
    u32 saddress;
    bpf_probe_read(&daddress, sizeof(ipdata->daddr), &ipdata->daddr);
    bpf_probe_read(&saddress, sizeof(ipdata->daddr), &ipdata->saddr);
    __data.daddress=daddress;
    __data.saddress=saddress;
    probe_events.perf_submit(ctx, &__data, sizeof(__data));
    return 0;
}

"""


class IcmpSamples(ctypes.Structure):
    _fields_ = [
        ("pid", ctypes.c_uint32),
        ("daddress", ctypes.c_uint32),
        ("saddress", ctypes.c_uint32),
    ]


bpf = BPF(text=bpf_text)

filters = {}


def parse_ip_address(data):
    results = [0, 0, 0, 0]
    results[3] = data & 0xFF
    results[2] = (data >> 8) & 0xFF
    results[1] = (data >> 16) & 0xFF
    results[0] = (data >> 24) & 0xFF
    return ".".join([str(i) for i in results[::-1]])


def print_icmp_event(cpu, data, size):
    # event = b["probe_icmp_events"].event(data)
    event = ctypes.cast(data, ctypes.POINTER(IcmpSamples)).contents
    daddress = parse_ip_address(event.daddress)
    print(
        f"pid:{event.pid}, daddress:{daddress}, saddress:{parse_ip_address(event.saddress)}"
    )


bpf.attach_kprobe(event="ip_finish_output", fn_name="probe_icmp")

bpf["probe_events"].open_perf_buffer(print_icmp_event)
while 1:
    try:
        bpf.kprobe_poll()
    except KeyboardInterrupt:
        exit()
```

OK，这段代码严格意义上来说是混编的，一部分是 C，一部分是 Python，。Python 部分大家肯定都很熟悉，BCC 帮我们加载我们的 C 代码，并 attch 到 kprobe 上。然后不断输出我们从内核中往外传输的数据

那我们重点来看看 C 部分的代码（实际上这严格来说不算标准 C，算是 BCC 封装的一层 DSL）

首先看一下我们辅助的两个函数

```c
static inline unsigned char *custom_skb_network_header(const struct sk_buff *skb)
{
	return skb->head + skb->network_header;
}

static inline struct iphdr *get_iphdr_in_icmp(const struct sk_buff *skb)
{
    return (struct iphdr *)custom_skb_network_header(skb);
}
```

如前面所说，我们可以根据 sk_buff 中的 head 和 network_header 就能计算出我们 IP 头部在内存中的地址，然后我们将其 cast 成一个 `iphdr` 结构体指针

我们还得再来看一下 iphdr

```c
struct iphdr {
#if defined(__LITTLE_ENDIAN_BITFIELD)
	__u8	ihl:4,
		version:4;
#elif defined (__BIG_ENDIAN_BITFIELD)
	__u8	version:4,
  		ihl:4;
#else
#error	"Please fix <asm/byteorder.h>"
#endif
	__u8	tos;
	__be16	tot_len;
	__be16	id;
	__be16	frag_off;
	__u8	ttl;
	__u8	protocol;
	__sum16	check;
	__be32	saddr;
	__be32	daddr;
	/*The options start here. */
};
```

熟悉 IP 报文结构的同学肯定就很眼熟了对吧，其中 `saddr` 和 `daddr` 就是我们的源地址和目标地址，`protocol` 代表着我们 L4 协议的类型，其中为1的时候代表着 ICMP 协议

OK 然后来看一下我们的 trace 函数

```c
int probe_icmp(struct pt_regs *ctx, struct net *net, struct sock *sk, struct sk_buff *skb){
    struct iphdr * ipdata=get_iphdr_in_icmp(skb);
    if (ipdata->protocol!=1){
        return 1;
    }
    u64 __pid_tgid = bpf_get_current_pid_tgid();
    u32 __pid = __pid_tgid;
    struct probe_icmp_sample __data = {0};
    __data.pid = __pid;
    u32 daddress;
    u32 saddress;
    bpf_probe_read(&daddress, sizeof(ipdata->daddr), &ipdata->daddr);
    bpf_probe_read(&saddress, sizeof(ipdata->daddr), &ipdata->saddr);
    __data.daddress=daddress;
    __data.saddress=saddress;
    probe_events.perf_submit(ctx, &__data, sizeof(__data));
    return 0;
}
```

如前面所说，kprobe 触发调用时，会将 `ip_finish_output` 的三个参数传入到我们的 trace 函数中来，那我们就可以根据传入的数据做很多的事了，现在来介绍下上面的代码中所做的事

1. 将 sk_buff 转换成对应的 iphdr
2. 判断当前报文是否为 ICMP 协议
3. 利用内核 BPF 提供的 helper `bpf_get_current_pid_tgid` 获取当前调用 `ip_finish_output` 进程的 pid
4. 获取 saddr 和 daddr。注意我们这里用的 bpf_probe_read 也是 BPF 提供的 helper function，原则上来讲，在 eBPF 中为了保证安全，我们所有从内核中读取数据的行为都应该利用 `bpf_probe_read` 或 `bpf_probe_read_kernel` 来实现
5. 通过 perf 将数据提交出去

这样一来，我们就能排查到机器上具体什么进程在发送 ICMP 请求了

来看下效果

![image](https://user-images.githubusercontent.com/7054676/115132783-db6d0d00-a035-11eb-952a-3fcf33c86690.png)

OK，我们的需求基本上达到了，不过这里算是留了一个小问题，大家可以思考下，我们怎么样根据 pid 获取启动进程时的 cmdline ?

### SystemTap + kprobe

eBPF 的版本实现了，但是有个问题啊，eBPF 只能在高版本的内核中使用。一般而言，在 xb86_64 上，Linux 3.16 中支持了 eBPF。而我们依赖的 kprobe 对于 eBPF 的支持则是在 Linux 4.1 中实现的。通常而言，我们一般推荐使用 4.9 及以上内核来配合 eBPF 使用

那么问题来了。实际上我们现在有很多 Centos 7 + Linux 3.10 这样的传统的搭配，那么他们怎么办呢？

> Linux 3.10 live's matter! Centos 7 live's matter!

那没办法，只能换一个技术栈来做了。这个时候，我们就首先考虑由 RedHat 开发，贡献进入社区，低版本可用的 SystemTap

```bash
%{
#include<linux/byteorder/generic.h>
#include<linux/if_ether.h>
#include<linux/skbuff.h>
#include<linux/ip.h>
#include<linux/in.h>
#include<linux/tcp.h>
#include <linux/sched.h>
#include <linux/list.h>
#include <linux/pid.h>
#include <linux/mm.h>
%}

function isicmp:long (data:long)
%{
    struct iphdr *ip;
    struct sk_buff *skb;
    int tmp = 0;

    skb = (struct sk_buff *) STAP_ARG_data;

    if (skb->protocol == htons(ETH_P_IP)){
            ip = (struct iphdr *) skb->data;
            tmp = (ip->protocol == 1);
    }
    STAP_RETVALUE = tmp;
%}

function task_execname_by_pid:string (pid:long) %{
    struct task_struct *task;

    task = pid_task(find_vpid(STAP_ARG_pid), PIDTYPE_PID);

//     proc_pid_cmdline(p, STAP_RETVALUE);
    snprintf(STAP_RETVALUE, MAXSTRINGLEN, "%s", task->comm);
    
%}

function ipsource:long (data:long)
%{
    struct sk_buff *skb;
    struct iphdr *ip;
    __be32 src;

    skb = (struct sk_buff *) STAP_ARG_data;

    ip = (struct iphdr *) skb->data;
    src = (__be32) ip->saddr;

    STAP_RETVALUE = src;
%}

/* Return ip destination address */
function ipdst:long (data:long)
%{
    struct sk_buff *skb;
    struct iphdr *ip;
    __be32 dst;

    skb = (struct sk_buff *) STAP_ARG_data;

    ip = (struct iphdr *) skb->data;
    dst = (__be32) ip->daddr;

    STAP_RETVALUE = dst;
%}

function parseIp:string (data:long) %{ 
    sprintf(STAP_RETVALUE,"%d.%d,%d.%d",(int)STAP_ARG_data &0xFF,(int)(STAP_ARG_data>>8)&0xFF,(int)(STAP_ARG_data>>16)&0xFF,(int)(STAP_ARG_data>>24)&0xFF);
%}


probe kernel.function("ip_finish_output").call {
    if (isicmp($skb)) {
        pid_data = pid()
        /* IP */
        ipdst = ipdst($skb)
        ipsrc = ipsource($skb)
        printf("pid is:%d,source address is:%s, destination address is %s, command is: '%s'\n",pid_data,parseIp(ipsrc),parseIp(ipdst),task_execname_by_pid(pid_data))
    
    } else {
        next
    }
}

```

实际上大家可以看到，我们思路还是一样，利用 `ip_finish_output` 来作为 kprobe 的 hook 点，然后我们获取对应的 iphdr 然后进行操作。

嗯，我们的需求的基础功能差不多就是这样了，大家可以在额外进行一些功能增强，比如获取完整的进程 cmdline 等等

## 更近一步的想法和实验

大家可能对于 ICMP 这样的冷门协议没有太明显的感觉，那么我们换个需求大家可能就更为有感觉了

> 监控机器上哪些进程在发出 HTTP 1.1 请求

嗯，一如往的，我们先来看一下系统中的关键调用

![TCP](https://user-images.githubusercontent.com/7054676/115133429-baf38180-a03a-11eb-903f-f2cf46f3edd0.png)

嗯，这里我们选择 `tcp_sendmsg` 来作为我们的切入点

```c
int tcp_sendmsg(struct sock *sk, struct msghdr *msg, size_t size)
{
	int ret;

	lock_sock(sk);
	ret = tcp_sendmsg_locked(sk, msg, size);
	release_sock(sk);

	return ret;
}
```

嗯，其中 `sock` 是包含我们一些关键元数据的结构体

```c
struct sock {
	/*
	 * Now struct inet_timewait_sock also uses sock_common, so please just
	 * don't add nothing before this first member (__sk_common) --acme
	 */
	struct sock_common	__sk_common;
    ...
}

struct sock_common {
	/* skc_daddr and skc_rcv_saddr must be grouped on a 8 bytes aligned
	 * address on 64bit arches : cf INET_MATCH()
	 */
	union {
		__addrpair	skc_addrpair;
		struct {
			__be32	skc_daddr;
			__be32	skc_rcv_saddr;
		};
	};
	union  {
		unsigned int	skc_hash;
		__u16		skc_u16hashes[2];
	};
	/* skc_dport && skc_num must be grouped as well */
	union {
		__portpair	skc_portpair;
		struct {
			__be16	skc_dport;
			__u16	skc_num;
		};
	};
    ...
}
```

大家可以看到，我们能在 `sock` 中获取到我们端口的五元组数据，然后我们从 `msghdr` 中能获取到具体的数据

那么，以我们需求中的 HTTP 为例，我们实际上只需要判断，我们获取到的 TCP 包中是否包含 **HTTP/1.1** ，便可粗略判断，这个请求是否是 HTTP 1.1 请求（很暴力的做法Hhhhh

OK，我们来看下代码

```python
from bcc import BPF
import ctypes
import binascii

bpf_text = """
#include <linux/ptrace.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <uapi/linux/ptrace.h>
#include <net/sock.h>
#include <bcc/proto.h>
#include <linux/socket.h>

struct ipv4_data_t {
    u32 pid;
    u64 ip;
    u32 saddr;
    u32 daddr;
    u16 lport;
    u16 dport;
    u64 state;
    u64 type;
    u8 data[300];
    u16 data_size;
};


BPF_PERF_OUTPUT(ipv4_events);

int trace_event(struct pt_regs *ctx,struct sock *sk, struct msghdr *msg, size_t size){
    if (sk == NULL)
        return 0;
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    

    // pull in details
    u16 family = sk->__sk_common.skc_family;
    u16 lport = sk->__sk_common.skc_num;
    u16 dport = sk->__sk_common.skc_dport;
    char state = sk->__sk_common.skc_state;

    if (family == AF_INET) {
        struct ipv4_data_t data4 = {};
        data4.pid = pid;
        data4.ip = 4;
        //data4.type = type;
        data4.saddr = sk->__sk_common.skc_rcv_saddr;
        data4.daddr = sk->__sk_common.skc_daddr;
        // lport is host order
        data4.lport = lport;
        data4.dport = ntohs(dport);
        data4.state = state;
        struct iov_iter temp_iov_iter=msg->msg_iter;
        struct iovec *temp_iov=temp_iov_iter.iov;
        bpf_probe_read_kernel(&data4.data_size, 4, &temp_iov->iov_len);
        u8 * temp_ptr;
        bpf_probe_read_kernel(&temp_ptr, sizeof(temp_ptr), &temp_iov->iov_base);
        bpf_probe_read_kernel(&data4.data, sizeof(data4.data), temp_ptr);
        ipv4_events.perf_submit(ctx, &data4, sizeof(data4));
    }
    return 0;
}

"""

bpf = BPF(text=bpf_text)

filters = {}


def parse_ip_address(data):
    results = [0, 0, 0, 0]
    results[3] = data & 0xFF
    results[2] = (data >> 8) & 0xFF
    results[1] = (data >> 16) & 0xFF
    results[0] = (data >> 24) & 0xFF
    return ".".join([str(i) for i in results[::-1]])


def print_http_payload(cpu, data, size):
    # event = b["probe_icmp_events"].event(data)
    # event = ctypes.cast(data, ctypes.POINTER(IcmpSamples)).contents
    event= bpf["ipv4_events"].event(data)
    daddress = parse_ip_address(event.daddr)
    # data=list(event.data)
    # temp=binascii.hexlify(data) 
    body = bytearray(event.data).hex()
    if "48 54 54 50 2f 31 2e 31".replace(" ", "") in body:
        # if "68747470" in temp.decode():
        print(
            f"pid:{event.pid}, daddress:{daddress}, saddress:{parse_ip_address(event.saddr)}, {event.lport}, {event.dport}, {event.data_size}"
        )


bpf.attach_kprobe(event="tcp_sendmsg", fn_name="trace_event")

bpf["ipv4_events"].open_perf_buffer(print_http_payload)
while 1:
    try:
        bpf.perf_buffer_poll()
    except KeyboardInterrupt:
        exit()
```

OK，我们来看下效果

![效果](https://user-images.githubusercontent.com/7054676/115135218-4ecc4a00-a049-11eb-899b-baecffdb6268.png)

实际上这个我们还可以再扩展一下。比如针对 Go 这样，所发出的 HTTPS 连接有着固定特征的语言，我们也可以用相对简单的做法去完成机器上的包来源的溯源（大家可以参考下无辄的这篇文章，[为什么用 Go 访问某网站始终会 503 Service Unavailable ？](https://www.imwzk.com/posts/2021-03-14-why-i-always-get-503-with-golang/#%E5%B0%BE%E5%A3%B0))

我自己也做了一个测试，大家可以参考下代码：https://github.com/Zheaoli/linux-traceing-script/blob/main/ebpf/go-https-tracing.py

## 总结

实际上无论是 eBPF 还是 SystemTap ，这类动态 tracing 技术可以 Linux Kernel 变得更具被可编程性。相较于传统的 recompile kernel 这些手段来说，更为方便快捷。而 BCC/BPFTrace 这类的更进一步的封装框架的出现，更进一步的降低了我们去观测内核的难度

很多时候我们很多需求都可以选择旁路的方式去更快捷的实现。但是要注意的一点是，动态 tracing 技术的引入势必增加了内核的不稳定性，而且一定程度上会影响性能。所以我们需要根据具体的场景去做 trade-off

好了，这篇文章差不多就水到这里，后面有时间争取出一个 eBPF 从入门到入土的系列文章（flag++
