---
title: Debug 日志：eCapture GH-604
type: tags
date: 2024-09-18 22:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

Debug 日志系列第二篇，eCapture 的 GH-604， 一个和 Go， Glibc，静态编译相关的问题

太长不看版：在 eCapture 中，由于在静态链接时 glibc 版本的差异，导致在 Ubuntu 下编译的二进制会在特定发行版上 Segment fault

<!--more-->

## 开篇

首先介绍下 eCapture，这个项目是基于 eBPF 做的一套安全工具，核心的能力是可以提供在旁路对于 TLS 流量解密的能力

在8月25日的时候，社区反馈了一个 bug，编号 GH-604，其核心行为如下

下载在 GitHub Release 中发布的二进制，在 Arch Linux 下会 Segment Fault，报错大致如下

```go
2024-09-18T21:10:47+08:00 INF BTF bytecode mode: CORE. btfMode=0
2024-09-18T21:10:47+08:00 INF module initialization. isReload=false moduleName=EBPFProbeOPENSSL
2024-09-18T21:10:47+08:00 INF Module.Run()
SIGSEGV: segmentation violation
PC=0x7f29ee844696 m=5 sigcode=1 addr=0x1e83c0
signal arrived during cgo execution

goroutine 19 gp=0xc0005b81c0 m=5 mp=0xc000100008 [syscall]:
runtime.cgocall(0x10990e0, 0xc0000bca90)
        /root/.go/src/runtime/cgocall.go:167 +0x4b fp=0xc0000bca58 sp=0xc0000bca20 pc=0x4739ab
net._C2func_getaddrinfo(0xc00058e3c0, 0x0, 0xc0005886f0, 0xc00058a0a0)
        _cgo_gotypes.go:108 +0x55 fp=0xc0000bca90 sp=0xc0000bca58 pc=0x84a7f5
net._C_getaddrinfo.func1(0xc00058e3c0, 0x0, 0xc0005886f0, 0xc00058a0a0)
        /root/.go/src/net/cgo_unix_cgo.go:78 +0xeb fp=0xc0000bcb48 sp=0xc0000bca90 pc=0x84af4b
net._C_getaddrinfo(0xc00058e3c0, 0x0, 0xc0005886f0, 0xc00058a0a0)
        /root/.go/src/net/cgo_unix_cgo.go:78 +0x6c fp=0xc0000bcbd0 sp=0xc0000bcb48 pc=0x84adac
net.cgoLookupHostIP({0x1351556, 0x3}, {0x13727d2, 0x9})
        /root/.go/src/net/cgo_unix.go:181 +0x3f9 fp=0xc0000bce38 sp=0xc0000bcbd0 pc=0x7f65b9
net.cgoLookupIP.func1()
        /root/.go/src/net/cgo_unix.go:226 +0x85 fp=0xc0000bcf00 sp=0xc0000bce38 pc=0x7f7145
net.doBlockingWithCtx[...].func1()
        /root/.go/src/net/cgo_unix.go:70 +0x8f fp=0xc0000bcfe0 sp=0xc0000bcf00 pc=0x84de4f
runtime.goexit({})
        /root/.go/src/runtime/asm_amd64.s:1700 +0x1 fp=0xc0000bcfe8 sp=0xc0000bcfe0 pc=0x482301
created by net.doBlockingWithCtx[...] in goroutine 18
        /root/.go/src/net/cgo_unix.go:67 +0x3c5
```

我在 Garuda 下能复现同样的问题，由于作者没有 Arch Linux 的环境，那么就由我来接手了

最开始的排查方向是先利用容器环境进行启动，发现执行正常。那么目前可以初步判断是依赖的二进制版本不同导致的问题，但是 eCapture 依赖的二进制有点多，那么怎么办呢？

这个时候 issue 的提出者提供了一个关键点，这个问题是 v0.8.1 之后出现的，那么很好办，祭出我们的 `git bisect` 大法

最后确定是 938fcffb95e23015af8643ae046c0e912de0a438 带来的问题，我们来看一下代码，这个代码核心的的变更在于

1. 重构了一部分 Module 的注册逻辑
2. 引入 Gin 框架来作为 HTTP Configuration 变更的框架

那么这里我们来调试一下，因为原本的二进制是 strip 了符号信息，我们先关闭符号信息， 然后上 gdb ，获取崩溃时的栈信息，能得到如下信息

