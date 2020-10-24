---
title: 简单聊聊进程中的信号处理
type: tags
date: 2020-10-24 21:09:00
tags: [编程,分布式,论文,笔记,水文]
categories: [编程,水文,论文]
---

最近在某个技术群里帮人分析了 Linux 编程下信号处理的一段代码。我自己觉得这段代码是挺不错的一个例子，所以写个简单的水文，用这段代码聊聊 Linux 中的信号处理

<!--more-->

## 正文

我们首先来看一看这一段代码

```c
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

void deletejob(pid_t pid) { printf("delete task %d\n", pid); }

void addjob(pid_t pid) { printf("add task %d\n", pid); }

void handler(int sig) {
  int olderrno = errno;
  sigset_t mask_all, prev_all;
  pid_t pid;
  sigfillset(&mask_all);
  while ((pid = waitpid(-1, NULL, 0)) > 0) {
    sigprocmask(SIG_BLOCK, &mask_all, &prev_all);
    deletejob(pid);
    sigprocmask(SIG_SETMASK, &prev_all, NULL);
  }
  if (errno != ECHILD) {
    printf("waitpid error");
  }
  errno = olderrno;
}

int main(int argc, char **argv) {
  int pid;
  sigset_t mask_all, prev_all;
  sigfillset(&mask_all);
  signal(SIGCHLD, handler);
  while (1) {
    if ((pid = fork()) == 0) {
      execve("/bin/date", argv, NULL);
    }
    sigprocmask(SIG_BLOCK, &mask_all, &prev_all);
    addjob(pid);
    sigprocmask(SIG_SETMASK, &prev_all, NULL);
  }
}
```

实际上这段代码是比较典型的信号处理的代码，为了引出后续的内容，我们先来复习一下，这段代码中几个关键的 `syscall` 

1. **signal**[<sup>1</sup>](#refer-anchor-1): 信号处理函数，使用者可以通过这个函数为当前进程指定具体信号的 Handler。当信号触发时，系统会调用具体的 Handler 进行对应的逻辑处理。
2. **sigfillset**[<sup>2</sup>](#refer-anchor-2): 用于操作 **signal sets**（信号集）的函数之一，这里的含义是将系统所有支持的信号量添加进一个信号集中
3. **fork**[<sup>3</sup>](#refer-anchor-3): 大家比较熟悉的一个 API 了，创建一个新的进程，并返回 **pid** 。如果是在父进程中，返回的 **pid** 是对应子进程的 **pid**。如果子进程中，**pid** 为0
4. **execve**[<sup>4</sup>](#refer-anchor-4): 执行一个特定的可执行文件
5. **sigprocmask**[<sup>5</sup>](#refer-anchor-5)：设置进程的信号屏蔽集。当传入第一个参数为 **SIG_BLOCK** 时，函数会将当前进程的信号屏蔽集保存在第三个参数传入的信号集变量中，并将当前进程的信号屏蔽集设置为第二个参数传入的信号屏蔽集。当第一个参数为 **SIG_SETMASK** 时，函数会将当前进程的信号屏蔽集设置为第二个参数设置的值。
6. **wait_pid**[<sup>6</sup>](#refer-anchor-6): 做一个不精确的概括，回收并释放已终止的子进程的资源。

OK 了解完这样一些关键的 **syscall** 后，这段代码那么基本上不难理解了。但是要吃透这段代码，我们还需要去复习一下一些 Linux 或者说 POSIX 中的机制：

1. 由 `fork` 创建出来的子进程，会继承父进程中的很多东西。就本文中聊的信号一部分来说，子进程会继承父进程的信号屏蔽集和信号处理函数的相关设置
2. `execve` 执行后，会重设当前进程的程序段与堆栈。所以在上面的代码中我们执行 `/bin/date` 后，子进程会被重设。信号处理函数等设置也会被重设
3. 每个进程都有信号屏蔽集，在信号屏蔽集中的信号被触发时，会进入一个队列，暂时不会触发进程的信号处理，此时信号处于 **pending** 状态。在取消对应信号的屏蔽与阻塞后，再次触发进程的信号处理机制。如果进程显式声明忽略信号，那么不会触发信号的处理。（Tips：关于信号队列这一点，这是一个 POSIX 1. 的约定。在 POSIX 中将这种机制称为**可靠信号**，当阻塞期间，有多个信号发生时，会进入一个可靠队列确保信号能被妥投。 Linux 支持可靠信号，其余 Unix/类 Unix 不一定支持）
4. 子进程退出后，会给所属的父进程传递一个 **SIGCHLD**[<sup>1</sup>](#refer-anchor-1) 信号，父进程在接受到这种信号后，需要调用 **wait_pid**[<sup>6</sup>](#refer-anchor-6) 函数对子进程进行处理。否则未被回收的子进程，会成为一个僵尸进程，也就是通常说的 Z 进程

OK，到现在，大家在掌握这些东西后，对于上面的代码应该能完整明白了。不过可能大家还有一个疑惑，为什么在这段代码中需要调用 **sigprocmask**[<sup>5</sup>](#refer-anchor-5) 设置进程的信号屏蔽集来阻塞信号呢？这涉及到另一个问题。

如前面所说，信号在触发时，进程会"跳转“对应的信号处理函数进行处理。但是信号处理函数处理完后的行为会怎么样呢？依照 Linux 中的设计，可能会出现两种情况

1. 对于可重入函数而言，信号处理函数返回后会继续处理
2. 对于不可重入函数而言，会返回 **EINTR**[<sup>1</sup>](#refer-anchor-1)

OK 大家这里应该对我们为什么会在这里使用 **sigprocmask**[<sup>5</sup>](#refer-anchor-5) 有具体的了解了，实际上是为了保证我们的一些函数能够正常的执行完，不会被信号处理所打断。当然这里也有其余的问题，如果信号触发特别密集的情况下，这里的处理会带来额外的 cost。所以还是需要根据不同的场景做 trade-off 了。

好了。差不多就这样吧，福报久了真没力气写文章，💊。下一篇文章应该就是我最近做内核协议栈监控的一些吃屎记录了（flag++（逃。

## Reference

<div id="refer-anchor-1"></div>

- [1]. [Linux man page: signal](https://man7.org/linux/man-pages/man7/signal.7.html)

<div id="refer-anchor-2"></div>

- [2]. [Linux man page: sigfillset](https://linux.die.net/man/3/sigfillset)

<div id="refer-anchor-3"></div>

- [3]. [Linux man page: fork](https://man7.org/linux/man-pages/man2/fork.2.html)

<div id="refer-anchor-4"></div>

- [4]. [Linux man page: execve](https://man7.org/linux/man-pages/man2/execve.2.html)

<div id="refer-anchor-5"></div>

- [5]. [Linux man page: sigprocmask](https://man7.org/linux/man-pages/man2/sigprocmask.2.html)

<div id="refer-anchor-6"></div>

- [6]. [Linux man page: waitpid](https://linux.die.net/man/2/waitpid)