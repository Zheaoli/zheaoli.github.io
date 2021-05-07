---
title: 简单聊聊容器中的一号进程
type: tags
date: 2021-02-13 17:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

新年了，决定趁着有时间的时候多写几篇技术水文。今天的话，准备来简单聊聊容器中我们每天都会接触，但是时常又会被我们忽略的一号进程

<!--more-->

## 正文

容器技术发展到现在，其实形态上已经发生了很大的变化。根据不同的场景，既有传统的 **Docker**[<sup>1</sup>](#refer-anchor-1), **containterd**[<sup>2</sup>](#refer-anchor-2) 这样传统基于 CGroup + Namespace 的容器形态，也有像 **Kata**[<sup>3</sup>](#refer-anchor-3) 这样基于 VM 的新型的容器形态。本文主要着眼在传统容器中一号进程上。

我们都知道，传统容器依赖的 CGroup + Namespace 进行资源隔离，本质上来说，还是 OS 内的一个进程。所以在继续往下聊容器相关的内容之前，我们需要先来简单聊聊 Linux 中的进程管理

### Linux 中的进程管理

#### 简单聊聊进程 

Linux 中的进程实际上是个非常大的话题，如果要展开聊，实际上这个话题可以聊一整本书= =，所以为了时间着想，我们还是把目光聚集在最核心的一部分上面（实际上是因为很多东西我也不懂。

首先来讲，在内核中利用一个特殊的结构体来维护进程有关的相关信息，比如常见的 PID，进程状态，打开的文件描述符等信息。在内核代码中，这个结构体是 **task_struct**[<sup>4</sup>](#refer-anchor-4), 其大概结构大家可以看一下下图

![task_struct](https://user-images.githubusercontent.com/7054676/107845716-b4694380-6e18-11eb-9d19-ebfb9927b1ac.png)

而通常而言，我们会在系统上跑很多个进程。所以内核用一个进程表(实际上 Linux 中管理进程表的有多个数据结构，这里我们用 PID Hash Map 来举例）来维护所有 Process Descriptor 相关的信息，详见下图

![PID Hash Table](https://user-images.githubusercontent.com/7054676/107845790-30638b80-6e19-11eb-951e-7fdfa86a0234.png)

OK， 这里我们大概了解了进程中的基本结构，现在我们来看我们常见使用进程的一个场景：父子进程。我们都知道，我们有时会在一个进程中，通过 **fork**[<sup>5</sup>](#refer-anchor-5) 这个 sys call 来创建出一个新的进程。通常来说，我们创建的新的进程是当前进程的子进程。那么在内核中怎么表达这种父子关系呢？

回到刚刚提到 **task_struct**, 在这个结构体中存在这样几个字段来描述父子关系

1. real_parent：一个 task_struct 指针，指向父进程

2. parent: 一个 task_struct 指针，指向父进程。在大多数情况下，这个字段的值和 `real_parent` 一致。在有进程对当前进程使用 **ptrace**[<sup>6</sup>](#refer-anchor-6) 等情况的时候，和 `real_parent` 字段不一致

3. children：list_head, 其指向一个由当前进程所创建的所有子进程的双向链表

这里大家可能还有点抽象的话，给大家一个图就能看清楚了

![Relation Between Process](https://user-images.githubusercontent.com/7054676/107846739-f8604680-6e20-11eb-939c-f033909570c3.png)

实际上，我们发现，不同进程之间的父子关系，反应到具体的数据结构之上，就形成了一个完整的树形结构（先记住这点，我们稍后会再提到这里）

到现在为止，我们已经对 Linux 中的进程，有了最简单一个概念，那么接下来，我们会聊聊我们在进程使用中常遇到的两个问题：孤儿进程&&僵尸进程

#### 孤儿进程 && 僵尸进程

首先来聊聊 **僵尸进程** 这个概念。

如前面所说，我们内核有进程表来维护 Process Descriptor 相关信息。那么在 Linux 的设计中，当一个子进程退出后，将保存自己的进程相关的状态以供父进程使用。而父进程将调用 **waitpid**[<sup>7</sup>](#refer-anchor-7) 来获取子进程状态，并清理相关资源。

那么如上所说，父进程是有可能需要拿到子进程相关的状态的。那么也就导致为了满足这一设计，内核中的进程表将一直保存相关资源。当僵尸进程多了以后，那么将造成很大的资源浪费。

首先来看一个简单的僵尸进程的例子 

```c
#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>

int main() {
  int pid;
  if ((pid = fork()) == 0) {
    printf("Here's child process\n");
  } else {
    printf("the child process pid is %d\n", pid);
    sleep(20);
  }
  return 0;
}
```

然后我们编译执行这段代码，然后配合 `ps` 命令查看一下，发现我们的确造了一个 z 进程

![Z Process Demo](https://user-images.githubusercontent.com/7054676/107847485-0e710580-6e27-11eb-977c-678a7fa4b362.png)

OK 我们再来看一个正确处理子进程退出的代码

```C
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

OK, 我们现在都知道了，子进程退出后需要由父进程正确的回收相关的资源。那么问题来了，我们父进程先于子进程退出了怎么办。实际上这是一个很常见的场景。比如说大家去用两次 fork 实现守护进程。

我们常规的认知来说，我们父进程退出后，这个进程所属的所有子进程会进行 re-parent 到当前 PID Namespace 的一号进程上，那么这样的答案是正确的么？对，也不对，我们首先来看一个例子

```c
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <unistd.h>

int main() {
  int pid;
  int err = prctl(PR_SET_CHILD_SUBREAPER, 1);
  if (err != 0) {
    return 0;
  }
  if ((pid = fork()) == 0) {
    if ((pid = fork()) == 0) {
      printf("Here's child process1\n");
      sleep(20);
    } else {
      printf("the child process pid is %d\n", pid);
    }
  } else {
    sleep(40);
  }
  return 0;
}
```

这是一个很典型的两次 fork 创建守护进程的代码（除了我没写 SIGCHLD 处理（逃）。我们来看下这段代码的输出

![Daemon Process Output1](https://user-images.githubusercontent.com/7054676/107848258-ebe1eb00-6e2c-11eb-8c72-e4c5915ffa3f.png)

我们能看到守护进程的 PID 是 449920

然后我们执行 `ps -efj` 和 `ps auf` 两个命令看一下结果

![Daemon Process Output2](https://user-images.githubusercontent.com/7054676/107848296-32cfe080-6e2d-11eb-943f-0efb9975b7ee.png)

我们能看到，449920 这个进程在父进程退出后没有 re-parent 到当前空间的一号进程上。这是为什么呢？可能眼尖的同学已经注意到，这段代码中一个特殊的 sys call **prctl**[<sup>8</sup>](#refer-anchor-8)。我们给当前进程设置了 **PR_SET_CHILD_SUBREAPER** 的属性。

这里我们来看一下内核里的实现

```c
/*
 * When we die, we re-parent all our children, and try to:
 * 1. give them to another thread in our thread group, if such a member exists
 * 2. give it to the first ancestor process which prctl'd itself as a
 *    child_subreaper for its children (like a service manager)
 * 3. give it to the init process (PID 1) in our pid namespace
 */
static struct task_struct *find_new_reaper(struct task_struct *father,
					   struct task_struct *child_reaper)
{
	struct task_struct *thread, *reaper;

	thread = find_alive_thread(father);
	if (thread)
		return thread;

	if (father->signal->has_child_subreaper) {
		unsigned int ns_level = task_pid(father)->level;
		/*
		 * Find the first ->is_child_subreaper ancestor in our pid_ns.
		 * We can't check reaper != child_reaper to ensure we do not
		 * cross the namespaces, the exiting parent could be injected
		 * by setns() + fork().
		 * We check pid->level, this is slightly more efficient than
		 * task_active_pid_ns(reaper) != task_active_pid_ns(father).
		 */
		for (reaper = father->real_parent;
		     task_pid(reaper)->level == ns_level;
		     reaper = reaper->real_parent) {
			if (reaper == &init_task)
				break;
			if (!reaper->signal->is_child_subreaper)
				continue;
			thread = find_alive_thread(reaper);
			if (thread)
				return thread;
		}
	}

	return child_reaper;
}
```

这里我们总结一下，当父进程退出后，所属的子进程，将按照如下顺序进行 re-parent

1. 线程组里其余可用线程（这里的线程有所不一样，可以暂时忽略）

2. 在当前所属的进程树上不断寻找设置了 **PR_SET_CHILD_SUBREAPER** 进程

3. 在前面两者都无效的情况下，re-parent 到当前 PID Namespace 中的 1 号进程上

到这里，我们关于 Linux 中进程管理的基础介绍就完成了。那么我们将来聊聊容器中的情况

### 容器中的一号进程

这里，我们将利用，Docker 作为背景聊聊这个话题。首先，在 Docker 1.11 之后，其架构发生了比较大的变化，如下图所示

![Docker Arch since version 1.11](https://user-images.githubusercontent.com/7054676/107848502-cf46b280-6e2e-11eb-8a69-f9eaf9d155a8.png)

那么我们拉起一个容器的的流程如下

1. Docker Daemon 向 containerd 发送指令

2. containerd 创建一个 containterd-shim 进程

3. containerd-shim 创建一个 runc 进程

4. runc 进程将根据 OCI 标准，设置相关环境（创建 cgroup，创建 ns 等），然后执行 `entrypoint` 中的设定的命令

5. runc 在执行完相关设置后，将自我退出，此时其子进程（即容器命名空间内的1号进程）将被 re-parent 给 containerd-shim 进程。

OK，上面 step 5 操作，就需要依赖我们上节中讲到的 **prctl** 和 **PR_SET_CHILD_SUBREAPER** 。

自此，containerd-shim 将承担容器内进程相关的操作，即便其父进程退出，子进程也会根据 re-parent 的流程托管到 containerd-shim 进程上。

那么，这样是不是就没有问题了呢？

答案很明显不是。来给大家举一个实际上的场景：假设我一个服务需要实现一个需求叫做优雅下线。通常而言，我们会在暴力杀死进程之前，利用 SIGTERM 信号实现这个功能。但是在容器时期有个问题，我们一号进程，可能不是程序本身（比如大家习惯性的会考虑在 entrypoint 中用 bash 去裹一层），或者经过一些特殊场景，容器中的进程，全部已经托管在 containerd-shim 上了。而 contaninerd-shim 是不具备信号转发的能力的。

所以在这样一些场景下，我们就需要考虑额外引入一些组件来完成我们的需求。这里以一个非常轻量级的专门针对容器的设计的一号进程项目 **tini**[<sup>9</sup>](#refer-anchor-9) 来作为介绍

我们这里看一下核心的一些代码

```c
int register_subreaper () {
	if (subreaper > 0) {
		if (prctl(PR_SET_CHILD_SUBREAPER, 1)) {
			if (errno == EINVAL) {
				PRINT_FATAL("PR_SET_CHILD_SUBREAPER is unavailable on this platform. Are you using Linux >= 3.4?")
			} else {
				PRINT_FATAL("Failed to register as child subreaper: %s", strerror(errno))
			}
			return 1;
		} else {
			PRINT_TRACE("Registered as child subreaper");
		}
	}
	return 0;
}

int wait_and_forward_signal(sigset_t const* const parent_sigset_ptr, pid_t const child_pid) {
	siginfo_t sig;

	if (sigtimedwait(parent_sigset_ptr, &sig, &ts) == -1) {
		switch (errno) {
			case EAGAIN:
				break;
			case EINTR:
				break;
			default:
				PRINT_FATAL("Unexpected error in sigtimedwait: '%s'", strerror(errno));
				return 1;
		}
	} else {
		/* There is a signal to handle here */
		switch (sig.si_signo) {
			case SIGCHLD:
				/* Special-cased, as we don't forward SIGCHLD. Instead, we'll
				 * fallthrough to reaping processes.
				 */
				PRINT_DEBUG("Received SIGCHLD");
				break;
			default:
				PRINT_DEBUG("Passing signal: '%s'", strsignal(sig.si_signo));
				/* Forward anything else */
				if (kill(kill_process_group ? -child_pid : child_pid, sig.si_signo)) {
					if (errno == ESRCH) {
						PRINT_WARNING("Child was dead when forwarding signal");
					} else {
						PRINT_FATAL("Unexpected error when forwarding signal: '%s'", strerror(errno));
						return 1;
					}
				}
				break;
		}
	}

	return 0;
}
```

这里我们能很清楚看到两个核心点

1. tini 会通过 **prctl** 和 **PR_SET_CHILD_SUBREAPER** 来接管容器内的孤儿进程

2. tini 在收到信号后，会将信号转发给子进程或者是所属的子进程组

当然其实 tini 本身也有一些小问题（不过比较冷门）这里留一个讨论题：假设我们有这样一个服务，在创建10个守护进程后自己退出。在这十个守护进程中，我们都会设置一个全新的进程组 ID （所谓进程组逃逸）。那么我们怎么样将信号转发到这十个进程上（仅供讨论，生产上这么干的人早被打死了）

## 总结

可能看到这里，可能有人要喷我不讲武德，说好的容器内一号进程，但是花了大半篇幅来讲 Linux 进程233333.

实际上传统容器基本可以认为是在 OS 中执行的一个完整进程。讨论容器中的一号进程离不开讨论 Linux 中进程管理的相关知识点。

希望通过这篇技术水文能帮大家对容器中一号进程有个大概的认知，并能正确的使用和管理他。

最后祝大家新年快乐！（希望新年我能不以写水文为生，呜呜呜呜）

## Reference

<div id="refer-anchor-1"></div>

- [1]. [Docker](https://www.docker.com/)

<div id="refer-anchor-2"></div>

- [2]. [containerd](https://containerd.io/)

<div id="refer-anchor-3"></div>

- [3]. [kata](https://katacontainers.io/)

<div id="refer-anchor-4"></div>

- [4]. [task_struct](https://github.com/torvalds/linux/blob/master/include/linux/sched.h#L649)

<div id="refer-anchor-5"></div>

- [5]. [Linux Man Page: fork](https://man7.org/linux/man-pages/man2/fork.2.html)

<div id="refer-anchor-6"></div>

- [6]. [Linux Man Page: ptrace](https://man7.org/linux/man-pages/man2/ptrace.2.html)

<div id="refer-anchor-7"></div>

- [7]. [Linux man page: waitpid](https://linux.die.net/man/2/waitpid)

<div id="refer-anchor-8"></div>

- [8]. [Linux man page: prctl](https://man7.org/linux/man-pages/man2/prctl.2.html)

<div id="refer-anchor-9"></div>

- [9]. [tini](https://github.com/krallin/tini)