```text
[Switching to LWP 1772723]
0x00007fffabe44696 in __ctype_init () from /usr/lib/libc.so.6
(gdb) bt
#0  0x00007fffabe44696 in __ctype_init () from /usr/lib/libc.so.6
#1  0x00007fffabf785d1 in __libc_early_init () from /usr/lib/libc.so.6
#2  0x000000000118729f in dl_open_worker_begin ()
#3  0x000000000113a7b8 in _dl_catch_exception ()
#4  0x0000000001186469 in dl_open_worker ()
#5  0x000000000113a7b8 in _dl_catch_exception ()
#6  0x000000000118681b in _dl_open ()
#7  0x000000000113a8f6 in do_dlopen ()
#8  0x000000000113a7b8 in _dl_catch_exception ()
#9  0x000000000113a883 in _dl_catch_error ()
#10 0x000000000113aa74 in __libc_dlopen_mode ()
#11 0x0000000001128eb5 in module_load ()
#12 0x0000000001129315 in __nss_module_get_function ()
#13 0x0000000001118fec in getaddrinfo ()
#14 0x0000000001099119 in _cgo_04fbb8f65a5f_C2func_getaddrinfo (v=0xc00013ca90) at cgo-gcc-prolog:60
#15 0x0000000000481f84 in runtime.asmcgocall () at /root/.go/src/runtime/asm_amd64.s:923
#16 0x000000c0001048c0 in ?? ()
#17 0x000000000048045a in runtime.morestack () at /root/.go/src/runtime/asm_amd64.s:621
#18 0x47681163f543b200 in ?? ()
#19 0x0100000000000016 in ?? ()
#20 0x0000000000800000 in net.(*sysDialer).dialSerial (sd=0x0, ctx=..., ras=..., ~r0=..., ~r1=...) at /root/.go/src/net/dial.go:630
#21 0x0000000000000000 in ?? ()
```

我们能看到 `net.(*sysDialer).dialSerial` 非常显眼，这个函数通常是在使用 net.Dialer ，进行 TCP 的监听时处理的，我们根据这一个信息，对比 code diff，便能确定，这一点是我们所引入 Gin 框架，执行 TCP 监听流程时遇到问题。

我们再往下看，我们能看到 `getaddrinfo` 这个函数，这个是执行 DNS Lookup 的痕迹。我们将代码中的 `localhost:xx` 更改为 IP 地址的形式，如同我们所预料的一样，问题消失了

那么我们可以判定，这个问题是 Golang 走 CGO 调用 `getaddrinfo` 时变量导致的问题

我们可以在开源社区的 Issue 中，查到之前的 Report，参见 <https://github.com/golang/go/issues/30310>，解决方法是可以避免使用 glibc 提供的 DNS lookup 而使用 Go 内置实现的 DNS 来处理。

在将项目代码构建参数新增 `-tags 'netgo'` 后，问题解决。

那么这个问题就到词结束了吗？并不是，我们的问题依然存在，到底是什么原因导致我们会出现使用 glibc 的时候有 Segment fault 的发生？

我们先把我们复现代码最小化

```go
package main

import (
    "fmt"
    "net"
)

func main() {
    address := "localhost:8080"

    listener, err := net.Listen("tcp", address)
    if err != nil {
        fmt.Println("Error creating listener:", err)
        return
    }
    defer listener.Close()

    fmt.Printf("Listening on %s\n", address)

    for {
        conn, err := listener.Accept()
        if err != nil {
            fmt.Println("Error accepting connection:", err)
            continue
        }

        go handleConnection(conn)
    }
}

func handleConnection(conn net.Conn) {
    defer conn.Close()

    buffer := make([]byte, 1024)
    n, err := conn.Read(buffer)
    if err != nil {
        fmt.Println("Error reading from connection:", err)
        return
    }

    fmt.Printf("Received: %s\n", string(buffer[:n]))

    response := "Hello, client!"
    _, err = conn.Write([]byte(response))
    if err != nil {
        fmt.Println("Error writing to connection:", err)
        return
    }
}
```

我们先使用，`CGO_ENABLED=1 go build` 来构建复现代码，然后发现，可以在不同环境下运行。而当我们使用 `CGO_ENABLED=1 go build -ldflags "-linkmode=external -extldflags -static"` 的参数构建的产物则不可以。为什么呢？我们来对比下汇编

我们能发现在第一种参数构建的代码，其 `getaddrinfo` 的部分如下

