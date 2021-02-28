---
title: 继续爆论容器中的一号进程
type: tags
date: 2021-02-28 03:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

上周的文章聊了关于容器中的一号进程的一些概况后，在我师父某川(可以去 GitHub 找他玩，[jschwinger23](https://github.com/jschwinger23)) 的指导与配合下，我们一起对目前主流的被广泛使用的两个容器中一号进程的实现 dumb-init 和 tini 做了一番探究，继续写个水文来爆论一番。

<!--more-->

## 正文

### 我们为什么需要一个一号进程，我们希望的一号进程需要承担怎样的职责？

在继续聊关于 dumb-init 和 tini 的相关爆论之前，我们需要来 review 一个问题。我们为什么需要一个一号进程？以及我们所选择的一号进程需要承担怎么样的职责

其实我们在容器场景下需要一号进程托管在前面实际上有两种主要的场景，

1. 对于容器内 Graceful Upgrade 二进制这种场景，主流的一种做法之一是 fork 一个新的进程，exec 新的二进制文件，新进程处理新链接，老进程处理老链接。（Nginx 就采用这种方案）

2. 没有正确的处理信号转发以及进程回收的情况

3. 一些如同 calico-node 的场景么，我们出于方便打包的考虑，将多个二进制运行在同一容器中

对于第一种其实需要说的没有太多，我们来看一下第二点的测试

我们先准备一个最简单 Python 文件，**demo1.py**

```python
import time

time.sleep(10000)
```

然后依照常规，我们开始用一个 bash 脚本裹一下

```bash
#!/bin/bash

python /root/demo1.py
```

最后编写 Dockerfile 

```dockerfile
FROM python:3.9

ADD demo1.py /root/demo1.py
ADD demo1.sh /root/demo1.sh

ENTRYPOINT ["bash", "/root/demo1.sh"]
```

构建后开始执行，我们先来看一下进程结构

![进程结构](https://user-images.githubusercontent.com/7054676/109394863-29ce2b80-7964-11eb-88aa-4e1f6e2e3e00.png)

没有问题，现在我们用 **strace** 来 trace 一下，2049962、2050009 这两个进程，然后对 2049962 这个 bash 进程发 **SIGTERM*＊ 信号

我们来看下结果

![2049962进程的 trace 结果](https://user-images.githubusercontent.com/7054676/109394942-a9f49100-7964-11eb-8fa5-5d676e512081.png)

![2050009进程的 trace 结果](https://user-images.githubusercontent.com/7054676/109394966-d8726c00-7964-11eb-9e18-f99a0a64b5cd.png)

我们能清晰看到 2049962 进程在接到 **SIGTERM** 的时候，没有将其转发给 2050009 进程。在我们手动 SIGKILL 2049962 后， 2050009 也随即退出，这里可能有人会有点疑惑，为什么 2049962 退出后，2050009 也会退出呢？

这里是由于 pid namespace 本身的特性，我们来看看，[pid_namespaces](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html) 中的相关介绍

> If the "init" process of a PID namespace terminates, the kernel terminates all of the processes in the namespace via a SIGKILL signal.  

当当前 pid ns 内的一号进程退出的时候，内核直接 SIGKILL 伺候该 pid ns 内的剩余进程

OK，在我们结合容器调度框架后，那么在生产上实际会出现很多的坑，来看一段我之前的吐槽

> 我们一个测试服务，Spring Cloud 的，在下线后，节点无法从注册中心摘除，然后百思不得其解，最后查到问题，，
> 本质上是这样，POD 被摘除的时候，K8S Scheduler 会给 POD 的 ENTRYPOINT 发一个 SIGTERM 信号，然后等待三十秒（默认的 graceful shutdown 超时实践)，还没响应就会 SIGKILL 直接杀
> 问题在于，我们 Eureka 版的服务是通过 start.sh 来启动的，ENTRYPOINT ["/home/admin/start.sh"]，容器里默认是 /bin/sh 是 fork/exec 模式，导致我服务进程没法正确的收到 SIGTERM 信号，然后一直没结束就被 SIGKILL 了

刺激不刺激。除了信号转发无法正常处理以外，我们应用程序常见的一个常见处理的问题就是 Z 进程的出现，即子进程结束之后，无法正确的回收。比如早期 puppeteer 臭名昭著的 Z 进程问题。 在这种情况下，除了应用程序本身的问题以外，另外可能的原因是在守护进程这样的场景下，孤儿进程 re-parent 之后的进程，不具备回收子进程的功能

OK 在回顾完上面我们常见的问题后，我们来 review 一下我们对于容器内一号进程所需要承担的职责

1. 信号的转发

2. Z 进程的回收

而在目前，在容器场景下，大家主要使用两个方案来作为自己的容器内一号进程，[dumb-init](https://github.com/Yelp/dumb-init) 和 [tini](https://github.com/krallin/tini)。这两个方案对于容器内孤儿与 Z 进程的处理都算是 OK。但是信号转发的实现上一言难尽。那么接下来

爆论时间！

### 拉跨的 dumb-init

某种程度上来说，**dumb-init** 这货完全是属于虚假宣传的典范。代码实现非常糙

来看看官方的宣传

> dumb-init runs as PID 1, acting like a simple init system. It launches a single process and then proxies all received signals to a session rooted at that child process.

这里，dumb-init 说自己使用了 Linux 中的进程 Session，我们都知道，一个进程 Session 在默认情况下，共享一个 Process Group Id 。那么我们这里可以理解为，dumb-init 能将信号完全转发到进程组中的每个进程上。听起来很美好是不是？

我们先来测试一下吧

测试代码如下，**demo2.py**

```python
import os
import time

pid = os.fork()
if pid == 0:
    cpid = os.fork()
time.sleep(1000)
```

Dockerfile 如下

```dockerfile
FROM python:3.9

RUN wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /usr/local/bin/dumb-init

ADD demo2.py /root/demo2.py

ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]

CMD ["python", "/root/demo2.py"]
```

构建，开跑，先来看下进程结构

![demo2 的进程结构](https://user-images.githubusercontent.com/7054676/109396500-dca28780-796c-11eb-9ae1-37be10affbb0.png)

然后老规矩，strace 2103908、2103909、2103910 这三个进程，然后我们对 **dumb-init** 的进程做一下发送 SIGTERM 的操作吧

![strace 2103908](https://user-images.githubusercontent.com/7054676/109396545-1f645f80-796d-11eb-9205-7735e5fd3685.png)

![strace 2103909](https://user-images.githubusercontent.com/7054676/109396563-3440f300-796d-11eb-82ed-94693d49cfc8.png)

![strace 2103910](https://user-images.githubusercontent.com/7054676/109397059-c649fb00-796f-11eb-8206-02af6d9dc02b.png)

诶？dumb-init 老师，发生了甚么事？为什么 2103909 直接被 SIGKILL 了，而没有收到 SIGTERM

这里我们要来看下 dumb-init 的关键实现

```c
void handle_signal(int signum) {
    DEBUG("Received signal %d.\n", signum);

    if (signal_temporary_ignores[signum] == 1) {
        DEBUG("Ignoring tty hand-off signal %d.\n", signum);
        signal_temporary_ignores[signum] = 0;
    } else if (signum == SIGCHLD) {
        int status, exit_status;
        pid_t killed_pid;
        while ((killed_pid = waitpid(-1, &status, WNOHANG)) > 0) {
            if (WIFEXITED(status)) {
                exit_status = WEXITSTATUS(status);
                DEBUG("A child with PID %d exited with exit status %d.\n", killed_pid, exit_status);
            } else {
                assert(WIFSIGNALED(status));
                exit_status = 128 + WTERMSIG(status);
                DEBUG("A child with PID %d was terminated by signal %d.\n", killed_pid, exit_status - 128);
            }

            if (killed_pid == child_pid) {
                forward_signal(SIGTERM);  // send SIGTERM to any remaining children
                DEBUG("Child exited with status %d. Goodbye.\n", exit_status);
                exit(exit_status);
            }
        }
    } else {
        forward_signal(signum);
        if (signum == SIGTSTP || signum == SIGTTOU || signum == SIGTTIN) {
            DEBUG("Suspending self due to TTY signal.\n");
            kill(getpid(), SIGSTOP);
        }
    }
}
```

这是 dumb-init 老师处理信号的代码，在收到信号后，将除 SIGCHLD 的信号做转发（注意 SIGKILL 是不可 handle 信号），我们来看看信号转发的逻辑

```c
void forward_signal(int signum) {
    signum = translate_signal(signum);
    if (signum != 0) {
        kill(use_setsid ? -child_pid : child_pid, signum);
        DEBUG("Forwarded signal %d to children.\n", signum);
    } else {
        DEBUG("Not forwarding signal %d to children (ignored).\n", signum);
    }
}
```

默认情况下直接 kill 发送信号，其中 -child_pid 是这样一个特性：

> If pid is less than -1, then sig is sent to every process in the process group whose ID is -pid.

直接转发进程组，看起来没啥问题啊？那么上面是甚么原因呢？我们再来复习下上一段话，kill 给进程组发信号的逻辑是 **sig is sent to every process** ，懂了，一个 O(N) 的遍历嘛。没啥问题啊？好了，不卖关子，这里 dumb-init 的实现存在一个 race-condition

我们刚刚说了，kill 进程组的行为是一个 O(N) 的遍历，那么必然会有进程先收到信号，而有进程后收到信号。以 SIGTERM 为例，假设我们 dumb-init 的子进程先收到 SIGTERM，优雅退出后，dumb-init 收到 SIGCHLD 的信号，然后 wait_pid 拿到子进程 ID，判断是自己直接托管的进程后，自杀退出。好了，由于 dumb-init 是我们当前 pid ns 内的 init 进程，再来复习下 pid ns 的特性。

> If the "init" process of a PID namespace terminates, the kernel terminates all of the processes in the namespace via a SIGKILL signal. 

在 dumb-init 自杀以后，剩余进程将直接被内核 SIGKILL 伺候。也就导致了我们上面看到的，子进程没有收到转发的信号！

所以这里加粗处理一下，**dumb-init 所承诺的，能将信号转发到所有进程上，完全是虚假宣传！**

而且请注意，dumb-init 宣称自己能管理一个 Session 内的进程！但是实际上他们只做了一个进程组的信号转发！完全是虚假宣称！Fake News！

而且如上面所提到的，在我们热更新二进制这样的场景下，dumb-init 在进程退出后直接自杀。和不使用一号进程完全没有差别！

我们可以来测试一下，测试代码 demo3.py

```python
import os
import time

pid = os.fork()
time.sleep(1000)
```

fork 一个进程，总共两个进程

Dockerfile 如下

```dockerfile
FROM python:3.9

RUN wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /usr/local/bin/dumb-init

ADD demo3.py /root/demo3.py

ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]

CMD ["python", "/root/demo3.py"]
```

构建，执行，先看看进程结构

![demo3 进程结构](https://user-images.githubusercontent.com/7054676/109397207-9818eb00-7970-11eb-8dbb-35ccbe5d26cf.png)

然后模拟老进程退出，我们直接 SIGKILL 掉 2134836，然后我们看看 2134837 的 strace 的结果

![strace 2134837](https://user-images.githubusercontent.com/7054676/109397254-d31b1e80-7970-11eb-9bf2-fcc3e12ca77c.png)

如预期一样，在 dumb-init 自杀后，2134837 被内核 SIGKILL 了

所以跟我复习一遍 **dumb-init** 拉跨！好了，我们接着聊 tini 的实现

### 态度友好的聊聊 tini 

平心而论，tini 的实现，虽然也还有坑，但是比 **dumb-init** 细腻到不知道哪里去了，我们直接来先看下代码

```c
	while (1) {
		/* Wait for one signal, and forward it */
		if (wait_and_forward_signal(&parent_sigset, child_pid)) {
			return 1;
		}

		/* Now, reap zombies */
		if (reap_zombies(child_pid, &child_exitcode)) {
			return 1;
		}

		if (child_exitcode != -1) {
			PRINT_TRACE("Exiting: child has exited");
			return child_exitcode;
		}
	}
```

首先 tini 没有设置 signal handler ，不断循环 `wait_and_forward_signal` 和 `reap_zombies` 这两个函数

```c

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

用 `sigtimedwait` 这个函数来接收信号，然后过滤掉 `SIGCHLD` 转发。

```c
int reap_zombies(const pid_t child_pid, int* const child_exitcode_ptr) {
	pid_t current_pid;
	int current_status;

	while (1) {
		current_pid = waitpid(-1, &current_status, WNOHANG);

		switch (current_pid) {

			case -1:
				if (errno == ECHILD) {
					PRINT_TRACE("No child to wait");
					break;
				}
				PRINT_FATAL("Error while waiting for pids: '%s'", strerror(errno));
				return 1;

			case 0:
				PRINT_TRACE("No child to reap");
				break;

			default:
				/* A child was reaped. Check whether it's the main one. If it is, then
				 * set the exit_code, which will cause us to exit once we've reaped everyone else.
				 */
				PRINT_DEBUG("Reaped child with pid: '%i'", current_pid);
				if (current_pid == child_pid) {
					if (WIFEXITED(current_status)) {
						/* Our process exited normally. */
						PRINT_INFO("Main child exited normally (with status '%i')", WEXITSTATUS(current_status));
						*child_exitcode_ptr = WEXITSTATUS(current_status);
					} else if (WIFSIGNALED(current_status)) {
						/* Our process was terminated. Emulate what sh / bash
						 * would do, which is to return 128 + signal number.
						 */
						PRINT_INFO("Main child exited with signal (with signal '%s')", strsignal(WTERMSIG(current_status)));
						*child_exitcode_ptr = 128 + WTERMSIG(current_status);
					} else {
						PRINT_FATAL("Main child exited for unknown reason");
						return 1;
					}

					// Be safe, ensure the status code is indeed between 0 and 255.
					*child_exitcode_ptr = *child_exitcode_ptr % (STATUS_MAX - STATUS_MIN + 1);

					// If this exitcode was remapped, then set it to 0.
					INT32_BITFIELD_CHECK_BOUNDS(expect_status, *child_exitcode_ptr);
					if (INT32_BITFIELD_TEST(expect_status, *child_exitcode_ptr)) {
						*child_exitcode_ptr = 0;
					}
				} else if (warn_on_reap > 0) {
					PRINT_WARNING("Reaped zombie process with pid=%i", current_pid);
				}

				// Check if other childs have been reaped.
				continue;
		}

		/* If we make it here, that's because we did not continue in the switch case. */
		break;
	}

	return 0;
}
```

然后在 `reap_zombies` 函数中，不断利用 `waitpid` 这个函数来处理进程，在没有子进程等待处理或者遇到其余系统错误时退出循环。

注意这里 tini 和 dumb-init 的的实现差异，dumb-init 在回收自己的入口子进程后便会自杀。而 tini 将会在所有自己的子进程退出之后，结束循环，然后判断是否自杀。

那么我们这里来测试一下

还是 demo2 的例子，我们来测试一下孙进程的例子

```dockerfile
FROM python:3.9

ADD demo2.py /root/demo2.py
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

ENTRYPOINT [ "/tini","-s", "-g", "--"]
CMD ["python", "/root/demo2.py"]
```

然后构建，执行，进程结构如下

![demo2-tini 进程结构图](https://user-images.githubusercontent.com/7054676/109397971-b54fb880-7974-11eb-9899-0d71af5ad835.png)

然后，老规矩，strace , kill 发 SIGTERM 看一下，

![strace 2160093](https://user-images.githubusercontent.com/7054676/109398085-648c8f80-7975-11eb-8b08-21fb0c0399fa.png)

![strace 2160094](https://user-images.githubusercontent.com/7054676/109398094-75d59c00-7975-11eb-8d42-ee062609e152.png)

![strace 2160095](https://user-images.githubusercontent.com/7054676/109398106-871ea880-7975-11eb-94a8-0b25374fa79e.png)

嗯，如预期一样，那么 tini 的实现是不是没有问题了呢，我们再来准备一个例子,demo4.py

```python
import os
import time
import signal
pid = os.fork()
if pid == 0:
    signal.signal(15, lambda _, __: time.sleep(1))
    cpid = os.fork()
time.sleep(1000)
```

这里我们用 `time.sleep(1)` 来模拟，程序接到 SIGTERM 后需要优雅处理，然后我们还是准备下 dockefile

```dockerfile
FROM python:3.9

ADD demo4.py /root/demo4.py
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

ENTRYPOINT [ "/tini","-s", "-g", "--"]
CMD ["python", "/root/demo4.py"]
```

然后构建，允许，看进程结构，啪的一下很快啊

![demo4 进程结构](https://user-images.githubusercontent.com/7054676/109398222-83d7ec80-7976-11eb-88e9-4e7231b2c90d.png)

然后 strace ，发 SIGTERM 一条龙服务，

![strace 2173315](https://user-images.githubusercontent.com/7054676/109398244-aa962300-7976-11eb-9c4f-7ca7dbe1b833.png)

![strace 2173316](https://user-images.githubusercontent.com/7054676/109398251-bc77c600-7976-11eb-8b24-d5bb60c1ce96.png)

![strace 2173317](https://user-images.githubusercontent.com/7054676/109398257-cac5e200-7976-11eb-9921-457195ee052c.png)

然后我们发现，2173316 和 2173317 这两个进程，成功接收到 SIGTERM 的信号后，在处理中，被 SIGKILL 了。那么这是为甚么呢？实际上这里也存在一个潜在的 race condition

当我们开启 tini 的使用。2173315 退出后，2173316 将被 re-parent ，

按照内核的 re-parent 流程，2173317 re-parent 到 tini 进程。

但是，tini 在使用 `waitpid` 的时候，使用了 `WNOHANG` 这个选项，那么这里如果在执行 waitpid 时，子进程还未结束，那么将立刻返回0。从而退出循环，开始自杀流程。

刺激不刺激，关于这点，我师父和我提了一个 issue: [tini Exits Too Early Leading to Graceful Termination Failure](https://github.com/krallin/tini/issues/180)

然后，我也做了一版修复，具体可以参考[use new threading to run waipid](https://github.com/Zheaoli/tini/commit/f5286c205d948a6cbb07fa8dca9e763bdb3ebe61)（还在 PoC，没写单测，处理也有点糙）

实际上思路很简单 ，我们不使用 `waitpid` 中的 `WNOHANG` 选项，将其变为阻塞的调用，然后用一个新的线程来做 `waitpid` 的处理

构建一版测试效果如下

![demo5 进程结构](https://user-images.githubusercontent.com/7054676/109398735-96075a00-7979-11eb-85e9-f8ab99c3d5f5.png)

![strace 1808102](https://user-images.githubusercontent.com/7054676/109398751-b1726500-7979-11eb-8398-0069c4f3a2aa.png)

![strace 1808104](https://user-images.githubusercontent.com/7054676/109398764-c4853500-7979-11eb-981f-a5ea65ae7572.png)

![strace 1808105](https://user-images.githubusercontent.com/7054676/109398777-d666d800-7979-11eb-972a-37cf82e371d4.png)

嗯，如预期一样，测试没有问题。

当然这里实际上可能细心的朋友发现，原本的 tini 也没法处理二进制更新的情况，原因和 demo5 里的原因一致。这里大家可以去测试一下

实际上这里我的处理很过于粗糙和暴力，我们实际上只要保证让 tini 的退出条件变成**一定要等到 waitpid()=-1 && errno==EHILD再退出**。具体的实现手段大家可以一起来思考（实际上还不少

最后来总结一下问题的核心：

无论是 dumb-init 还是 tini 在现行的实现里，都犯了同一个错误，即在容器这个特殊的场景下，都没有等待所有子孙进程的退出再退出。其实解决方案很简单，退出条件一定要是 **waitpid()=-1 && errno==EHILD**

## 总结

本文吐槽了 dumb-init 和 tini。dumb—init 实现属实拉跨，tini 的实现细腻了很多。但是 tini 依旧存在不可靠的行为，以及我们所期待的 fork 二进制更新这种使用一号进程的场景在 dumb-init 和 tini 上都没法实现。而且 dumb-init 和 tini 目前也还有一个共通的局限性。即无法处理子进程进程组逃逸的情况。（比如十个子进程各自逃逸到一个进程组中）。

而且在文中的测试中，我们用 `time.sleep(1)` 来模拟 Graceful Shutdown 的行为，tini 也已经无法满足需求了。。So。。。。

所以归根到底一句话，应用的信号，进程回收这些基础行为应该应用自决。任何管杀不管埋而寄托于一号进程的行为，都是对于生产的不负责任。（如果你们实在想要一个一号进程，还是用 tini 吧，千万别用 dumb-init)

所以 exec 裸起大法好，不用一号进程平安保！

差不多水文就这样吧，这篇水文从提出问题到验证结论，到 patch PoC 报销了我快一个星期的业余时间（本文初稿在凌晨4点过写完）。最后感谢某川同学和我一起搞了几个凌晨三点过。最后，祝大家看的愉快。

