---
title: 关于用户态栈回溯（Unwind）的一些杂记和想法
type: tags
date: 2023-08-23 00:09:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

随手记录一些关于用户态栈回溯（Unwind）的一些杂记和想法。

## 正文

昨晚三点过刚吃完药躺在床上休息的时候，突然想到了 @yihong0618 的之前在群里的一个想法

> 我在想 eBPF 能不能 trace libpq 的协议，好像还没有人做过

我最开始的一个想法是

> 现在主流做法还是 ptrace 系的东西（gdb 那套），你要用 eBPF 去 trace libpq 肯定没问题，就和 Grey 用 uprobe 去 trace go 一样，手算 cast。但是这里另外一个问题是 libpq 的符号信息不一定够。我倾向你可以这样试一下，你改一下 libpq 源码，关键地方走 USDT（我看你之前用过）

不过后续我师父出来有了一个提醒

> 如果目标是 trace libpq.so 的调用情况，那应该目前就可以做到。
> .so 相比 executable 有几个优势：
> 1. 它一定有动态符号表
> 2. 它一定有 .eh_frame
> uprobe 恰好又是 attach to the binary offset 而不是 process address，所以第一个优势完美匹配 uprobe，甚至绕开了 executable 本身如果是 PIE 的复杂情况。
> 栈回溯则完美利用了第二个优势。举例来说，默认的 libc.so 里的函数都是 -fomit-frame-pointer 所以不能用 bp = *bp 来回溯，但是可以用 FDE (Frame Description Entry) 来回溯。DWARF 的 .debug_frame 和 .so 的 .eh_frame 就包含了这样的信息，所以足够让我们从 .so 回溯回 executable。
> 所以目前的基建已经完全足够做一个 libpq.so 的 bpf tracer，而不需要任何前提假设。

的确是。。LSB 规定的信息足够多，我之前忽略了这点。一般发行版都是带了 .eh_frame, 里面的 CFI 是可以做栈回溯的，而且我看了下 PG 默认的编译是没开 no-asynchronous-unwind-tables 的，基本上可以确保一定会带这 eh_frame。（注：这个选项用来控制是否生成 .eh_frame）

所以说做就做，爬起来想先做一个 PoC。先去 Review 了一下手上的工具，发现可能 systemtap 是比较适合的工具，他内部已经实现了一套 DWARF，符号表相关信息解析的功能，所以可以直接复用，先写了一个 Demo 的 PG 代码

```c
#include <stdio.h>
#include <stdlib.h>
#include <libpq-fe.h>

void do_exit(PGconn *conn) {
    PQfinish(conn);
    exit(1);
}

void demo2() {
    PGconn *conn = PQconnectdb("host=127.0.0.1 user=postgres password=example");

    if (PQstatus(conn) == CONNECTION_BAD) {
        fprintf(stderr, "Connection to database failed: %s\n", PQerrorMessage(conn));
        do_exit(conn);
    }

    PGresult *res = PQexec(conn, "SELECT VERSION()");    

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        printf("No data retrieved\n");        
        PQclear(res);
        do_exit(conn);
    }    

    printf("%s\n", PQgetvalue(res, 0, 0));
    
    PQclear(res);
    PQfinish(conn);

}

void demo1() {
    demo2();
}

int main() {
    demo1();
    return 0;
}

```

然后起起 systemtap 写个钩子

```text
probe process("/lib64/libpq.so").function("PQconnectdb") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQexec") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQresultStatus") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQclear") {
    print_ubacktrace()
}


probe process("/lib64/libpq.so").function("PQfinish") {
    print_ubacktrace()
}
```

执行效果是这样

```text
probe process("/lib64/libpq.so").function("PQconnectdb") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQexec") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQresultStatus") {
    print_ubacktrace()
}

probe process("/lib64/libpq.so").function("PQclear") {
    print_ubacktrace()
}


probe process("/lib64/libpq.so").function("PQfinish") {
    print_ubacktrace()
}
```