```text
00000000004022a0 <getaddrinfo@plt>:
  4022a0:	ff 25 aa 3e 1e 00    	jmp    *0x1e3eaa(%rip)        # 5e6150 <getaddrinfo@GLIBC_2.2.5>
  4022a6:	68 27 00 00 00       	push   $0x27
  4022ab:	e9 70 fd ff ff       	jmp    402020 <_init+0x20>
```

哦，熟悉的 PLT 的部分，这一部分是纯动态链接，直接在加载时由链接器来处理。而第二种方式构建的的产物却不一样

```text
0000000000528fd0 <getaddrinfo>:
  528fd0:	f3 0f 1e fa          	endbr64
  528fd4:	55                   	push   %rbp
  528fd5:	48 89 e5             	mov    %rsp,%rbp
  528fd8:	41 57                	push   %r15
  528fda:	49 89 d7             	mov    %rdx,%r15
  528fdd:	41 56                	push   %r14
  528fdf:	41 55                	push   %r13
  528fe1:	41 54                	push   %r12
  528fe3:	49 89 f4             	mov    %rsi,%r12
  528fe6:	53                   	push   %rbx
  528fe7:	48 81 ec 38 07 00 00 	sub    $0x738,%rsp
  528fee:	48 89 bd 18 f9 ff ff 	mov    %rdi,-0x6e8(%rbp)
  528ff5:	48 89 8d b0 f8 ff ff 	mov    %rcx,-0x750(%rbp)
  528ffc:	64 48 8b 04 25 28 00 	mov    %fs:0x28,%rax
  529003:	00 00 
  529005:	48 89 45 c8          	mov    %rax,-0x38(%rbp)
  529009:	31 c0                	xor    %eax,%eax
  52900b:	48 c7 85 30 f9 ff ff 	movq   $0x0,-0x6d0(%rbp)
  529012:	00 00 00 00 
  529016:	48 85 ff             	test   %rdi,%rdi
  529019:	0f 84 3a 08 00 00    	je     529859 <getaddrinfo+0x889>
  52901f:	80 3f 2a             	cmpb   $0x2a,(%rdi)
  529022:	0f 84 27 08 00 00    	je     52984f <getaddrinfo+0x87f>
  529028:	4d 85 e4             	test   %r12,%r12
  52902b:	74 0b                	je     529038 <getaddrinfo+0x68>
  52902d:	41 80 3c 24 2a       	cmpb   $0x2a,(%r12)
  529032:	0f 84 7c 0b 00 00    	je     529bb4 <getaddrinfo+0xbe4>
  529038:	4d 85 ff             	test   %r15,%r15
  52903b:	0f 84 4f 08 00 00    	je     529890 <getaddrinfo+0x8c0>
  529041:	41 8b 07             	mov    (%r15),%eax
  529044:	a9 00 f8 ff ff       	test   $0xfffff800,%eax
  529049:	0f 85 6d 19 00 00    	jne    52a9bc <getaddrinfo+0x19ec>
  52904f:	48 83 bd 18 f9 ff ff 	cmpq   $0x0,-0x6e8(%rbp)
```

这里省略了很多的汇编，我们可以结合 GDB 的调试来看一下关键信息

```text
#0  0x00007fffb0044696 in __GI___ctype_init () at ctype-info.c:31
#1  0x00007fffb01785d1 in __libc_early_init (initial=false) at libc_early_init.c:35
#2  0x000000000059549f in dl_open_worker_begin ()
#3  0x000000000054a5e8 in _dl_catch_exception ()
#4  0x0000000000594669 in dl_open_worker ()
#5  0x000000000054a5e8 in _dl_catch_exception ()
#6  0x0000000000594a1b in _dl_open ()
#7  0x000000000054a726 in do_dlopen ()
#8  0x000000000054a5e8 in _dl_catch_exception ()
#9  0x000000000054a6b3 in _dl_catch_error ()
#10 0x000000000054a8a4 in __libc_dlopen_mode ()
#11 0x0000000000538ce5 in module_load ()
#12 0x0000000000539145 in __nss_module_get_function ()
#13 0x000000000052aa3c in getaddrinfo ()
#14 0x00000000004da549 in _cgo_04fbb8f65a5f_C2func_getaddrinfo (v=0xc0001acdd0) at /tmp/go-build/cgo-gcc-prolog:60
#15 0x0000000000471204 in runtime.asmcgocall () at /root/.go/src/runtime/asm_amd64.s:923
#16 0x000000c0001868c0 in ?? ()
```

