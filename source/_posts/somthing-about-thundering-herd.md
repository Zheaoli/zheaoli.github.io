---
title: 聊聊网络事件中的惊群效应
type: tags
date: 2019-03-28 22:00:00
tags: [Unix,网络编程,编程]
categories: [编程,网络编程]
---

关于惊群问题，其实我是在去年开始去关注的。然后向 CPython 提了一个关于解决 `selector` 的惊群问题的补丁 [BPO-35517](https://bugs.python.org/issue35517)。现在大概来聊聊关于惊群问题那点事吧

<!--more-->

## 惊群问题的过去

### 惊群问题是什么？

惊群问题又名惊群效应。简单来说就是多个进程或者线程在等待同一个事件，当事件发生时，所有线程和进程都会被内核唤醒。唤醒后通常只有一个进程获得了该事件并进行处理，其他进程发现获取事件失败后又继续进入了等待状态，在一定程度上降低了系统性能。

可能很多人想问，惊群效应为什么会占用系统资源？降低系统性能？

1. 多进程/线程的唤醒，涉及到的一个问题是上下文切换问题。频繁的上下文切换带来的一个问题是数据将频繁的在寄存器与运行队列中流转。极端情况下，时间更多的消耗在进程/线程的调度上，而不是执行

接下来我们来聊聊我们网络编程中常见的惊群问题。

### 常见的惊群问题

在 Linux 下，我们常见的惊群效应发生于我们使用 `accept` 以及我们 `select` 、`poll` 或 `epoll` 等系统提供的 API 来处理我们的网络链接。
 
#### accept 惊群  

首先我们用一个流程图来复习下我们传统的 `accept` 使用方式

![image](https://user-images.githubusercontent.com/7054676/55270168-e467d600-52d6-11e9-9779-8ba62b0b42e1.png)

那么在这里存在一种情况，即当一个请求到达时，所有进程/线程都开始 accept ，但是最终只有一个获取成功，我们来写段代码看看

```c
#include <arpa/inet.h>
#include <assert.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define SERVER_ADDRESS "0.0.0.0"
#define SERVER_PORT 10086
#define WORKER_COUNT 4

int worker_process(int listenfd, int i) {
  while (1) {
    printf("I am work %d, my pid is %d, begin to accept connections \n", i,
           getpid());
    struct sockaddr_in client_info;
    socklen_t client_info_len = sizeof(client_info);
    int connection =
        accept(listenfd, (struct sockaddr *)&client_info, &client_info_len);
    if (connection != -1) {
      printf("worker %d accept success\n", i);
      printf("ip :%s\t", inet_ntoa(client_info.sin_addr));
      printf("port: %d \n", client_info.sin_port);
    } else {
      printf("worker %d accept failed", i);
    }
    close(connection);
  }

  return 0;
}

int main() {
  int i = 0;
  struct sockaddr_in address;
  bzero(&address, sizeof(address));
  address.sin_family = AF_INET;
  inet_pton(AF_INET, SERVER_ADDRESS, &address.sin_addr);
  address.sin_port = htons(SERVER_PORT);
  int listenfd = socket(PF_INET, SOCK_STREAM, 0);
  int ret = bind(listenfd, (struct sockaddr *)&address, sizeof(address));
  ret = listen(listenfd, 5);
  for (i = 0; i < WORKER_COUNT; i++) {
    printf("Create worker %d\n", i + 1);
    pid_t pid = fork();
    /*child  process */
    if (pid == 0) {
      worker_process(listenfd, i);
    }
    if (pid < 0) {
      printf("fork error");
    }
  }

  /*wait child process*/
  int status;
  wait(&status);
  return 0;
}

```

我们来看看运行的结果

![image](https://user-images.githubusercontent.com/7054676/55270562-2135cc00-52db-11e9-8ad8-71efe6e7962a.png)

诶？怎么回事？为什么这里没有出现我们想要的现象（一个进程 accept 成功，三个进程 accept 失败）？原因在于在 Linux 2.6 之后，Accept 的惊群问题从内核上被处理了

好，我们接着往下看

#### select/poll/epoll 惊群

我们以 `epoll` 为例，我们来看看传统的工作模式

![image](https://user-images.githubusercontent.com/7054676/55270670-a1a8fc80-52dc-11e9-96c2-49be1aa78e7f.png)

好了，我们来看段代码

```c
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define SERVER_ADDRESS "0.0.0.0"
#define SERVER_PORT 10087
#define WORKER_COUNT 4
#define MAXEVENTS 64

static int create_and_bind_socket() {
  int fd = socket(PF_INET, SOCK_STREAM, 0);
  struct sockaddr_in server_address;
  server_address.sin_family = AF_INET;
  inet_pton(AF_INET, SERVER_ADDRESS, &server_address.sin_addr);
  server_address.sin_port = htons(SERVER_PORT);
  bind(fd, (struct sockaddr *)&server_address, sizeof(server_address));
  return fd;
}

static int make_non_blocking_socket(int sfd) {
  int flags, s;
  flags = fcntl(sfd, F_GETFL, 0);
  if (flags == -1) {
    perror("fcntl error");
    return -1;
  }
  flags |= O_NONBLOCK;
  s = fcntl(sfd, F_SETFL, flags);
  if (s == -1) {
    perror("fcntl set error");
    return -1;
  }
  return 0;
}

int worker_process(int listenfd, int epoll_fd, struct epoll_event *events,
                   int k) {
  while (1) {
    int n;
    n = epoll_wait(epoll_fd, events, MAXEVENTS, -1);
    printf("Worker %d pid is %d get value from epoll_wait\n", k, getpid());
    for (int i = 0; i < n; i++) {
      if ((events[i].events & EPOLLERR) || (events[i].events & EPOLLHUP) ||
          (!(events[i].events & EPOLLIN))) {
        printf("%d\n", i);
        fprintf(stderr, "epoll err\n");
        close(events[i].data.fd);
        continue;
      } else if (listenfd == events[i].data.fd) {
        struct sockaddr in_addr;
        socklen_t in_len;
        int in_fd;
        in_len = sizeof(in_addr);
        in_fd = accept(listenfd, &in_addr, &in_len);
        if (in_fd == -1) {
          printf("worker %d accept failed\n", k);
          break;
        }
        printf("worker %d accept success\n", k);
        close(in_fd);
      }
    }
  }

  return 0;
}

int main() {
  int listen_fd, s;
  int epoll_fd;
  struct epoll_event event;
  struct epoll_event *events;
  listen_fd = create_and_bind_socket();
  if (listen_fd == -1) {
    abort();
  }
  s = make_non_blocking_socket(listen_fd);
  if (s == -1) {
    abort();
  }
  s = listen(listen_fd, SOMAXCONN);
  if (s == -1) {
    abort();
  }
  epoll_fd = epoll_create(MAXEVENTS);
  if (epoll_fd == -1) {
    abort();
  }
  event.data.fd = listen_fd;
  event.events = EPOLLIN;
  s = epoll_ctl(epoll_fd, EPOLL_CTL_ADD, listen_fd, &event);
  if (s == -1) {
    abort();
  }
  events = calloc(MAXEVENTS, sizeof(event));
  for (int i = 0; i < WORKER_COUNT; i++) {
    printf("create worker %d\n", i);
    int pid = fork();
    if (pid == 0) {
      worker_process(listen_fd, epoll_fd, events, i);
    }
  }
  int status;
  wait(&status);
  free(events);
  close(listen_fd);
  return EXIT_SUCCESS;
}
```

然后，我们用 `telnet` 发送一下 TCP 请求，看看效果，，我们能得到这样的结果

![image](https://user-images.githubusercontent.com/7054676/55273414-f4e37500-5305-11e9-8782-a31912228867.png)

恩，我们能看到当一个请求到达时，我们四个进程都被唤醒了。现在为了更直观的看到这一个过程，我们用 `strace` 来 profile 一下

![image](https://user-images.githubusercontent.com/7054676/55273457-966ac680-5306-11e9-8666-2ce6ef90dd35.png)

我们还是能看到，四个进程都被唤醒，但是只有 Worker 3 成功 `accept` ，而其余的进程在 `accept` 的时候，都获取到了 `EAGAIN` 错误，

而 [Linux 文档](http://man7.org/linux/man-pages/man2/accept.2.html) 对于 `EAGAIN` 的描述是

> The socket is marked nonblocking and no connections are present to be accepted.  POSIX.1-2001 and POSIX.1-2008 allow
either error to be returned for this case, and do not require these constants to have the same value, so a portable
application should check for both possibilities.

现在我们对于 EPOLL 的惊群问题是不是有了直观的了解？那么怎么样去解决惊群问题呢？

## 惊群问题的现在

### 从内核解决惊群问题

首先如前面所说，Accept 的惊群问题在 Linux Kernel 2.6 之后就被从内核的层面上解决了。但是 EPOLL 怎么办？在 2016 年一月，Linux 之父 Linus 向内核提交了一个补丁

参见 [epoll: add EPOLLEXCLUSIVE flag](https://github.com/torvalds/linux/commit/df0108c5da561c66c333bb46bfe3c1fc65905898)

其中的关键代码是

```c
		if (epi->event.events & EPOLLEXCLUSIVE)
			add_wait_queue_exclusive(whead, &pwq->wait);
		else
			add_wait_queue(whead, &pwq->wait);
```

简而言之，通过增加一个 `EPOLLEXCLUSIVE` 标志位作为辅助。如果用户开启了 `EPOLLEXCLUSIVE` ，那么在加入内核等待队列时，使用 `add_wait_queue_exclusive` 否则则使用 `add_wait_queue`

至于这两个函数的用法，可以参考这篇文章[Handing wait queues](https://www.halolinux.us/kernel-reference/handling-wait-queues.html)

其中有这样一段描述

> The add_wait_queue( ) function inserts a nonexclusive process in the first position of a wait queue list. The add_wait_queue_exclusive( ) function inserts an exclusive process in the last position of a wait queue list. 

好了，我们现在来改一下我们的代码（内核版本要在 Linux Kernel 4.5）之后

```c
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define SERVER_ADDRESS "0.0.0.0"
#define SERVER_PORT 10086
#define WORKER_COUNT 4
#define MAXEVENTS 64

static int create_and_bind_socket() {
  int fd = socket(PF_INET, SOCK_STREAM, 0);
  struct sockaddr_in server_address;
  server_address.sin_family = AF_INET;
  inet_pton(AF_INET, SERVER_ADDRESS, &server_address.sin_addr);
  server_address.sin_port = htons(SERVER_PORT);
  bind(fd, (struct sockaddr *)&server_address, sizeof(server_address));
  return fd;
}

static int make_non_blocking_socket(int sfd) {
  int flags, s;
  flags = fcntl(sfd, F_GETFL, 0);
  if (flags == -1) {
    perror("fcntl error");
    return -1;
  }
  flags |= O_NONBLOCK;
  s = fcntl(sfd, F_SETFL, flags);
  if (s == -1) {
    perror("fcntl set error");
    return -1;
  }
  return 0;
}

int worker_process(int listenfd, int epoll_fd, struct epoll_event *events,
                   int k) {
  while (1) {
    int n;
    n = epoll_wait(epoll_fd, events, MAXEVENTS, -1);
    printf("Worker %d pid is %d get value from epoll_wait\n", k, getpid());
    sleep(0.2);
    for (int i = 0; i < n; i++) {
      if ((events[i].events & EPOLLERR) || (events[i].events & EPOLLHUP) ||
          (!(events[i].events & EPOLLIN))) {
        printf("%d\n", i);
        fprintf(stderr, "epoll err\n");
        close(events[i].data.fd);
        continue;
      } else if (listenfd == events[i].data.fd) {
        struct sockaddr in_addr;
        socklen_t in_len;
        int in_fd;
        in_len = sizeof(in_addr);
        in_fd = accept(listenfd, &in_addr, &in_len);
        if (in_fd == -1) {
          printf("worker %d accept failed\n", k);
          break;
        }
        printf("worker %d accept success\n", k);
        close(in_fd);
      }
    }
  }

  return 0;
}

int main() {
  int listen_fd, s;
  int epoll_fd;
  struct epoll_event event;
  struct epoll_event *events;
  listen_fd = create_and_bind_socket();
  if (listen_fd == -1) {
    abort();
  }
  s = make_non_blocking_socket(listen_fd);
  if (s == -1) {
    abort();
  }
  s = listen(listen_fd, SOMAXCONN);
  if (s == -1) {
    abort();
  }
  epoll_fd = epoll_create(MAXEVENTS);
  if (epoll_fd == -1) {
    abort();
  }
  event.data.fd = listen_fd;
  // add EPOLLEXCLUSIVE support
  event.events = EPOLLIN | EPOLLEXCLUSIVE;
  s = epoll_ctl(epoll_fd, EPOLL_CTL_ADD, listen_fd, &event);
  if (s == -1) {
    abort();
  }
  events = calloc(MAXEVENTS, sizeof(event));
  for (int i = 0; i < WORKER_COUNT; i++) {
    printf("create worker %d\n", i);
    int pid = fork();
    if (pid == 0) {
      worker_process(listen_fd, epoll_fd, events, i);
    }
  }
  int status;
  wait(&status);
  free(events);
  close(listen_fd);
  return EXIT_SUCCESS;
}
```

然后我们来看看效果

![image](https://user-images.githubusercontent.com/7054676/55273709-c2d41200-5309-11e9-959e-927c1bfbd410.png)

诶？为什么还是有两个进程被唤醒了？原因在于 `EPOLLEXCLUSIVE` 只保证唤醒的进程数小于等于我们开启的进程数，而不是直接唤醒所有进程，也不是只保证唤醒一个进程

我们来看看官方的[描述](http://man7.org/linux/man-pages/man2/epoll_ctl.2.html)

> Sets an exclusive wakeup mode for the epoll file descriptor
  that is being attached to the target file descriptor, fd.
  When a wakeup event occurs and multiple epoll file descriptors
  are attached to the same target file using EPOLLEXCLUSIVE, one
  or more of the epoll file descriptors will receive an event
  with epoll_wait(2).  The default in this scenario (when
  EPOLLEXCLUSIVE is not set) is for all epoll file descriptors
  to receive an event.  EPOLLEXCLUSIVE is thus useful for avoid‐
  ing thundering herd problems in certain scenarios.

恩，换句话说，就目前而言，系统并不能严格保证惊群问题的解决。很多时候我们还是要依靠应用层自身的设计来解决

### 应用层解决

目前而言，应用解决惊群有两种策略

1. 这是可以接受的代价，那么我们暂时不管。这是我们大多数的时候的策略

2. 通过加锁或其余的手段来解决这个问题，最典型的例子是 Nginx

我们来看看 Nginx 怎么解决这样的问题的

```c
void
ngx_process_events_and_timers(ngx_cycle_t *cycle)
{
    ngx_uint_t  flags;
    ngx_msec_t  timer, delta;

    if (ngx_timer_resolution) {
        timer = NGX_TIMER_INFINITE;
        flags = 0;

    } else {
        timer = ngx_event_find_timer();
        flags = NGX_UPDATE_TIME;
    }

    if (ngx_use_accept_mutex) {
        if (ngx_accept_disabled > 0) {
            ngx_accept_disabled--;

        } else {
            if (ngx_trylock_accept_mutex(cycle) == NGX_ERROR) {
                return;
            }

            if (ngx_accept_mutex_held) {
                flags |= NGX_POST_EVENTS;

            } else {
                if (timer == NGX_TIMER_INFINITE
                    || timer > ngx_accept_mutex_delay)
                {
                    timer = ngx_accept_mutex_delay;
                }
            }
        }
    }

    delta = ngx_current_msec;

    (void) ngx_process_events(cycle, timer, flags);

    delta = ngx_current_msec - delta;

    ngx_log_debug1(NGX_LOG_DEBUG_EVENT, cycle->log, 0,
                   "timer delta: %M", delta);

    ngx_event_process_posted(cycle, &ngx_posted_accept_events);

    if (ngx_accept_mutex_held) {
        ngx_shmtx_unlock(&ngx_accept_mutex);
    }

    if (delta) {
        ngx_event_expire_timers();
    }

    ngx_event_process_posted(cycle, &ngx_posted_events);
}
```

我们这里能看到，Nginx 主体的思想是通过锁的形式来处理这样问题。我们每个进程在监听 FD 事件之前，我们先要通过 `ngx_trylock_accept_mutex` 去获取一个全局的锁。如果拿锁成功，那么则开始通过
`ngx_process_events` 尝试去处理事件。如果拿锁失败，则放弃本次操作。所以从某种意义上来讲，对于某一个 FD ，Nginx 同时只有一个 Worker 来处理 FD 上的事件。从而避免惊群。

## 总结

这篇文章从去年到现在拖了很久了，惊群问题一直是我们日常工作中遇到的问题，我自己觉得，还是有必要写篇详细的笔记，记录下去年到现在的一些学习记录。差不多就这样吧，祝各位看的好。