没什么问题，心满意足的准备去睡觉

起来后顺便复习了一些用户态栈回溯的细节

## 一些杂记

用户态栈回溯核心的一个要解决的点就是增强程序的可追踪性。

在传统 X86 模式下，我们有这样的栈帧结构

![X86 栈帧](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/a1015149-4160-4f3c-b2da-dab8ff4ad2a4)

大体概括就是利用 ebp 寄存器保存栈帧地址，esp 保存栈顶指针，在调用过程里，将上一个栈帧地址入栈保存

在这种情况下，我们不管是调试器还是其他的工具，都可以通过 ebp 和 esp 来进行栈回溯，这种方式优缺点都很明显

优点就是足够的简单，缺点的话大概有这样一些方面

1. 浪费一个固定的通用寄存器
2. 保存回溯信息时有额外的指令跳转开销
3. 回溯出来的信息上下文不够，通常只能恢复堆栈寄存器的内容

所以在这种情况下，进入64位时代后，这种栈帧结构被放弃，gcc 在64位编译下默认不使用 rbp 寄存器来保存栈帧地址了（不过可以通过 -fno-omit-frame-pointer 选项打开）

在栈帧结构变化后，我们现在要进行栈回溯，就需要依赖额外的一些调试信息了。

说到调试信息，大家第一反应肯定是 DWARF (aka Debugging With Attributed Record Formats)，在这一套信息中，定义了一套 CFI (Call Frame Information) 的规范，用来描述栈帧的结构，这套规范在 GCC 和 LLVM 中都有实现。目前 CFI 相关信息存放在程序的 .debug_frame 和 ,.eh_frame 段中。我们可以用一下 readelf 来查看，这里以我们上面的 C 代码的编译结果为例

```text
000000b4 000000000000001c 000000b8 FDE cie=00000000 pc=00000000000012fc..0000000000001311
   LOC           CFA      rbp   ra    
00000000000012fc rsp+8    u     c-8   
00000000000012fd rsp+16   c-16  c-8   
0000000000001300 rbp+16   c-16  c-8   
0000000000001310 rsp+8    c-16  c-8   
```

这里的 FDE (Frame Description Entry) 就是一条 CFI 信息，里面包含了一些寄存器的信息，比如 rsp, rbp, ra 等等，这些信息可以用来进行栈回溯。

整个过程差不多如下

1. 根据当前 PC 指针值，遍历 .eh_frame ，找到对应的 FDE，然后计算便宜
2. 根据 CFA (Canonical Frame Address) 计算出当前栈帧的地址（比如 rsp+8），然后计算出通用寄存器地址和返回地址在栈中的位置
3. 比如这里一个通用寄存器的地址是 rsp-16
4. 返回地址 ra 的地址是 rsp-8
5. 然后根据 ra 值重复以上部分，就可以进行栈回溯

当然这里还有很多工程的部分要去做，比如你需要走 auxv 去拿到进程加载后的 ELF，你需要去遍历符号表之类的东西（XD

现在有一些成套的基础设施可以用，列一下仅供参考

1. GCC 自带的宏， __buildin_return_address,
2. libunwind

## 总结下

实际上这个工作还有很多的内容要去做，比如你通过 FFI 调用 so 后，你直接进行 native 的栈回溯得到的结果是这样

```text
 0x7f641a21aea0 : PQsendQuery+0x0/0x10 [/usr/lib/libpq.so.5.15]
 0x7f641ba874f6 [/usr/lib/libffi.so.8.1.2+0x74f6/0xb000]
```

如果你想拿到 FFI 另外一侧的信息，那又是一翻额外的工作量（比如 Python）

以及 unwind 下还有很多噩梦级别的 case 要去处理，比如 PIE，比如 strip 信息后的二进制。如果想用 eBPF 重写 libunwind 的话，我觉得跳楼可能更快一些（不是

所以遇到问题的时候，可能优先考虑编译一些带着埋点的二进制文件。有可能你搞 print 大法都比 unwind 更好用（XD

差不多这样