我们能看到第二种方式（即使用外部链接器，以静态链接方式进行链接）的背后是会用 `dl_open` 去处理 glibc 的链接

我们直接跳转到 `__ctype_init` 看下源码以及汇编，这里第一段汇编是在 Glibc 2.35 下编译产物，第二段是在 Arch Linux 下的 Glibc 2.40 下编译的产物

```c
void
__ctype_init (void)
{
  const uint16_t **bp = __libc_tsd_address (const uint16_t *, CTYPE_B);
  *bp = (const uint16_t *) _NL_CURRENT (LC_CTYPE, _NL_CTYPE_CLASS) + 128;
  const int32_t **up = __libc_tsd_address (const int32_t *, CTYPE_TOUPPER);
  *up = ((int32_t *) _NL_CURRENT (LC_CTYPE, _NL_CTYPE_TOUPPER) + 128);
  const int32_t **lp = __libc_tsd_address (const int32_t *, CTYPE_TOLOWER);
  *lp = ((int32_t *) _NL_CURRENT (LC_CTYPE, _NL_CTYPE_TOLOWER) + 128);
}
```

```text
000000000055aee0 <__ctype_init>:
  55aee0:	f3 0f 1e fa          	endbr64
  55aee4:	48 c7 c0 80 ff ff ff 	mov    $0xffffffffffffff80,%rax
  55aeeb:	48 c7 c1 f0 ff ff ff 	mov    $0xfffffffffffffff0,%rcx
  55aef2:	64 48 8b 00          	mov    %fs:(%rax),%rax
  55aef6:	48 8b 00             	mov    (%rax),%rax
  55aef9:	48 8b 70 40          	mov    0x40(%rax),%rsi
  55aefd:	48 8d 96 00 01 00 00 	lea    0x100(%rsi),%rdx
  55af04:	64 48 89 11          	mov    %rdx,%fs:(%rcx)
  55af08:	48 8b 78 48          	mov    0x48(%rax),%rdi
  55af0c:	48 c7 c1 e8 ff ff ff 	mov    $0xffffffffffffffe8,%rcx
  55af13:	48 8d 97 00 02 00 00 	lea    0x200(%rdi),%rdx
  55af1a:	64 48 89 11          	mov    %rdx,%fs:(%rcx)
  55af1e:	48 8b 40 58          	mov    0x58(%rax),%rax
  55af22:	48 c7 c2 e0 ff ff ff 	mov    $0xffffffffffffffe0,%rdx
  55af29:	48 05 00 02 00 00    	add    $0x200,%rax
  55af2f:	64 48 89 02          	mov    %rax,%fs:(%rdx)
  55af33:	c3                   	ret
  55af34:	66 2e 0f 1f 84 00 00 	cs nopw 0x0(%rax,%rax,1)
  55af3b:	00 00 00 
  55af3e:	66 90                	xchg   %ax,%ax
```

第二段

```text
000000000111c270 <__ctype_init>:
 111c270:	f3 0f 1e fa          	endbr64
 111c274:	48 c7 c0 90 ff ff ff 	mov    $0xffffffffffffff90,%rax
 111c27b:	48 c7 c1 e8 ff ff ff 	mov    $0xffffffffffffffe8,%rcx
 111c282:	64 48 8b 00          	mov    %fs:(%rax),%rax
 111c286:	48 8b 00             	mov    (%rax),%rax
 111c289:	48 8b 70 38          	mov    0x38(%rax),%rsi
 111c28d:	48 8d 96 00 01 00 00 	lea    0x100(%rsi),%rdx
 111c294:	64 48 89 11          	mov    %rdx,%fs:(%rcx)
 111c298:	48 8b 78 40          	mov    0x40(%rax),%rdi
 111c29c:	48 c7 c1 e0 ff ff ff 	mov    $0xffffffffffffffe0,%rcx
 111c2a3:	48 8d 97 00 02 00 00 	lea    0x200(%rdi),%rdx
 111c2aa:	64 48 89 11          	mov    %rdx,%fs:(%rcx)
 111c2ae:	48 8b 40 50          	mov    0x50(%rax),%rax
 111c2b2:	48 c7 c2 d8 ff ff ff 	mov    $0xffffffffffffffd8,%rdx
 111c2b9:	48 05 00 02 00 00    	add    $0x200,%rax
 111c2bf:	64 48 89 02          	mov    %rax,%fs:(%rdx)
 111c2c3:	c3                   	ret
 111c2c4:	66 2e 0f 1f 84 00 00 	cs nopw 0x0(%rax,%rax,1)
 111c2cb:	00 00 00 
 111c2ce:	66 90                	xchg   %ax,%ax
```

