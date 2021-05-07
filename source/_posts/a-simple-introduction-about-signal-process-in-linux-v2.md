---
title: 简单聊聊进程中的信号处理 V2
type: tags
date: 2020-11-07 21:09:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

上次写了一个水文[简单聊聊进程中的信号处理](https://manjusaka.itscoder.com/posts/2020/10/24/a-simple-introduction-about-signal-process-in-linux/) ，师父看了后把我怒斥了一顿，表示上篇水文中的例子太 old style, too simple ,too naive。如果未来出了偏差，我也要负泽任的。吓得我连和妹子周年庆的文章都没写，先赶紧来重新水一篇文章，聊聊更优秀，更方便的信号处理方式

<!--more-->

## 前情提要

首先来看看，之前那篇文章中的例子

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

再来复习下几个关键的 `syscall`

1. **signal**[<sup>1</sup>](#refer-anchor-1): 信号处理函数，使用者可以通过这个函数为当前进程指定具体信号的 Handler。当信号触发时，系统会调用具体的 Handler 进行对应的逻辑处理。
2. **sigfillset**[<sup>2</sup>](#refer-anchor-2): 用于操作 **signal sets**（信号集）的函数之一，这里的含义是将系统所有支持的信号量添加进一个信号集中
3. **fork**[<sup>3</sup>](#refer-anchor-3): 大家比较熟悉的一个 API 了，创建一个新的进程，并返回 **pid** 。如果是在父进程中，返回的 **pid** 是对应子进程的 **pid**。如果子进程中，**pid** 为0
4. **execve**[<sup>4</sup>](#refer-anchor-4): 执行一个特定的可执行文件
5. **sigprocmask**[<sup>5</sup>](#refer-anchor-5)：设置进程的信号屏蔽集。当传入第一个参数为 **SIG_BLOCK** 时，函数会将当前进程的信号屏蔽集保存在第三个参数传入的信号集变量中，并将当前进程的信号屏蔽集设置为第二个参数传入的信号屏蔽集。当第一个参数为 **SIG_SETMASK** 时，函数会将当前进程的信号屏蔽集设置为第二个参数设置的值。
6. **wait_pid**[<sup>6</sup>](#refer-anchor-6): 做一个不精确的概括，回收并释放已终止的子进程的资源。

好了，复习完关键点之后，开始进入本文的关键部分。

## 更优雅的信号处理手段

### 更优雅的 handler

首先再来看看上面信号处理部分的代码

```c
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
```

这里我们为了保证 `handler` 不被其余的信号打断，所以我们在处理的时候使用 `sigprocmask` + `SIG_BLOCK` 来做信号屏蔽。这样看起来逻辑上没啥问题，但是有个问题。当我们有其余很多不同 `handler` 的时候，我们势必会生成很多重复冗余的代码。那么我们有没有更优雅的方法来保证我们的 `handler` 的安全呢？

有（超大声（好，很有精神！（逃。隆重介绍一个新的 **syscall** -> **sigaction**[<sup>7</sup>](#refer-anchor-7)

废话不多说，先上代码

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
    deletejob(pid);
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
  struct sigaction new_action;
  new_action.sa_handler=handler;
  new_action.sa_mask=mask_all;
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

好！很有精神！大家可能发现了，我们这段代码相较于之前的代码增加了关于 sigaction 相关的设置。难道？

yep，在 **sigaction** 中，我们可以通过设置 `sa_mask` 来设置当信号处理函数执行期间，进程将阻塞哪些信号。

你看，这样我们的代码是不是相较于之前更为优雅了。当然，**sigaction** 还有很多其余很有用的设置项，大家可以下来了解一下。

### 更快速的信号处理方式

在我们上面的例子中，我们已经解决了优雅的设置信号处理函数这样的问题，那么我们现在又面临了一个全新的问题。

如上面所说，我们信号处理函数在执行时，我们选择阻塞了其余的信号。那么这里存在一个问题，当我们在信号处理函数中的逻辑耗时较长，且不需要原子性（即需要和信号处理函数保持同步），而且系统中的信号发生频率较高。那么我们这样的做法将会导致进程的信号队列不断增加，进而导致不可预料的后果。

那么我们这里有什么更好的方法来处理这件事呢？

假设，我们打开一个文件，在信号处理函数中只完成一件事，就是往这个文件中写一个特定的值。然后我们轮询这个文件，如果一旦发生变化，那么我们读取文件中的值，判断具体的信号，做具体的信号处理，这样是不是既保证了信号的妥投，又保证我们信号处理逻辑将阻塞信号的代价降至最低了？

当然，当然，社区知道大家嫌写代码难，所以专门给大家提供了一个船新的 `syscall` -> **signalfd**[<sup>8</sup>](#refer-anchor-8)

老规矩，先来看看例子

```c
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/signalfd.h>
#include <sys/wait.h>

#define MAXEVENTS 64
void deletejob(pid_t pid) { printf("delete task %d\n", pid); }

void addjob(pid_t pid) { printf("add task %d\n", pid); }

int main(int argc, char **argv) {
  int pid;
  struct epoll_event event;
  struct epoll_event *events;
  sigset_t mask;
  sigemptyset(&mask);
  sigaddset(&mask, SIGCHLD);
  if (sigprocmask(SIG_SETMASK, &mask, NULL) < 0) {
    perror("sigprocmask");
    return 1;
  }
  int sfd = signalfd(-1, &mask, 0);
  int epoll_fd = epoll_create(MAXEVENTS);
  event.events = EPOLLIN | EPOLLEXCLUSIVE | EPOLLET;
  event.data.fd = sfd;
  int s = epoll_ctl(epoll_fd, EPOLL_CTL_ADD, sfd, &event);
  if (s == -1) {
    abort();
  }
  events = calloc(MAXEVENTS, sizeof(event));
  while (1) {
    int n = epoll_wait(epoll_fd, events, MAXEVENTS, 1);
    if (n == -1) {
      if (errno == EINTR) {
        fprintf(stderr, "epoll EINTR error\n");
      } else if (errno == EINVAL) {
        fprintf(stderr, "epoll EINVAL error\n");
      } else if (errno == EFAULT) {
        fprintf(stderr, "epoll EFAULT error\n");
        exit(-1);
      } else if (errno == EBADF) {
        fprintf(stderr, "epoll EBADF error\n");
        exit(-1);
      }
    }
    printf("%d\n", n);
    for (int i = 0; i < n; i++) {
      if ((events[i].events & EPOLLERR) || (events[i].events & EPOLLHUP) ||
          (!(events[i].events & EPOLLIN))) {
        printf("%d\n", i);
        fprintf(stderr, "epoll err\n");
        close(events[i].data.fd);
        continue;
      } else if (sfd == events[i].data.fd) {
        struct signalfd_siginfo si;
        ssize_t res = read(sfd, &si, sizeof(si));
        if (res < 0) {
          fprintf(stderr, "read error\n");
          continue;
        }
        if (res != sizeof(si)) {
          fprintf(stderr, "Something wrong\n");
          continue;
        }
        if (si.ssi_signo == SIGCHLD) {
          printf("Got SIGCHLD\n");
          int child_pid = waitpid(-1, NULL, 0);
          deletejob(child_pid);
        }
      }
    }
    if ((pid = fork()) == 0) {
      execve("/bin/date", argv, NULL);
    }
    addjob(pid);
  }
}
```

好了，我们来介绍下这段代码中的一些关键点

1. signalfd 是一类特殊的文件描述符，这个文件可读，可 **select** 。当我们指定的信号发生时，我们可以从返回的 fd 中读取到具体的信号值。
2. **signalfd** 优先级比信号处理函数低。换句话说，假设我们为信号 **SIGCHLD** 注册了信号处理函数，同时也为其注册了 **signalfd** 那么当信号发生时，将优先调用信号处理函数。所以我们在使用 **signalfd** 时，需要利用 **sigprocmask** 设置进程的信号屏蔽集。
3. 如前面所说，该文件描述符可 **select** ，换句话说，我们可以利用 **select**[<sup>9</sup>](#refer-anchor-9), **poll**[<sup>10</sup>](#refer-anchor-10), **epoll**[<sup>11</sup>](#refer-anchor-11)[<sup>12</sup>](#refer-anchor-12) 等函数来对 fd 进行监听。在上面的的代码中，我们就利用 **epoll** 对 **signalfd** 进行监听

当然，这里额外要注意的一点是，很多语言不一定提供了官方的 **signalfd** 的 API（如 Python），但是也有可能提供了等价的替代品，典型的例子就是 Python 中的 **signal.set_wakeup_fd**[<sup>13</sup>](#refer-anchor-13)

在这里也给大家留一个思考题：除了利用 **signalfd** ，还有什么方法可以实现高效，安全的信号处理？

## 总结

私以为信号处理是作为一个研发的基本功，我们需要安全，可靠的处理在程序环境中遇到的各种信号。而系统也提供了很多设计很优秀的 API 来减轻研发的负担。但是我们要知道，信号本质上是通讯手段的一种。而其天生的弊端便是携带的信息较少。很多时候，当我们有很多高频的信息传递需要去做的时候，这个时候可能利用信号并不是一个很好的选择。当然这个并没有定论。只能 case by case 的去做 trade-off。

差不多就这样吧，本周第二篇水文混完（逃



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

<div id="refer-anchor-7"></div>

- [7]. [Linux man page: sigaction](https://www.man7.org/linux/man-pages/man2/sigaction.2.html)

<div id="refer-anchor-8"></div>

- [8]. [Linux man page: signalfd](https://www.man7.org/linux/man-pages/man2/sigaction.2.html)

<div id="refer-anchor-9"></div>

- [9]. [Linux man page: select](https://man7.org/linux/man-pages/man2/select.2.html)

<div id="refer-anchor-10"></div>

- [10]. [Linux man page: poll](https://man7.org/linux/man-pages/man2/poll.2.html)

<div id="refer-anchor-11"></div>

- [11]. [Linux man page: epoll_ctl](https://man7.org/linux/man-pages/man2/epoll_ctl.2.html)

<div id="refer-anchor-12"></div>

- [12]. [Linux man page: epoll_wait](https://man7.org/linux/man-pages/man2/epoll_wait.2.html)

<div id="refer-anchor-13"></div>

- [13]. [Python Documentation: signal.set_wakeup_fd](https://docs.python.org/3/library/signal.html#signal.set_wakeup_fd)