我们能看到两段代码行为基本一致，但是 offset 存在明显差异。这个时候我们对比一下 Glibc 两个版本的代码的差异

我们能发现，由于 `__locale_data` 结构的变化，导致 `_NL_CTYPE_CLASS` 的 offset 在不同版本下存在偏移

```C
//v2.35

struct __locale_data
{
  const char *name;
  const char *filedata;		/* Region mapping the file data.  */
  off_t filesize;		/* Size of the file (and the region).  */
  enum				/* Flavor of storage used for those.  */
  {
    ld_malloced,		/* Both are malloc'd.  */
    ld_mapped,			/* name is malloc'd, filedata mmap'd */
    ld_archive			/* Both point into mmap'd archive regions.  */
  } alloc;

  /* This provides a slot for category-specific code to cache data computed
     about this locale.  That code can set a cleanup function to deallocate
     the data.  */
  struct
  {
    void (*cleanup) (struct __locale_data *);
    union
    {
      void *data;
      struct lc_time_data *time;
      const struct gconv_fcts *ctype;
    };
  } private;

  unsigned int usage_count;	/* Counter for users.  */

  int use_translit;		/* Nonzero if the mb*towv*() and wc*tomb()
				   functions should use transliteration.  */

  unsigned int nstrings;	/* Number of strings below.  */
  union locale_data_value
  {
    const uint32_t *wstr;
    const char *string;
    unsigned int word;		/* Note endian issues vs 64-bit pointers.  */
  }
  values __flexarr;	/* Items, usually pointers into `filedata'.  */
};

//v2.40

struct __locale_data
{
  const char *name;
  const char *filedata;		/* Region mapping the file data.  */
  off_t filesize;		/* Size of the file (and the region).  */
  enum				/* Flavor of storage used for those.  */
  {
    ld_malloced,		/* Both are malloc'd.  */
    ld_mapped,			/* name is malloc'd, filedata mmap'd */
    ld_archive			/* Both point into mmap'd archive regions.  */
  } alloc;

  /* This provides a slot for category-specific code to cache data
     computed about this locale.  Type of the data pointed to:

     LC_CTYPE   struct lc_ctype_data (_nl_intern_locale_data)
     LC_TIME    struct lc_time_data (_nl_init_alt_digit, _nl_init_era_entries)

     This data deallocated at the start of _nl_unload_locale.  */
  void *private;

  unsigned int usage_count;	/* Counter for users.  */

  int use_translit;		/* Nonzero if the mb*towv*() and wc*tomb()
				   functions should use transliteration.  */

  unsigned int nstrings;	/* Number of strings below.  */
  union locale_data_value
  {
    const uint32_t *wstr;
    const char *string;
    unsigned int word;		/* Note endian issues vs 64-bit pointers.  */
  }
  values __flexarr;	/* Items, usually pointers into `filedata'.  */
};
```

那么我们问题的 Root cause 也就得到了确定，整个问题的因果链如下

1. 我们项目使用引入 Gin，来作为 HTTP Server
2. 我们使用 localhost 来作为默认的监听地址
3. localhost 在服务端启动监听的时候触发了 DNS Lookup 行为
4. CGO_ENABLED=1 的情况下，Golang 默认使用 glibc 中的 `getaddrinfo` 进行 DNS lookup
5. 我们项目开启了 `-ldflags "-linkmode=external -extldflags -static"`，即使用外部链接器，以静态链接方式进行链接），将会使用 `dl_open` 来处理 glibc，而且这种情况下，`__ctype_init` 这类方法将会被静态编译至二进制中
6. Glibc 中特定字段不同版本的 offset 不一致
7. 结合 4&5&6, 我们在 Glibc 2.35 （即文中默认的构建机）静态编译后的产物，因为 offset 不一致，在 Glibc 2.40 （即 Arch Linux）下使用时，会出现 segment fault

问题得证

## 总结

这个问题变更只有一行，但是查了我很久的时间，反复在 Go 和 Glibc 的源码中横跳。顺便还去复习了 Linker 的很多知识

这某种意义上是我很喜欢这个行业的原因，因为我们所遇到的每个问题背后的风景，都很值得一看。

